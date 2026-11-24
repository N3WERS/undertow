/**
 * Провайдер Яндекс.Музыки (неофициальный API api.music.yandex.net).
 *
 * Работает только при активной подписке Плюс: без неё сервис отдаёт
 * 30-секундные превью, а такие треки нам не нужны — этим занимается
 * оркестратор в providers/index.ts.
 */
import { createHash, createHmac } from 'node:crypto'
import type { BrowsePage, ResolvedStream, Section, Track } from './types'

const API = 'https://api.music.yandex.net'
/** Публичная «соль» клиента — из неё считается подпись прямой ссылки */
const SIGN_SALT = 'XGRlBW9FXlekgbPrRHuSiA'
const CLIENT = 'YandexMusicDesktopAppWindows/5.13.2'

export const YANDEX_PROVIDER_TAG = 'ym'

function headers(token: string): Record<string, string> {
  return {
    Authorization: `OAuth ${token}`,
    'X-Yandex-Music-Client': CLIENT,
    'User-Agent': 'Yandex-Music-API',
    Accept: 'application/json'
  }
}

async function call<T = unknown>(path: string, token: string, timeoutMs = 15000): Promise<T> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(`${API}${path}`, { headers: headers(token), signal: ctrl.signal })
    if (res.status === 401) throw new Error('Токен Яндекса не принят (401) — проверь, что скопирован целиком')
    if (!res.ok) throw new Error(`Яндекс API ${res.status} на ${path}`)
    return (await res.json()) as T
  } finally {
    clearTimeout(timer)
  }
}

async function post<T = unknown>(path: string, token: string, timeoutMs = 15000): Promise<T> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(`${API}${path}`, { method: 'POST', headers: headers(token), signal: ctrl.signal })
    if (res.status === 401) throw new Error('Токен Яндекса не принят (401)')
    if (!res.ok) {
      // сервер охотно объясняет, что не так — вытаскиваем message
      let detail = ''
      try {
        const body = (await res.json()) as { error?: { message?: string } }
        detail = body?.error?.message ?? ''
      } catch {
        // тело не JSON
      }
      throw new Error(`Яндекс API ${res.status} на ${path}${detail ? `: ${detail}` : ''}`)
    }
    return (await res.json()) as T
  } finally {
    clearTimeout(timer)
  }
}

/* ------------------------------- аккаунт -------------------------------- */

export interface YandexAccount {
  login: string | null
  uid: number | null
  hasPlus: boolean
  /** сырые флаги — попадают в настройки, чтобы было видно, что именно ответил сервис */
  raw: Record<string, unknown>
}

function findKey(node: unknown, key: string, depth = 0): unknown {
  if (!node || typeof node !== 'object' || depth > 5) return undefined
  if (Array.isArray(node)) {
    for (const n of node) {
      const found = findKey(n, key, depth + 1)
      if (found !== undefined) return found
    }
    return undefined
  }
  const obj = node as Record<string, unknown>
  if (key in obj) return obj[key]
  for (const v of Object.values(obj)) {
    const found = findKey(v, key, depth + 1)
    if (found !== undefined) return found
  }
  return undefined
}

/** Проверяет токен и наличие Плюса. */
export async function accountStatus(token: string): Promise<YandexAccount> {
  const data = await call<{ result?: unknown }>('/account/status', token)
  const result = (data.result ?? data) as Record<string, unknown>

  const account = (findKey(result, 'account') ?? {}) as Record<string, unknown>
  const plusNode = (findKey(result, 'plus') ?? {}) as Record<string, unknown>
  const subscription = (findKey(result, 'subscription') ?? {}) as Record<string, unknown>

  const plusFlag = plusNode?.hasPlus === true
  // В dev полезно видеть, что именно ответил сервер: /account/status менялся не раз
  console.log('[yandex] account/status:', JSON.stringify(result).slice(0, 700))
  // Плюс может быть активен, даже если hasPlus не пришёл: смотрим на список подписок
  const subs = Array.isArray(subscription?.subscriptions) ? (subscription.subscriptions as { active?: boolean }[]) : []
  const activeSub = subs.some((s) => s?.active === true)
  const hadAny = subscription?.hadAnySubscription === true

  return {
    login: (account?.login as string) ?? (account?.displayName as string) ?? null,
    uid: typeof account?.uid === 'number' ? (account.uid as number) : null,
    hasPlus: plusFlag || activeSub || (hadAny && plusFlag),
    raw: {
      plus: plusNode,
      subscription: {
        hadAnySubscription: hadAny,
        canStartTrial: subscription?.canStartTrial ?? null
      }
    }
  }
}

/* -------------------------------- маппинг -------------------------------- */

interface YmArtist {
  id?: number | string
  name?: string
}
interface YmAlbum {
  id?: number | string
  title?: string
  coverUri?: string
  year?: number
  trackCount?: number
}
interface YmTrack {
  id: number | string
  title?: string
  available?: boolean
  durationMs?: number
  coverUri?: string
  artists?: YmArtist[]
  albums?: YmAlbum[]
  ogImage?: string
}

function coverUrl(node: { coverUri?: string; ogImage?: string } | undefined): string | undefined {
  const uri = node?.coverUri ?? node?.ogImage
  if (!uri) return undefined
  const sized = uri.replace('%%', '600x600')
  return sized.startsWith('http') ? sized : `https://${sized}`
}

function mapTrack(t: YmTrack): Track | null {
  if (!t?.id || !t.title) return null
  const album = t.albums?.[0]
  return {
    id: `${YANDEX_PROVIDER_TAG}:${t.id}`,
    provider: 'yandex',
    title: t.title,
    artist: (t.artists ?? []).map((a) => a.name).filter(Boolean).join(', ') || 'Яндекс.Музыка',
    artistId: t.artists?.[0]?.id ? String(t.artists[0].id) : undefined,
    artists: (t.artists ?? [])
      .filter((a) => a.name)
      .map((a) => ({ id: a.id ? String(a.id) : undefined, name: a.name as string })),
    album: album?.title,
    year: album?.year ? String(album.year) : undefined,
    albumId: album?.id ? String(album.id) : undefined,
    durationSec: t.durationMs ? Math.round(t.durationMs / 1000) : null,
    coverUrl: coverUrl(t) ?? coverUrl(album),
    kind: 'song',
    playable: t.available !== false
  }
}

/* -------------------------------- поиск ---------------------------------- */

export async function search(token: string, query: string, limit = 24): Promise<Track[]> {
  const data = await call<{ result?: { tracks?: { results?: YmTrack[] } } }>(
    `/search?text=${encodeURIComponent(query)}&type=all&page=0&nocorrect=false`,
    token
  )
  const results = data.result?.tracks?.results ?? []
  return results
    .slice(0, limit)
    .map(mapTrack)
    .filter((t): t is Track => t !== null)
}

/* -------------------------------- лента ---------------------------------- */

const BLOCK_TITLES: Record<string, string> = {
  'new-releases': 'Новинки',
  'new-playlists': 'Новые плейлисты',
  chart: 'Чарт',
  mixes: 'Мои волны',
  personalplaylists: 'Плейлисты',
  albums: 'Альбомы',
  artists: 'Артисты',
  promotions: ''
}

interface LandingEntity {
  id?: number | string
  type?: string
  track?: YmTrack
  data?: { track?: YmTrack }
  title?: string
  year?: number
  releaseDate?: string
  trackCount?: number
  coverUri?: string
  artists?: YmArtist[]
  durationMs?: number
}

function mapEntity(e: LandingEntity, blockType = ''): Track | null {
  const track = e.track ?? e.data?.track
  if (track?.title) return mapTrack(track)
  if (!e.title) return null
  // альбом/артист с настоящим id — по такой карточке можно открыть страницу
  const rawId = e.id !== undefined && e.id !== null ? String(e.id) : ''
  const isArtist = blockType === 'artists' || e.type === 'artist'
  const isAlbum = !isArtist && (blockType === 'albums' || blockType === 'new-releases' || e.type === 'album')
  const cardId = rawId
    ? `${YANDEX_PROVIDER_TAG}-${isArtist ? 'artist' : isAlbum ? 'album' : 'playlist'}:${rawId}`
    : `${YANDEX_PROVIDER_TAG}-card:${e.title}-${e.releaseDate ?? e.year ?? ''}`
  // альбом/плейлист/артист: не играется, но красиво показывается карточкой
  return {
    id: cardId,
    provider: 'yandex',
    title: e.title,
    artist: (e.artists ?? []).map((a) => a.name).filter(Boolean).join(', ') || 'Яндекс.Музыка',
    durationSec: null,
    coverUrl: coverUrl(e),
    kind: isArtist ? 'artist' : isAlbum || e.trackCount || e.releaseDate || e.year ? 'album' : 'playlist',
    playable: false
  }
}

/** Лента: новинки, чарт, волны. Возвращает только те секции, где есть что показать. */
export async function home(token: string): Promise<Section[]> {
  const data = await call<{ result?: { blocks?: { type?: string; entities?: LandingEntity[] }[] } }>(
    '/landing3?blocks=new-releases,chart,new-playlists,mixes&lang=ru',
    token
  )
  const blocks = data.result?.blocks ?? []
  const sections: Section[] = []

  for (const [i, block] of blocks.entries()) {
    const title = BLOCK_TITLES[block.type ?? ''] ?? ''
    if (!title) continue
    const items = (block.entities ?? [])
      .map((e) => mapEntity(e, block.type ?? ''))
      .filter((t): t is Track => t !== null)
    if (!items.length) continue
    const layout: Section['layout'] = items.every((t) => t.playable) ? 'list' : 'grid'
    sections.push({ id: `ym-${block.type ?? i}`, title, layout, items })
  }
  return sections
}

/** Список всех доступных для аккаунта вариантов трека (старый XML-путь). */
export async function downloadInfoList(token: string, trackId: string): Promise<DownloadInfo[]> {
  const id = trackId.replace(/^ym:/, '')
  const info = await call<{ result?: DownloadInfo[] | { downloadInfo?: DownloadInfo } }>(
    `/tracks/${id}/download-info`,
    token
  )
  const raw = info.result
  return Array.isArray(raw) ? raw : raw?.downloadInfo ? [raw.downloadInfo] : []
}

/* ---------------------------- lossless probe ----------------------------- */

/** Публичный ключ для подписи запроса /get-file-info */
const FILE_INFO_SECRET = 'kzqU4XhfCaY6B6JTHODeq5'

export interface FileInfoResult {
  quality?: string
  codec?: string
  bitrate?: number
  transport?: string
  size?: number
  url?: string
  urls?: string[]
  /** ключ AES-128-CTR для transport: 'encraw' */
  key?: string
}

/**
 * Запрос lossless-файла. Подпись считается как hmac_sha256(secret, ts+trackId+quality+codecs+transports),
 * где codecs и transports склеены без запятых — так это устроено на сервере.
 */
export interface FileInfoOptions {
  quality?: string
  codecs?: string[]
  transports?: string[]
}

/**
 * Запрос lossless-файла. Подпись считается как hmac_sha256(secret, ts+trackId+quality+codecs+transports),
 * где codecs и transports склеены без запятых — так это устроено на сервере.
 */
export async function fileInfo(token: string, trackId: string, opts: FileInfoOptions = {}): Promise<FileInfoResult | null> {
  const id = trackId.replace(/^ym:/, '')
  const quality = opts.quality ?? 'lossless'
  const codecs = opts.codecs ?? ['flac', 'aac', 'he-aac', 'mp3']
  const transports = opts.transports ?? ['raw', 'encraw']
  const ts = Math.floor(Date.now() / 1000)
  const base = `${ts}${id}${quality}${codecs.join('')}${transports.join('')}`
  const sign = createHmac('sha256', FILE_INFO_SECRET).update(base).digest('base64').slice(0, -1)
  const qs = new URLSearchParams({
    ts: String(ts),
    trackId: id,
    quality,
    codecs: codecs.join(','),
    transports: transports.join(','),
    sign
  })
  const data = await call<{ result?: { downloadInfo?: FileInfoResult } | FileInfoResult }>(
    `/get-file-info?${qs.toString()}`,
    token,
    20000
  )
  const result = data.result as { downloadInfo?: FileInfoResult } | FileInfoResult | undefined
  if (!result) return null
  return 'downloadInfo' in result ? (result.downloadInfo ?? null) : (result as FileInfoResult)
}

/* ------------------------- доступность lossless -------------------------- */

/**
 * Яндекс отдаёт FLAC только тем аккаунтам, у которых он входит в тариф.
 * Отвечает ли он lossless — выясняем автоматически: три трека подряд без FLAC →
 * считаем, что в этом сеансе его нет, и больше не тратим запросы.
 */
let losslessMisses = 0
export type LosslessStatus = 'unknown' | 'available' | 'unavailable'
let losslessStatus: LosslessStatus = 'unknown'

export function getLosslessStatus(): LosslessStatus {
  return losslessStatus
}

async function tryLossless(token: string, trackId: string): Promise<ResolvedStream | null> {
  if (losslessStatus === 'unavailable') return null
  try {
    const fi = await fileInfo(token, trackId, { quality: 'lossless', codecs: ['flac'], transports: ['raw'] })
    if (fi?.codec === 'flac' && fi.url && fi.transport === 'raw') {
      losslessStatus = 'available'
      return { url: fi.url, mime: 'audio/flac', bitrateKbps: fi.bitrate ?? 1411, ttlMs: CACHE_TTL }
    }
    if (fi?.codec === 'flac' && fi.transport === 'encraw') {
      // FLAC есть, но зашифрован: понадобится локальный расшифровывающий прокси
      console.log('[yandex] lossless приходит как encraw — нужен decrypt-прокси, пока играем mp3')
    }
    losslessMisses += 1
    if (losslessMisses >= 3) losslessStatus = 'unavailable'
    return null
  } catch {
    losslessMisses += 1
    if (losslessMisses >= 3) losslessStatus = 'unavailable'
    return null
  }
}

/* ------------------------------ поток ------------------------------------ */

export interface DownloadInfo {
  codec?: string
  bitrateInKbps?: number
  downloadInfoUrl?: string
  direct?: boolean
  preview?: boolean
}

function xmlField(xml: string, tag: string): string {
  const m = new RegExp(`<${tag}>([^<]*)</${tag}>`).exec(xml)
  return m?.[1] ?? ''
}

const streamCache = new Map<string, { stream: ResolvedStream; expires: number }>()
const CACHE_TTL = 50_000

/**
 * Прямая ссылка считается из XML download-info:
 *   sign = md5(SALT + path[1:] + s), url = https://host/get-mp3/sign/ts+path
 * Живёт около минуты, поэтому кэш короткий и есть повтор при 403.
 */
export async function resolveStream(token: string, trackId: string): Promise<ResolvedStream> {
  const cached = streamCache.get(trackId)
  if (cached && cached.expires > Date.now()) return cached.stream

  const lossless = await tryLossless(token, trackId)
  if (lossless) {
    streamCache.set(trackId, { stream: lossless, expires: Date.now() + CACHE_TTL })
    return lossless
  }

  const list = await downloadInfoList(token, trackId)
  const usable = list.filter((d) => !d.preview && d.downloadInfoUrl)
  if (!usable.length) {
    throw new Error('Яндекс отдал только превью — похоже, Плюс не активен')
  }
  const best = usable.sort((a, b) => (b.bitrateInKbps ?? 0) - (a.bitrateInKbps ?? 0))[0]

  const res = await fetch(best.downloadInfoUrl as string)
  if (!res.ok) throw new Error(`download-info ${res.status}`)
  const xml = await res.text()

  const host = xmlField(xml, 'host')
  const path = xmlField(xml, 'path')
  const ts = xmlField(xml, 'ts')
  const s = xmlField(xml, 's')
  if (!host || !path || !ts || !s) throw new Error('Не разобрал download-info от Яндекса')

  const sign = createHash('md5').update(SIGN_SALT + path.slice(1) + s).digest('hex')
  const stream: ResolvedStream = {
    url: `https://${host}/get-mp3/${sign}/${ts}${path}`,
    mime: best.codec === 'flac' ? 'audio/flac' : 'audio/mpeg',
    bitrateKbps: best.bitrateInKbps,
    ttlMs: CACHE_TTL
  }
  streamCache.set(trackId, { stream, expires: Date.now() + CACHE_TTL })
  return stream
}

export function dropStreamCache(trackId?: string): void {
  if (trackId) streamCache.delete(trackId)
  else streamCache.clear()
}

/* --------------------------------- лайки --------------------------------- */

/**
 * Список лайкнутых треков аккаунта.
 *
 * Важно: путь должен содержать именно реальный uid из /account/status —
 * с любым другим сервер отвечает 403 ownerOtherwiseUserBindingError.
 * Возвращаются только пары { id, timestamp }, сами треки надо дотягивать.
 */
export async function likedTracks(token: string, uid: number): Promise<{ id: string; likedAt: number }[]> {
  const data = await call<{ result?: { library?: { tracks?: { id: string | number; timestamp?: string }[] } } }>(
    `/users/${uid}/likes/tracks`,
    token,
    30000
  )
  const list = data.result?.library?.tracks ?? []
  return list
    .map((t) => ({ id: String(t.id), likedAt: t.timestamp ? Date.parse(t.timestamp) : 0 }))
    .filter((t) => Boolean(t.id))
}

/** Дотягивает метаданные треков пачкой (до ~200 id за запрос). */
export async function tracksByIds(token: string, ids: string[]): Promise<{ id: string; track: Track }[]> {
  if (!ids.length) return []
  const data = await call<{ result?: YmTrack[] }>(
    `/tracks?track-ids=${ids.join(',')}&with-positions=false`,
    token,
    20000
  )
  const arr = Array.isArray(data.result) ? data.result : []
  const out: { id: string; track: Track }[] = []
  for (const raw of arr) {
    const track = mapTrack(raw)
    if (track) out.push({ id: String(raw.id), track })
  }
  return out
}

export interface TrackMeta {
  id: string
  artistId?: string
  artistName?: string
  albumId?: string
  albumTitle?: string
  year?: number
  /** все исполнители — для ссылок в старых записях библиотеки */
  artists?: { id?: string; name: string }[]
  coverUrl?: string
}

/** Метаданные пачкой: из них строятся персональные подборки (артисты, альбомы). */
export async function tracksMeta(token: string, ids: string[]): Promise<TrackMeta[]> {
  if (!ids.length) return []
  const data = await call<{ result?: YmTrack[] }>(
    `/tracks?track-ids=${ids.join(',')}&with-positions=false`,
    token,
    20000
  )
  const arr = Array.isArray(data.result) ? data.result : []
  return arr.map((raw) => {
    const artist = raw.artists?.[0]
    const album = raw.albums?.[0]
    return {
      id: String(raw.id),
      artists: (raw.artists ?? [])
        .filter((a) => a.name)
        .map((a) => ({ id: a.id ? String(a.id) : undefined, name: a.name as string })),
      coverUrl: coverUrl(raw) ?? coverUrl(album),
      artistId: artist?.id ? String(artist.id) : undefined,
      artistName: artist?.name,
      albumId: album?.id ? String(album.id) : undefined,
      albumTitle: album?.title,
      year: album?.year
    }
  })
}

/* --------------------- артисты и альбомы (для подборок) ------------------- */

/** Треки исполнителя. `/artists/{id}/tracks` отдаёт популярные сверху. */
export async function artistTracks(
  token: string,
  artistId: string,
  limit = 50,
  page = 0
): Promise<Track[]> {
  const data = await call<{ result?: { tracks?: YmTrack[] } }>(
    `/artists/${artistId}/tracks?page=${page}&page-size=${limit}`,
    token,
    20000
  )
  return (data.result?.tracks ?? [])
    .map(mapTrack)
    .filter((t): t is Track => t !== null)
}

/** Все треки альбома (сборники разбиты на volumes). */
export async function albumTracks(token: string, albumId: string): Promise<Track[]> {
  const data = await call<{ result?: { volumes?: YmTrack[][]; tracks?: YmTrack[] } }>(
    `/albums/${albumId}/with-tracks`,
    token,
    20000
  )
  const raw = data.result?.volumes?.length
    ? data.result.volumes.flat()
    : (data.result?.tracks ?? [])
  return raw.map(mapTrack).filter((t): t is Track => t !== null)
}

/** Альбомы исполнителя, новые сверху. */
export async function artistAlbums(
  token: string,
  artistId: string,
  limit = 8
): Promise<{ id: string; title: string; year?: string; artist: string; coverUrl?: string }[]> {
  const data = await call<{ result?: { albums?: (YmAlbum & { artists?: YmArtist[]; coverUri?: string })[] } }>(
    `/artists/${artistId}/direct-albums?page=0&page-size=${limit}`,
    token,
    20000
  )
  const albums = data.result?.albums ?? []
  return albums
    .filter((a) => a.id && a.title)
    .map((a) => ({
      id: String(a.id),
      title: a.title as string,
      year: a.year ? String(a.year) : undefined,
      artist: (a.artists ?? []).map((x) => x.name).filter(Boolean).join(', '),
      coverUrl: coverUrl(a)
    }))
}

/**
 * Жанровые слаги артиста (`foreignrap`, `rusrap`, `rock`…). Используются
 * только как подсказка для «Течения по жанрам» — показываем всё равно
 * нормальные названия из genres.ts.
 */
export async function artistGenres(token: string, artistId: string): Promise<string[]> {
  const data = await call<{ result?: { artist?: { genres?: unknown } } }>(
    `/artists/${artistId}`,
    token,
    10000
  )
  const genres = data?.result?.artist?.genres
  return Array.isArray(genres) ? genres.filter((g): g is string => typeof g === 'string') : []
}

/* -------------------------------- плейлисты ------------------------------- */

export interface YmPlaylistInfo {
  kind: number
  title: string
  trackCount: number
  ownerUid?: number
}

/**
 * Похожие треки: `/tracks/{id}/similar` — до 30 штук, уже отобранных Яндексом.
 * Для треков вне Яндекса не используется.
 */
export async function similarTracks(token: string, trackId: string, limit = 30): Promise<Track[]> {
  if (!/^\d+$/.test(trackId)) return []
  const data = await call<{ result?: { similarTracks?: YmTrack[] } }>(
    `/tracks/${trackId}/similar`,
    token,
    20000
  )
  return (data.result?.similarTracks ?? [])
    .map(mapTrack)
    .filter((t): t is Track => t !== null && t.playable)
    .slice(0, limit)
}

/** Свои плейлисты пользователя (`/users/{uid}/playlists/list`). */
export async function userPlaylists(token: string, uid: number): Promise<YmPlaylistInfo[]> {
  const data = await call<{ result?: unknown[] }>(`/users/${uid}/playlists/list`, token, 15000)
  const list = Array.isArray(data.result) ? data.result : []
  return list
    .map((raw) => raw as { kind?: unknown; title?: unknown; trackCount?: unknown; owner?: { uid?: unknown } })
    .filter((p) => typeof p.kind === 'number' && typeof p.title === 'string')
    .map((p) => ({
      kind: p.kind as number,
      title: String(p.title),
      trackCount: typeof p.trackCount === 'number' ? p.trackCount : 0,
      ownerUid: typeof p.owner?.uid === 'number' ? (p.owner.uid as number) : uid
    }))
}

/** Треки плейлиста: `rich-tracks=true` отдаёт сразу с артистами и обложками. */
export async function playlistTracks(token: string, uid: number, kind: number): Promise<Track[]> {
  const data = await call<{ result?: { tracks?: (YmTrack & { track?: YmTrack })[] } }>(
    `/users/${uid}/playlists/${kind}?rich-tracks=true`,
    token,
    20000
  )
  // rich-tracks кладёт трек внутрь обёртки {id, timestamp, track: {...}}
  return (data.result?.tracks ?? [])
    .map((row) => mapTrack(row.track ?? row))
    .filter((t): t is Track => t !== null)
}

/* ------------------------- страницы артиста/альбома ----------------------- */

interface YmArtistInfo {
  id?: number | string
  name?: string
  cover?: { uri?: string }
  counts?: { tracks?: number; directAlbums?: number }
}

export async function artistPage(token: string, artistId: string): Promise<BrowsePage> {
  const [info, tracks, albums, related] = await Promise.all([
    call<{ result?: { artist?: YmArtistInfo } }>(`/artists/${artistId}`, token, 15000).catch(() => null),
    artistTracks(token, artistId, 60).catch(() => [] as Track[]),
    artistAlbums(token, artistId, 12).catch(() => []),
    similarArtists(token, artistId, 12).catch(() => [])
  ])
  const artist = info?.result?.artist
  const name = artist?.name ?? tracks[0]?.artist ?? 'Артист'
  const cover = coverUrl(artist?.cover ? { coverUri: artist.cover.uri } : undefined) ?? tracks[0]?.coverUrl
  const albumsCount = artist?.counts?.directAlbums ?? albums.length
  return {
    kind: 'artist',
    id: artistId,
    title: name,
    subtitle: `${albumsCount} ${plural(albumsCount, 'альбом', 'альбома', 'альбомов')} · ${tracks.length} ${plural(
      tracks.length,
      'трек',
      'трека',
      'треков'
    )}`,
    coverUrl: cover,
    tracks,
    albums,
    related: related.map((a) => ({ id: String(a.id), name: a.name }))
  }
}

export async function albumPage(token: string, albumId: string): Promise<BrowsePage> {
  const data = await call<{
    result?: YmAlbum & { volumes?: YmTrack[][]; tracks?: YmTrack[]; artists?: YmArtist[] }
  }>(`/albums/${albumId}/with-tracks`, token, 20000)
  const r = data.result
  const raw = r?.volumes?.length ? r.volumes.flat() : (r?.tracks ?? [])
  const tracks = raw.map(mapTrack).filter((t): t is Track => t !== null)
  const artist = (r?.artists ?? []).map((a) => a.name).filter(Boolean).join(', ')
  const parts = [artist, r?.year ? String(r.year) : '', `${tracks.length} ${plural(tracks.length, 'трек', 'трека', 'треков')}`]
  return {
    kind: 'album',
    id: albumId,
    title: r?.title ?? 'Альбом',
    subtitle: parts.filter(Boolean).join(' · '),
    coverUrl: coverUrl(r) ?? tracks[0]?.coverUrl,
    tracks
  }
}

/** Похожие исполнители — основа «радио артиста». */
export async function similarArtists(
  token: string,
  artistId: string,
  limit = 12
): Promise<{ id: string; name: string }[]> {
  const data = await call<{
    result?: { similarArtists?: { id?: number | string; name?: string }[] }
  }>(`/artists/${artistId}/similar?limit=${limit}`, token, 20000)
  return (data.result?.similarArtists ?? [])
    .filter((a) => a.id && a.name)
    .map((a) => ({ id: String(a.id), name: a.name as string }))
}

/** Русское склонение по числу: 1 трек, 2 трека, 5 треков. */
export function plural(n: number, one: string, few: string, many: string): string {
  const mod100 = n % 100
  const mod10 = n % 10
  if (mod100 >= 11 && mod100 <= 14) return many
  if (mod10 === 1) return one
  if (mod10 >= 2 && mod10 <= 4) return few
  return many
}

/** Ставит или снимает лайк на стороне Яндекса. */
export async function setLike(token: string, uid: number, trackId: string, liked: boolean): Promise<void> {
  const action = liked ? 'add-multiple' : 'remove'
  await post(`/users/${uid}/likes/tracks/${action}?trackIds=${encodeURIComponent(trackId)}`, token)
}
