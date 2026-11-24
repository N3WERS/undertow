/**
 * Провайдер YouTube.
 *
 * Разделение обязанностей (проверено спайками):
 *  - метаданные и лента  — youtubei.js (браузить умеет, ссылки на звук нет);
 *  - поиск              — yt-dlp flat (быстро, отдаёт длительность и канал);
 *  - аудио-URL          — yt-dlp -f bestaudio -g (единственный рабочий путь).
 */
import { Innertube } from 'youtubei.js'
import { ytResolve, ytSearch } from '../ytdlp'
import type { ResolvedStream, Section, Track } from './types'

let clientPromise: Promise<Innertube> | null = null
const streamCache = new Map<string, { stream: ResolvedStream; expires: number }>()
const CACHE_TTL = 10 * 60_000

async function client(): Promise<Innertube> {
  if (!clientPromise) {
    clientPromise = Innertube.create({ retrieve_player: false, lang: 'ru', location: 'RU' })
  }
  return clientPromise
}

/* ------------------------------- утилиты -------------------------------- */

function text(v: unknown): string {
  if (!v) return ''
  const t = v as { toString?: () => string; text?: string }
  if (typeof t.toString === 'function') {
    try {
      return t.toString()
    } catch {
      /* ignore */
    }
  }
  return t.text ?? ''
}

/** Достаёт самую крупную картинку из любой формы, которую отдаёт парсер. */
function image(node: unknown, depth = 0): string | undefined {
  if (!node || typeof node !== 'object' || depth > 3) return undefined
  const obj = node as Record<string, unknown>
  const list = (obj.thumbnails ?? obj.thumbnail) as unknown
  if (Array.isArray(list)) {
    const urls = list
      .map((t) => (t && typeof t === 'object' ? ((t as { url?: string }).url as string) : undefined))
      .filter((u): u is string => typeof u === 'string')
    if (urls.length) return urls[urls.length - 1]
    for (const t of list) {
      const nested = image(t, depth + 1)
      if (nested) return nested
    }
  } else if (list && typeof list === 'object') {
    const nested = image(list, depth + 1)
    if (nested) return nested
  }
  return undefined
}

function parseClock(s: string): number | null {
  if (!s.includes(':')) return null
  const parts = s.split(':').map((p) => Number(p.replace(/\D/g, '')))
  if (parts.some((n) => !Number.isFinite(n))) return null
  return parts.reduce((acc, n) => acc * 60 + n, 0) || null
}

/**
 * Длительность приходит в разных видах: у строк поиска это «3:45», у
 * MusicResponsiveListItem — объект `{ text: '3:45', seconds: 225 }`.
 * Раньше объект превращался в строку «[object Object]», и все длительности
 * на страницах артиста/альбома оставались пустыми.
 */
function parseDuration(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) && v > 0 ? v : null
  if (v && typeof v === 'object') {
    const sec = (v as { seconds?: unknown }).seconds
    if (typeof sec === 'number' && Number.isFinite(sec) && sec > 0) return Math.round(sec)
    const t = (v as { text?: unknown }).text
    return typeof t === 'string' ? parseClock(t) : null
  }
  if (typeof v === 'string') return parseClock(v)
  return null
}

const PLAYABLE = new Set(['song', 'video'])

type ParserItem = Record<string, unknown>

function toTrack(item: ParserItem): Track | null {
  const id = typeof item.id === 'string' ? item.id : ''
  const title = text(item.title)
  if (!id || !title) return null
  const kind = String(item.item_type ?? 'song') as Track['kind']
  const artists = Array.isArray(item.artists)
    ? (item.artists as { name?: string }[]).map((a) => a.name).filter(Boolean).join(', ')
    : ''
  const uploader = typeof item.author === 'string' ? item.author : ''
  const album = text((item.album as { name?: string } | undefined)?.name)
  return {
    id: `yt:${id}`,
    provider: 'youtube',
    title,
    artist: artists || uploader || text(item.subtitle).split('•')[0].trim() || 'YouTube',
    album: album || undefined,
    durationSec: parseDuration(item.duration),
    coverUrl: image(item),
    kind,
    subtitle: text(item.subtitle) || undefined,
    playable: PLAYABLE.has(kind)
  }
}

/** Обходит дерево ответа и вытаскивает все элементы списков музыки. */
function collectItems(node: unknown, out: ParserItem[] = [], depth = 0): ParserItem[] {
  if (!node || typeof node !== 'object' || depth > 12) return out
  if (Array.isArray(node)) {
    for (const n of node) collectItems(n, out, depth + 1)
    return out
  }
  const name = (node as object).constructor?.name
  if (name === 'MusicResponsiveListItem' || name === 'MusicTwoRowItem') {
    out.push(node as ParserItem)
    return out
  }
  for (const v of Object.values(node as Record<string, unknown>)) {
    if (v && typeof v === 'object') collectItems(v, out, depth + 1)
  }
  return out
}

/* ------------------------------- методы --------------------------------- */

/** Поиск сразу в трёх разрезах YouTube Music: треки, альбомы, артисты. */
export interface YmSearchAll {
  tracks: Track[]
  albums: YmAlbumRef[]
  artists: YmArtistRef[]
}

export async function musicSearchAll(query: string): Promise<YmSearchAll> {
  const q = query.trim()
  if (!q) return { tracks: [], albums: [], artists: [] }
  const yt = await client()
  const [songs, albums, artists] = await Promise.all([
    yt.music.search(q, { type: 'song' }).catch(() => null),
    yt.music.search(q, { type: 'album' }).catch(() => null),
    yt.music.search(q, { type: 'artist' }).catch(() => null)
  ])
  const tracks = dedupe(
    collectItems(songs)
      .map((item) => musicTrack(item, undefined, { artist: undefined, artistId: undefined }))
      .filter((t): t is Track => t !== null && t.playable)
  ).slice(0, 24)
  const albumRefs = dedupe(
    collectItems(albums)
      .map(albumRefOf)
      .filter((a): a is YmAlbumRef => a !== null)
  ).slice(0, 12)
  const artistRefs = dedupe(
    collectItems(artists)
      .map(artistRefOf)
      .filter((a): a is YmArtistRef => a !== null)
  ).slice(0, 12)
  return { tracks, albums: albumRefs, artists: artistRefs }
}

/** Лента «Обзор»: Новые альбомы и синглы / В тренде / Новые клипы. */
export async function explore(): Promise<Section[]> {
  const yt = await client()
  const res = (await yt.music.getExplore()) as unknown as { sections?: ParserItem[] }
  const sections: Section[] = []
  for (const [i, raw] of (res.sections ?? []).entries()) {
    const carousel = raw as unknown as { header?: unknown; contents?: unknown[] }
    const title = text((carousel.header as { title?: unknown } | undefined)?.title)
    const items = (carousel.contents ?? [])
      .map((c) => toTrack(c as ParserItem))
      .filter((t): t is Track => t !== null)
    if (!items.length || !title) continue
    const layout: Section['layout'] = items.some((t) => t.playable) && items[0].kind === 'song' ? 'list' : 'grid'
    sections.push({ id: `explore-${i}`, title, layout, items })
  }
  return sections
}

/**
 * Каналы и плейлисты иногда попадают в выдачу поиска: у них id вида UC…/PL…,
 * и yt-dlp такой «трек» играть откажется. Помечаем их сразу, чтобы UI не звал
 * заведомо битую ссылку.
 */
function looksLikeChannel(id: string): boolean {
  return id.startsWith('UC') || id.startsWith('PL') || id.startsWith('RD') || id.length !== 11
}

/** Поиск. yt-dlp отдаёт аккуратные длительность/канал без лишних запросов. */
export async function search(query: string, limit = 24): Promise<Track[]> {
  const entries = await ytSearch(query, limit)
  return entries.map((e) => ({
    id: `yt:${e.id}`,
    provider: 'youtube' as const,
    title: e.title,
    artist: e.uploader || 'YouTube',
    durationSec: e.duration,
    coverUrl: e.thumbnail ?? undefined,
    kind: 'song' as const,
    playable: !e.isLive && !looksLikeChannel(e.id)
  }))
}

export function videoIdOf(trackId: string): string {
  return trackId.startsWith('yt:') ? trackId.slice(3) : trackId
}

/**
 * Разрешает ссылку на звук с коротким кэшем, чтобы перемотка не дёргала yt-dlp.
 * Параллельные запросы на один трек (прогрев следующего + ручное переключение)
 * ждут один запуск, а не запускают yt-dlp дважды.
 */
const resolving = new Map<string, Promise<ResolvedStream>>()

export async function resolveStream(trackId: string): Promise<ResolvedStream> {
  const cached = streamCache.get(trackId)
  if (cached && cached.expires > Date.now()) return cached.stream
  const pending = resolving.get(trackId)
  if (pending) return pending

  const job = (async () => {
    const { url, ext, abr } = await ytResolve(videoIdOf(trackId))
    const stream: ResolvedStream = {
      url,
      mime: ext === 'webm' ? 'audio/webm' : ext === 'mp4' || ext === 'm4a' ? 'audio/mp4' : 'audio/mpeg',
      bitrateKbps: abr ? Math.round(abr) : undefined,
      ttlMs: CACHE_TTL,
      source: 'youtube',
      videoId: videoIdOf(trackId)
    }
    streamCache.set(trackId, { stream, expires: Date.now() + CACHE_TTL })
    if (streamCache.size > 120) {
      for (const [k, v] of streamCache) if (v.expires < Date.now()) streamCache.delete(k)
    }
    return stream
  })()
  resolving.set(trackId, job)
  try {
    return await job
  } finally {
    if (resolving.get(trackId) === job) resolving.delete(trackId)
  }
}

/** Кладёт готовую ссылку в кэш (когда она получена другим путём, без второго запуска yt-dlp). */
export function rememberStream(trackId: string, stream: ResolvedStream): void {
  streamCache.set(trackId, { stream, expires: Date.now() + Math.min(stream.ttlMs || CACHE_TTL, CACHE_TTL) })
}

/** Сбрасывает кэш ссылки (нужен, когда выбор варианта поменялся). */
export function dropStreamCache(trackId?: string): void {
  if (trackId) streamCache.delete(trackId)
  else streamCache.clear()
}

/* ------------------ YouTube Music: артисты, альбомы, соседи --------------- */

const MUSIC_TTL = 30 * 60_000
const artistCache = new Map<string, { at: number; value: YmArtistProfile }>()
const albumCache = new Map<string, { at: number; value: YmAlbumDetails }>()

export interface YmArtistRef {
  id: string
  name: string
  coverUrl?: string
}

export interface YmAlbumRef {
  id: string
  title: string
  year?: string
  coverUrl?: string
  /** «сингл», «EP», «альбом» — из подписи карточки YouTube Music */
  type?: 'single' | 'ep' | 'album'
}

/** Всё, что нужно для страницы артиста и для радио. */
export interface YmArtistProfile {
  id: string
  name: string
  coverUrl?: string
  /** топ-треки: обычно 50–100, а не 5, которые видны сразу */
  tracks: Track[]
  albums: YmAlbumRef[]
  related: YmArtistRef[]
}

export interface YmAlbumDetails {
  id: string
  title: string
  year?: string
  coverUrl?: string
  artist?: string
  artistId?: string
  tracks: Track[]
}

/** В списках YouTube отдаёт обложки 60×60 — для карточек просим крупнее. */
function bigCover(url: string | undefined): string | undefined {
  return url?.replace(/=w\d+-h\d+/, '=w544-h544')
}

/**
 * «Похожее»: очередь YouTube Music (Up next) для конкретного видео.
 * Возвращает до `limit` треков, без самого затравочного.
 */
export async function relatedTracks(videoId: string, limit = 40): Promise<Track[]> {
  if (!/^[\w-]{11}$/.test(videoId)) return []
  try {
    const yt = await client()
    const panel = await yt.music.getUpNext(videoId)
    const rows = (panel.contents ?? []) as unknown as (ParserItem & { video_id?: string })[]
    const tracks = rows
      .map((row) => {
        const id = row.video_id ?? row.id
        return musicTrack(typeof id === 'string' ? { ...row, id } : row)
      })
      .filter((t): t is Track => t !== null && t.playable && t.id !== `yt:${videoId}`)
    return dedupe(tracks).slice(0, limit)
  } catch {
    return []
  }
}

/** Обложка лежит либо в thumbnails, либо в thumbnail.contents. */
function coverOf(node: unknown): string | undefined {
  const direct = image(node)
  if (direct) return direct
  const thumb = (node as { thumbnail?: { contents?: unknown } } | undefined)?.thumbnail
  const contents = thumb && typeof thumb === 'object' ? thumb.contents : undefined
  if (!Array.isArray(contents)) return undefined
  const urls = contents
    .map((c) => (c && typeof c === 'object' ? (c as { url?: string }).url : undefined))
    .filter((u): u is string => typeof u === 'string')
  return urls.length ? urls[urls.length - 1] : undefined
}

interface TrackFallback {
  coverUrl?: string
  artist?: string
  artistId?: string
}

/**
 * Строка YouTube Music → наш Track. У строк внутри альбома не бывает ни
 * обложки, ни (иногда) исполнителей — тогда берём значения с шапки альбома,
 * иначе в списке получалось «YouTube» без картинки.
 */
/**
 * Название альбома из строки списка: в топе артиста YouTube Music отдаёт его
 * четвёртой колонкой («46M plays» — третьей). Нужно, чтобы у трека был альбом и
 * потом нашёлся год выпуска.
 */
function rowAlbumName(item: ParserItem): string | undefined {
  const obj = item as { album?: { name?: unknown }; flex_columns?: { title?: unknown }[] }
  const direct = text(obj.album?.name)
  if (direct) return direct
  const cols = Array.isArray(obj.flex_columns) ? obj.flex_columns : []
  const texts = cols.map((c) => text(c.title)).filter(Boolean)
  if (texts.length < 4) return undefined
  for (let i = texts.length - 1; i >= 1; i--) {
    const t = texts[i]
    if (/plays|views|подписчик|слушател/i.test(t)) continue
    if (/^[0-9]+:[0-9]{2}$/.test(t) || /^[0-9]{4}$/.test(t)) continue
    return t
  }
  return undefined
}

export function musicTrack(item: ParserItem, album?: YmAlbumRef, fallback?: TrackFallback): Track | null {
  const id = typeof item.id === 'string' ? item.id : ''
  const title = text(item.title) || text(item.name)
  if (!id || !title || id.length !== 11) return null
  const raw = Array.isArray(item.artists) ? (item.artists as { name?: string; channel_id?: string }[]) : []
  const artists = raw
    .map((a) => ({ id: typeof a.channel_id === 'string' ? a.channel_id : undefined, name: String(a.name ?? '') }))
    .filter((a) => a.name)
  const artistName = artists.map((a) => a.name).join(', ')
  const albumTitle = album?.title ?? rowAlbumName(item)
  const year =
    text(item.year) ||
    text((item as { album?: { year?: unknown } }).album?.year) ||
    album?.year ||
    text(item.subtitle).match(/(?:19|20)[0-9]{2}/)?.[0] ||
    undefined
  return {
    id: `yt:${id}`,
    provider: 'youtube',
    title,
    artist:
      artistName ||
      artistFromSubtitle(text(item.subtitle)) ||
      fallback?.artist ||
      'YouTube',
    artistId: artists[0]?.id ?? fallback?.artistId,
    artists: artists.length ? artists : undefined,
    album: albumTitle,
    year,
    albumId: album ? `yt-album:${album.id}` : undefined,
    durationSec: parseDuration(item.duration),
    coverUrl: bigCover(coverOf(item)) ?? fallback?.coverUrl,
    kind: 'song',
    playable: true
  }
}

export function albumRefOf(item: ParserItem): YmAlbumRef | null {
  const id = typeof item.id === 'string' ? item.id : ''
  if (!id.startsWith('MPREb')) return null
  const title = text(item.title) || text(item.name)
  if (!title) return null
  const sub = text(item.subtitle).toLowerCase()
  const type = /singl|сингл/.test(sub)
    ? 'single'
    : /ep|мини-альбом/.test(sub)
      ? 'ep'
      : /album|альбом/.test(sub)
        ? 'album'
        : undefined
  return { id, title, year: text(item.year) || undefined, coverUrl: bigCover(coverOf(item)), type }
}

function artistRefOf(item: ParserItem): YmArtistRef | null {
  const id = typeof item.id === 'string' ? item.id : ''
  if (!/^UC[\w-]{22}$/.test(id)) return null
  const name = text(item.name) || text(item.title)
  if (!name) return null
  return { id, name, coverUrl: bigCover(coverOf(item)) }
}

function dedupe<T extends { id: string }>(list: T[]): T[] {
  const seen = new Set<string>()
  return list.filter((x) => (seen.has(x.id) ? false : (seen.add(x.id), true)))
}

/** Имя артиста → его канал в YouTube Music (лучше брать по точному совпадению). */
export async function musicSearchArtist(name: string): Promise<YmArtistRef | null> {
  const clean = name.trim()
  if (!clean) return null
  const yt = await client()
  const res = (await yt.music.search(clean, { type: 'artist' })) as unknown as ParserItem[]
  const refs = collectItems(res)
    .map(artistRefOf)
    .filter((r): r is YmArtistRef => r !== null)
  const norm = (s: string): string => s.toLowerCase().replace(/\s+/g, ' ').trim()
  return refs.find((r) => norm(r.name) === norm(clean)) ?? refs[0] ?? null
}

interface ArtistSection {
  type?: string
  contents?: ParserItem[]
  endpoint?: { call: (actions: unknown, opts: { client: string; parse: boolean }) => Promise<unknown> }
}

/**
 * Страница артиста: топ-треки (через «ещё», а не 5 видимых), альбомы и
 * «Похожие исполнители». Без Яндекса это и есть аналог `/artists/{id}`.
 */
export async function musicArtist(ref: { id?: string; name?: string }): Promise<YmArtistProfile> {
  const yt = await client()
  const plainId = (ref.id ?? '').replace(/^(yt|ym)-artist:/, '')
  const looksLikeArtist = /^UC[\w-]{22}$/.test(plainId)
  let id = looksLikeArtist ? plainId : ''

  if (!id) {
    const found = await musicSearchArtist(ref.name ?? '')
    if (!found) throw new Error('Артист не найден на YouTube')
    id = found.id
  }

  const cached = artistCache.get(id)
  if (cached && Date.now() - cached.at < MUSIC_TTL) return cached.value

  let page: { sections?: unknown[]; header?: unknown }
  try {
    page = (await yt.music.getArtist(id)) as unknown as typeof page
  } catch (e) {
    // id канала может быть «Topic»-каналом: тогда ищем по имени
    const found = await musicSearchArtist(ref.name ?? '')
    if (!found || found.id === id) throw e
    id = found.id
    const hit = artistCache.get(id)
    if (hit && Date.now() - hit.at < MUSIC_TTL) return hit.value
    page = (await yt.music.getArtist(id)) as unknown as typeof page
  }

  const sections = (page.sections ?? []) as ArtistSection[]
  const shelf = sections.find((s) => s.type === 'MusicShelf')

  let rows = (shelf?.contents ?? []) as ParserItem[]
  if (shelf?.endpoint) {
    try {
      const full = (await shelf.endpoint.call(yt.actions, { client: 'YTMUSIC', parse: true })) as {
        contents_memo?: { get: (k: string) => { contents?: ParserItem[] }[] | undefined }
      }
      const playlist = full.contents_memo?.get('MusicPlaylistShelf')?.[0]?.contents
      if (playlist?.length) rows = playlist
    } catch {
      /* останемся на том, что уже есть */
    }
  }

  const tracks = rows.map((r) => musicTrack(r)).filter((t): t is Track => t !== null)
  const albums: YmAlbumRef[] = []
  const related: YmArtistRef[] = []
  for (const sec of sections) {
    for (const item of (sec.contents ?? []) as ParserItem[]) {
      const album = albumRefOf(item)
      if (album) albums.push(album)
      const artist = artistRefOf(item)
      if (artist) related.push(artist)
    }
  }

  const value: YmArtistProfile = {
    id,
    name: text((page.header as { title?: unknown })?.title) || ref.name || 'Артист',
    coverUrl: bigCover(coverOf(page.header)),
    tracks,
    albums: dedupe(albums),
    related: dedupe(related)
  }
  artistCache.set(id, { at: Date.now(), value })
  return value
}

/** Слова, которыми YouTube Music подписывает тип, а не артиста. */
const TYPE_WORDS = new Set([
  'альбом',
  'album',
  'сингл',
  'single',
  'ep',
  'мини-альбом',
  'плейлист',
  'playlist',
  'видео',
  'video',
  'сборник',
  'compilation',
  'микс',
  'mix'
])

/**
 * «Альбом • NF • 2017» → `NF`. Раньше первый сегмент подписи («Альбом»)
 * попадал в поле исполнителя, и в списке альбома все треки были «от Альбом».
 */
function artistFromSubtitle(subtitle: string): string {
  const parts = subtitle
    .split('•')
    .map((p) => p.trim())
    .filter(Boolean)
  const rest = parts.filter((p) => !TYPE_WORDS.has(p.toLowerCase()) && !/^(19|20)\d\d$/.test(p))
  return rest[0] ?? ''
}

function flat(s: string): string {
  return s
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

function titleWords(title: string): string[] {
  return [...new Set(flat(title).split(' ').filter(Boolean))].sort()
}

/**
 * Похожесть названий альбомов по словам, а не по подстроке: иначе «AM»
 * (Arctic Monkeys) «находился» внутри «Damn Look At These Massive Brit Hits».
 * 100 — точное совпадение, 60 — одно название продолжает другое, 40 — все
 * слова искомого есть в найденном (делюксы, ремастеры).
 */
function titleScore(wanted: string[], found: string[]): number {
  if (!wanted.length || !found.length) return 0
  if (wanted.join(' ') === found.join(' ')) return 100
  const shorter = wanted.length <= found.length ? wanted : found
  const longer = wanted.length <= found.length ? found : wanted
  if (shorter.every((w) => longer.includes(w))) {
    return longer.length - shorter.length <= 2 ? 60 : 40
  }
  return 0
}

/**
 * Поиск альбома по названию (и, если есть, исполнителю). Нужен, когда известен
 * только яндексовский id альбома: без этого «пластинка» открывала солянку из
 * поиска yt-dlp вместо настоящего альбома.
 */
async function searchAlbum(ref: { artist?: string; title: string }): Promise<YmAlbumRef | null> {
  const title = ref.title.trim()
  if (!title) return null
  const firstArtist = (ref.artist ?? '').split(',')[0].trim()
  const query = firstArtist ? `${firstArtist} ${title}` : title
  const yt = await client()
  let res: unknown
  try {
    res = await yt.music.search(query, { type: 'album' })
  } catch {
    return null
  }
  const refs = collectItems(res as ParserItem[])
    .map(albumRefOf)
    .filter((r): r is YmAlbumRef => r !== null)
  const wanted = titleWords(title)
  const artist = ref.artist ? flat(ref.artist) : ''
  const scored = refs
    .map((r) => {
      let score = titleScore(wanted, titleWords(r.title))
      if (artist && flat(r.title).includes(artist)) score += 10
      return { ref: r, score }
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
  return scored[0]?.ref ?? null
}

/**
 * Альбом по «артист + название». Поиск по альбомам у YouTube Music иногда
 * пуст (синглы живут отдельно), поэтому второй заход — список альбомов
 * самого артиста: там сингл «Сокровище» находится сразу.
 */
export async function musicAlbumByTitle(ref: {
  artist?: string
  title: string
}): Promise<YmAlbumRef | null> {
  const clean = ref.title.trim()
  if (!clean) return null

  const direct = await searchAlbum({ artist: ref.artist, title: clean }).catch(() => null)
  if (direct) return direct

  const artistName = (ref.artist ?? '').split(',')[0].trim()
  if (!artistName) return null
  const profile = await musicArtist({ name: artistName }).catch(() => null)
  if (!profile) return null

  const wanted = titleWords(clean)
  const scored = profile.albums
    .map((a) => ({ ref: a, score: titleScore(wanted, titleWords(a.title)) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
  return scored[0]?.ref ?? null
}

/**
 * Альбом, в котором лежит конкретный трек: ищем песню и берём альбом из её
 * строки. Это спасает старые альбомы, которых нет в первых семи карточках
 * артиста и которые плохо находятся поиском по названию альбома.
 */
export async function musicAlbumOfTrack(ref: {
  artist?: string
  title: string
}): Promise<YmAlbumRef | null> {
  const clean = ref.title.trim()
  if (!clean) return null
  const first = (ref.artist ?? '').split(',')[0].trim()
  const yt = await client()
  let res: unknown
  try {
    res = await yt.music.search(first ? `${first} ${clean}` : clean, { type: 'song' })
  } catch {
    return null
  }

  const wanted = titleWords(clean)
  const artistKey = first ? flat(first) : ''
  const rows = collectItems(res as ParserItem[]).filter((r) => {
    const album = r.album as { id?: unknown } | undefined
    return typeof album?.id === 'string' && album.id.startsWith('MPREb')
  })

  const scored = rows
    .map((r) => {
      const album = r.album as { id: string; name?: unknown }
      const names = Array.isArray(r.artists)
        ? (r.artists as { name?: string }[]).map((a) => String(a.name ?? '')).join(', ')
        : ''
      const artistOk = Boolean(artistKey) && flat(names).includes(artistKey)
      return {
        row: r,
        album,
        artistOk,
        score: titleScore(wanted, titleWords(text(r.title))) + (artistOk ? 20 : 0)
      }
    })
    // чужой артист с тем же названием трека нам не нужен
    .filter((x) => x.score >= 60 && (x.artistOk || !artistKey))
    .sort((a, b) => b.score - a.score)

  const best = scored[0]
  if (!best) return null
  return {
    id: best.album.id,
    title: text(best.album.name) || clean,
    coverUrl: bigCover(coverOf(best.album))
  }
}

const yearCache = new Map<string, string | null>()

/**
 * Год выпуска по названию альбома. У песен YouTube Music года нет — он живёт
 * в шапке альбома, поэтому ищем альбом и берём год из его карточки.
 * Кэш навсегда: названия альбомов не меняются.
 */
export async function albumYear(title: string, artist?: string): Promise<string | null> {
  const key = `${title.toLowerCase()}|${(artist ?? '').toLowerCase()}`
  if (yearCache.has(key)) return yearCache.get(key) ?? null
  try {
    const yt = await client()
    const query = `${title} ${artist ?? ''}`.trim()
    const res = (await yt.music.search(query, { type: 'album' })) as unknown
    const wanted = titleWords(title)
    const artistKey = artist ? flat(artist) : ''
    const best = collectItems(res as ParserItem[])
      .filter((r) => text(r.year))
      .map((r) => ({
        year: text(r.year),
        score:
          titleScore(wanted, titleWords(text(r.title))) +
          (artistKey && flat(text(r.subtitle ?? r.title)).includes(artistKey) ? 10 : 0)
      }))
      .filter((x) => x.score >= 60)
      .sort((a, b) => b.score - a.score)[0]
    yearCache.set(key, best?.year ?? null)
    return best?.year ?? null
  } catch {
    yearCache.set(key, null)
    return null
  }
}

/**
 * Длительности по videoId: один InnerTube player-запрос на трек, восемь
 * параллельно (~0.15 с на запрос). Нужно, чтобы дозаполнить старые записи
 * истории, сохранённые до починки parseDuration.
 */
export async function durations(ids: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>()
  if (!ids.length) return out
  const yt = await client()
  for (let i = 0; i < ids.length; i += 8) {
    await Promise.all(
      ids.slice(i, i + 8).map(async (id) => {
        try {
          const info = await yt.getBasicInfo(id)
          const sec = info.basic_info?.duration
          if (typeof sec === 'number' && Number.isFinite(sec) && sec > 0) out.set(id, Math.round(sec))
        } catch {
          /* приватное или удалённое видео — оставляем как есть */
        }
      })
    )
  }
  return out
}

/** Проставляет год трекам, у которых есть название альбома (до `maxAlbums` запросов). */
export async function fillYears(tracks: Track[], maxAlbums = 8): Promise<Track[]> {
  const groups = new Map<string, Track[]>()
  for (const t of tracks) {
    if (t.year || !t.album) continue
    const key = t.album.trim().toLowerCase()
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(t)
  }
  await Promise.all(
    [...groups.entries()].slice(0, maxAlbums).map(async ([, list]) => {
      const first = list[0]
      const year = await albumYear(first.album as string, first.artists?.[0]?.name ?? first.artist)
      if (year) for (const t of list) t.year = year
    })
  )
  return tracks
}

/** Альбом целиком: id вида MPREb… или `yt-album:MPREb…`. */
export async function musicAlbum(idOrRef: string): Promise<YmAlbumDetails> {
  const key = idOrRef.replace(/^yt-album:/, '').trim()
  const cached = albumCache.get(key)
  if (cached && Date.now() - cached.at < MUSIC_TTL) return cached.value

  const yt = await client()
  const page = (await yt.music.getAlbum(key)) as unknown as {
    header?: unknown
    contents?: ParserItem[]
  }
  const title = text((page.header as { title?: unknown })?.title) || 'Альбом'
  const subtitle = text((page.header as { subtitle?: unknown })?.subtitle)
  // в шапке альбома исполнитель лежит в straplineTextOne («NF»), а subtitle
  // обычно только «Альбом • 2017»
  const strapline = text((page.header as { strapline_text_one?: unknown })?.strapline_text_one)
  const year = text((page.header as { year?: unknown })?.year) || subtitle.match(/(19|20)\d\d/)?.[0]
  const ref: YmAlbumRef = { id: key, title, year }
  const rows = page.contents ?? []
  const coverUrl = bigCover(coverOf(page.header))
  const firstArtists = (rows.find((r) => Array.isArray(r.artists) && r.artists.length)?.artists ??
    []) as { name?: string; channel_id?: string }[]
  const artistNames = firstArtists.map((a) => String(a.name ?? '')).filter(Boolean)
  const artist = artistNames.join(', ') || strapline || artistFromSubtitle(subtitle)
  const fallback: TrackFallback = { coverUrl, artist: artist || undefined, artistId: firstArtists[0]?.channel_id }
  const tracks = rows
    .map((r) => musicTrack(r, ref, fallback))
    .filter((t): t is Track => t !== null)

  const value: YmAlbumDetails = {
    id: key,
    title,
    year,
    coverUrl,
    artist: artist || undefined,
    artistId: firstArtists[0]?.channel_id,
    tracks
  }
  albumCache.set(key, { at: Date.now(), value })
  return value
}
