/**
 * Оркестратор провайдеров.
 *
 * Правила (заданы пользователем):
 *  - токена Яндекса нет            → только YouTube;
 *  - токен есть, Плюса нет         → только YouTube (никаких 30-секундных превью);
 *  - токен есть и Плюс активен     → Яндекс основной, YouTube дополняет.
 */
import * as fallback from '../fallback'
import * as offline from '../offline'
import { proxifyLocal } from '../audioProxy'
import * as library from '../library'
import type { LibrarySnapshot } from '../library'
import { getYandexToken, setYandexToken } from '../store'
import { ytdlpInfo } from '../ytdlp'
import * as youtube from './youtube'
import * as yandex from './yandex'
import * as soundcloud from './soundcloud'
import * as recommend from '../recommend'
import * as recPrefs from '../recPrefs'
import * as radio from '../radio'
import * as browse from '../browse'
import * as flow from '../flow'
import * as genres from '../genres'
import * as playlists from '../playlists'
import * as yandexMatch from '../yandexMatch'
import * as youtubeImport from '../youtubeImport'
import * as lyrics from '../lyrics'
import type { BrowsePage, ResolvedStream, Section, Track } from './types'

export interface ProviderState {
  youtube: {
    ready: boolean
    ytdlp: string | null
    python: string | null
    engine: 'bundled' | 'system' | 'python' | null
  }
  yandex: {
    hasToken: boolean
    valid: boolean
    login: string | null
    hasPlus: boolean
    active: boolean
    /** что реально отдаёт аккаунт: flac (lossless) или максимум mp3 320 */
    lossless: 'unknown' | 'available' | 'unavailable'
    /** uid нужен для запросов библиотеки: с чужим uid сервер отвечает 403 */
    uid: number | null
    error: string | null
  }
  primary: 'yandex' | 'youtube'
}

let yandexValid = false
let yandexPlus = false
let yandexLogin: string | null = null
let yandexUid: number | null = null
let yandexError: string | null = null
let checkedAt = 0

/** Перепроверяет токен и подписку. Вызывается при старте и после сохранения токена. */
async function refreshYandexInner(): Promise<void> {
  const token = getYandexToken()
  yandexValid = false
  yandexPlus = false
  yandexLogin = null
  yandexUid = null
  yandexError = null
  checkedAt = Date.now()
  if (!token) return

  try {
    const account = await yandex.accountStatus(token)
    yandexValid = true
    yandexLogin = account.login
    yandexUid = account.uid
    yandexPlus = account.hasPlus
    if (!account.hasPlus) {
      yandexError = 'Плюс не активен — Яндекс отключён, работает только YouTube'
    }
  } catch (e) {
    yandexError = e instanceof Error ? e.message : String(e)
  }
}

export async function getState(): Promise<ProviderState> {
  if (!checkedAt) await refreshYandex()
  const info = await ytdlpInfo()
  const active = yandexReady()
  return {
    youtube: {
      ready: Boolean(info),
      ytdlp: info?.version ?? null,
      python: info?.kind === 'python' ? info.path : info ? 'не требуется' : null,
      engine: info?.kind ?? null
    },
    yandex: {
      hasToken: Boolean(getYandexToken()),
      valid: yandexValid,
      login: yandexLogin,
      hasPlus: yandexPlus,
      active,
      lossless: yandex.getLosslessStatus(),
      uid: yandexUid,
      error: yandexError
    },
    primary: active ? 'yandex' : 'youtube'
  }
}

/** Сохраняет токен. Невалидный токен не сохраняем — возвращаем понятную ошибку. */
export async function saveYandexToken(token: string): Promise<ProviderState> {
  const trimmed = token.trim()
  if (!trimmed) throw new Error('Пустой токен')

  const account = await yandex.accountStatus(trimmed)
  setYandexToken(trimmed)
  yandexValid = true
  yandexLogin = account.login
  yandexUid = account.uid
  yandexPlus = account.hasPlus
  yandexError = account.hasPlus ? null : 'Плюс не активен — Яндекс отключён, работает только YouTube'
  checkedAt = Date.now()
  return getState()
}

export async function clearYandexToken(): Promise<ProviderState> {
  setYandexToken(null)
  yandex.dropStreamCache()
  yandexValid = false
  yandexPlus = false
  yandexLogin = null
  yandexUid = null
  yandexError = null
  checkedAt = Date.now()
  return getState()
}

/** Проверка токена: одновременно может идти только одна, остальные ждут её. */
let refreshing: Promise<void> | null = null

export function refreshYandex(): Promise<void> {
  if (refreshing) return refreshing
  refreshing = refreshYandexInner().finally(() => {
    refreshing = null
  })
  return refreshing
}

/**
 * При старте рендерер параллельно зовёт home/search/library/resolve. Проверка
 * состояния может быть ещё в процессе — тогда просто ждём её, иначе получалось
 * «проверка идёт, а флаги ещё старые» и часть вызовов работала будто без Плюса.
 */
async function ensureYandexChecked(): Promise<void> {
  if (refreshing) {
    await refreshing.catch(() => {
      /* ошибки уже в yandexError */
    })
    return
  }
  if (checkedAt) return
  await refreshYandex().catch(() => {
    /* ошибки уже в yandexError */
  })
}

function yandexReady(): boolean {
  // отладочный выключатель: UNDERTOW_NO_YANDEX=1 имитирует отключённый Яндекс,
  // не трогая сохранённый токен (нужно, чтобы проверять подмену на YouTube)
  if (process.env.UNDERTOW_NO_YANDEX === '1') return false
  return yandexValid && yandexPlus && Boolean(getYandexToken())
}

/* ------------------------------- библиотека ------------------------------ */

export function getLibrary(): LibrarySnapshot {
  return library.snapshot()
}

export interface LikeResult {
  liked: boolean
  /** если Яндекс не принял лайк, локально он всё равно сохранён */
  syncError: string | null
}

/** Лайк: всегда локально, плюс на стороне Яндекса, если трек оттуда и аккаунт активен. */
export async function likeTrack(track: Track, liked: boolean): Promise<LikeResult> {
  library.setLike(track, liked)

  if (track.provider !== 'yandex' || !yandexReady() || !yandexUid) {
    return { liked, syncError: null }
  }

  try {
    await yandex.setLike(getYandexToken() as string, yandexUid, track.id.replace(/^ym:/, ''), liked)
    return { liked, syncError: null }
  } catch (e) {
    return { liked, syncError: e instanceof Error ? e.message : String(e) }
  }
}

/* -------------------------------- течение -------------------------------- */

export async function flowStart(options?: flow.FlowOptions): Promise<{
  title: string
  seeds: flow.FlowSeed[]
  tracks: Track[]
}> {
  const result = await flow.start(options)
  // запоминаем только после удачного запуска, чтобы ошибка не сбивала выбор
  recPrefs.setFlowGenre(options?.genres?.[0])
  return result
}

/** Жанры библиотеки для чипов «Течения» (тегирование — при первом вызове). */
export async function flowGenres(): Promise<{ items: genres.GenreInfo[]; genre?: string }> {
  await genres.ensure().catch(() => undefined)
  return { items: genres.list(), genre: recPrefs.flowGenre() }
}

export function flowMore(): Promise<Track[]> {
  return flow.more()
}

export function flowInfo(): flow.FlowInfo {
  return flow.info()
}

export function flowFeedback(
  action: flow.FlowFeedback,
  track: Track
): Promise<{ tracks: Track[] }> {
  return flow.feedback(action, track)
}

export function flowNovelty(value: number): flow.FlowInfo {
  return flow.setNovelty(value)
}

export function flowSeed(action: 'include' | 'exclude', name: string): Promise<flow.FlowInfo> {
  return flow.seedAction(action, name)
}

export function flowPlayed(track: Track): void {
  flow.notePlayed(track)
}

export function flowSeeds(): { name: string; weight: number }[] {
  return flow.seeds()
}

export function flowTracks(): Track[] {
  return flow.stream()
}

export function flowDiscoveries(): { name: string; coverUrl?: string; at: number }[] {
  return flow.discoveries()
}

export function addHistory(track: Track): void {
  library.addHistory(track)
}

export function clearHistory(): void {
  library.clearHistory()
}

export interface ImportResult {
  /** сколько YouTube-копий добавилось в локальную библиотеку */
  imported: number
  /** сколько всего лайков у Яндекса */
  total: number
  /** сколько лайков стало локально */
  localTotal: number
  /** сколько треков реально искали на YouTube */
  searched: number
  /** сколько не удалось сопоставить */
  skipped: number
  /** сколько ещё не обработано */
  remaining: number
}

/**
 * Импортирует лайки из Яндекса сразу как YouTube-копии.
 * Яндекс-треки в библиотеку не добавляются.
 */
export async function importYandexLikes(): Promise<ImportResult> {
  if (!yandexReady() || !yandexUid) throw new Error('Яндекс не подключён — импортировать нечего')
  const token = getYandexToken() as string

  const remote = await yandex.likedTracks(token, yandexUid)
  const dates = new Map(remote.map((r) => [r.id, r.likedAt]))
  const entries: youtubeImport.ImportEntry[] = []

  for (let i = 0; i < remote.length; i += 100) {
    const batch = remote.slice(i, i + 100).map((m) => m.id)
    const found = await yandex.tracksByIds(token, batch)
    for (const f of found) entries.push({ track: f.track, likedAt: dates.get(f.id) || Date.now() })
  }

  const result = await youtubeImport.importTracks(entries, { limit: 0, concurrency: 6 })
  return {
    imported: result.imported,
    total: remote.length,
    localTotal: library.likedIds().length,
    searched: result.searched,
    skipped: result.skipped,
    remaining: result.remaining
  }
}

/** Импорт существующих Яндекс-лайков в YouTube: Яндекс-API не используется. */
export function importYoutubeFromYandex(limit = 20): Promise<youtubeImport.YoutubeImportResult> {
  return youtubeImport.importYoutubeFromYandex(limit)
}

/* --------------------------- варианты подмены ---------------------------- */

/** Кандидаты с YouTube для текущего яндексовского трека (кнопка «другой вариант»). */
export async function fallbackCandidates(track: Track): Promise<fallback.FallbackCandidateView[]> {
  return fallback.candidates(track)
}

/** Запоминает выбранный вариант и сбрасывает кэш ссылки на поток. */
/** Закреплён ли за треком вариант, выбранный вручную. */
export function isPinned(trackId: string): boolean {
  return fallback.pinnedVideo(trackId) !== null
}

/** Возврат к оригиналу: снимаем закрепление и забываем ссылки. */
export async function restoreOriginal(track: Track): Promise<void> {
  const pinned = fallback.pinnedVideo(track.id)
  fallback.unpin(track.id)
  yandex.dropStreamCache(track.id)
  youtube.dropStreamCache(track.id)
  if (pinned) youtube.dropStreamCache(`yt:${pinned}`)
}

export async function pickFallback(track: Track, candidate: fallback.FallbackCandidateView): Promise<void> {
  await fallback.pin(track, candidate)
  yandex.dropStreamCache(track.id)
  youtube.dropStreamCache(track.id)
}

/**
 * Прогрев по наведению: пока пользователь думает, мы уже ищем пару и ссылку.
 * Для YouTube-треков это просто прогрев ссылки, для яндексовских без Плюса —
 * поиск копии, который иначе занял бы секунды после клика.
 */
const prewarming = new Set<string>()

export async function prewarm(track: Track): Promise<void> {
  if (prewarming.has(track.id)) return
  prewarming.add(track.id)
  try {
    if (track.provider === 'yandex' && !yandexReady()) {
      await fallback.toYoutube(track)
      return
    }
    await resolveStream(track.id, false, track, 0)
  } catch {
    // прогрев — необязательная оптимизация
  } finally {
    prewarming.delete(track.id)
  }
}

/* --------------------------------- чарт ---------------------------------- */

export function topChart(
  scope: youtube.ChartScope = 'ru',
  force = false
): Promise<youtube.TopChart> {
  return youtube.topChart(scope, force)
}

/* --------------------------------- лента --------------------------------- */

export async function home(force = false): Promise<Section[]> {
  await ensureYandexChecked()
  const sections: Section[] = []

  if (yandexReady()) {
    const token = getYandexToken() as string

    // сначала личные подборки из библиотеки, ленте остаёмся фолбэком
    try {
      if (force) recommend.invalidate()
      sections.push(...(await recommend.build({ token, force })))
    } catch (e) {
      yandexError = e instanceof Error ? e.message : String(e)
      console.error('[recommend]', yandexError)
    }

    if (sections.length < 2) {
      try {
        sections.push(...(await yandex.home(token)))
      } catch (e) {
        yandexError = e instanceof Error ? e.message : String(e)
      }
    }
  }

  // без Яндекса персональные секции строятся из библиотеки и поиска YouTube
  if (!sections.length) {
    const local = await recommend.localHome().catch(() => [] as Section[])
    sections.push(...local)
  }

  try {
    const yt = await youtube.explore()
    // при персональных подборках хватает одной секции YouTube для свежести
    sections.push(...(sections.length ? yt.slice(0, 2) : yt))
  } catch (e) {
    if (!sections.length) throw e
  }

  // скрытые пользователем секции убираем в самом конце, чтобы это работало
  // и для персональных подборок, и для секций YouTube
  return recommend.applyPrefs(sections)
}

/**
 * Дозаполняет библиотеку метаданными из Яндекса: старые записи хранились без
 * списка исполнителей (и без artistId), из-за чего у них не работали ссылки.
 * Работает батчами по 100, обновляет и лайки, и историю.
 */
export async function enrichLibrary(): Promise<LibrarySnapshot> {
  await ensureYandexChecked()
  const token = getYandexToken()
  const snap = library.snapshot()
  if (!token || !yandexReady()) return snap

  const missing: string[] = []
  for (const t of [...snap.likes, ...snap.history]) {
    if (t.provider !== 'yandex') continue
    // трек считается полным, если есть исполнители и либо id альбома,
    // либо альбома у него нет вовсе
    if (t.artistId && t.artists?.length && (t.albumId || !t.album) && t.year) continue
    missing.push(t.id.replace(/^ym:/, ''))
  }
  const ids = [...new Set(missing)].slice(0, 800)
  if (!ids.length) return snap

  const patches = new Map<string, library.TrackPatch>()
  for (let i = 0; i < ids.length; i += 100) {
    const metas = await yandex
      .tracksMeta(token, ids.slice(i, i + 100))
      .catch(() => [] as Awaited<ReturnType<typeof yandex.tracksMeta>>)
    for (const m of metas) {
      patches.set(`ym:${m.id}`, {
        artistId: m.artistId,
        artists: m.artists,
        album: m.albumTitle,
        year: m.year ? String(m.year) : undefined,
        albumId: m.albumId,
        coverUrl: m.coverUrl
      })
    }
  }

  const changed = library.patchTracks(patches)
  if (changed) console.log('[library] обогащено треков:', changed)
  return library.snapshot()
}

/**
 * Дозаполняет длительности старых записей: до починки parseDuration треки
 * YouTube сохранялись в историю без durationSec, и в списках было «—».
 * Батчами по 40, максимум 240 треков за запуск; при изменении сбрасываем
 * кэш главной, чтобы подписи обновились и там.
 */
export async function backfillDurations(limit = 240): Promise<number> {
  const snap = library.snapshot()
  const missing: string[] = []
  const seen = new Set<string>()
  for (const t of [...snap.history, ...snap.likes]) {
    if (t.provider !== 'youtube') continue
    if (t.durationSec && t.durationSec > 0) continue
    const vid = t.id.replace(/^yt:/, '')
    if (!/^[\w-]{11}$/.test(vid) || seen.has(vid)) continue
    seen.add(vid)
    missing.push(vid)
    if (missing.length >= limit) break
  }
  if (!missing.length) return 0

  let changed = 0
  for (let i = 0; i < missing.length; i += 40) {
    const found = await youtube.durations(missing.slice(i, i + 40)).catch(() => new Map<string, number>())
    if (!found.size) continue
    const patches = new Map<string, library.TrackPatch>()
    for (const [vid, sec] of found) patches.set(`yt:${vid}`, { durationSec: sec })
    changed += library.patchTracks(patches)
  }
  if (changed) {
    console.log('[library] дозаполнены длительности:', changed)
    recommend.invalidate()
  }
  return changed
}

/* ------------------------------ поиск по разделам ------------------------- */

export interface SearchAll {
  tracks: Track[]
  albums: { id: string; title: string; year?: string; coverUrl?: string; type?: 'single' | 'ep' | 'album' }[]
  artists: { id: string; name: string; coverUrl?: string }[]
  playlists: { id: string; title: string; subtitle?: string; coverUrl?: string }[]
}

/**
 * Треки берём из Яндекса, если он активен (качество и метаданные лучше),
 * альбомы и артисты — всегда из YouTube Music: без токена это единственный
 * источник, который отдаёт все три разреза сразу.
 */
/** Обычный YouTube: каверы и пользовательские загрузки, которых нет в YouTube Music. */
export async function searchYoutube(query: string, limit = 20): Promise<Track[]> {
  const term = String(query ?? '').trim()
  if (!term) return []
  return youtube.search(term, Math.max(1, Math.min(40, Math.floor(limit) || 20)))
}

/** SoundCloud ищем отдельно: каталог не пересекается с YouTube Music. */
export async function soundcloudSearch(query: string, limit = 20, offset = 0): Promise<Track[]> {
  const term = String(query ?? '').trim()
  if (!term) return []
  return soundcloud.search(
    term,
    Math.max(1, Math.min(40, Math.floor(limit) || 20)),
    Math.max(0, Math.floor(offset) || 0)
  )
}

/** Догрузка следующей порции поиска: те же треки, но глубже выдачи. */
export async function searchMore(query: string, offset: number, limit = 20): Promise<Track[]> {
  const term = String(query ?? '').trim()
  const start = Math.max(0, Math.floor(offset) || 0)
  const size = Math.max(1, Math.min(20, Math.floor(limit) || 20))
  if (!term) return []
  const all = await youtube.search(term, Math.min(100, start + size + 10))
  return all.slice(start, start + size)
}



export async function searchAll(query: string): Promise<SearchAll> {
  const term = String(query ?? '').trim()
  if (!term) return { tracks: [], albums: [], artists: [], playlists: [] }
  // Весь каталог — YouTube Music, чтобы трек, альбом и артист были из одного
  // источника. Яндекс тут только источник звука, когда подключён Плюс.
  const music = await youtube
    .musicSearchAll(term)
    .catch(() => ({ tracks: [] as Track[], albums: [], artists: [], playlists: [] }))
  let tracks: Track[] = music.tracks.map((t, index) => ({
    ...t,
    catalog: true,
    catalogRank: index,
    official: !youtube.DERIVATIVE_TITLE.test(`${t.title} ${t.artist}`)
  }))
  if (!tracks.length) {
    tracks = await youtube.search(term, 20).catch(() => [] as Track[])
  }
  return {
    tracks: tracks.slice(0, 30),
    albums: music.albums,
    artists: music.artists,
    playlists: music.playlists ?? []
  }
}

/* --------------------------------- тексты --------------------------------- */

export async function lyricsOf(track: Track): Promise<lyrics.Lyrics | null> {
  return lyrics.get(track)
}

export async function lyricsHas(track: Track): Promise<boolean> {
  return lyrics.has(track)
}

/* -------------------------------- плейлисты ------------------------------- */

export function playlistList(): playlists.PlaylistSummary[] {
  return playlists.list()
}

export function playlistGet(id: string): playlists.Playlist | null {
  return playlists.get(String(id))
}

export function playlistCreate(title: string): playlists.Playlist {
  return playlists.create(String(title ?? ''))
}

export function playlistRename(id: string, title: string): playlists.Playlist | null {
  return playlists.rename(String(id), String(title ?? ''))
}

export function playlistRemove(id: string): boolean {
  return playlists.remove(String(id))
}

export function playlistAdd(id: string, tracks: Track[]): number {
  return playlists.addTracks(String(id), Array.isArray(tracks) ? tracks : [])
}

export function playlistRemoveTrack(id: string, trackId: string): playlists.Playlist | null {
  return playlists.removeTrack(String(id), String(trackId))
}

export function playlistReorder(id: string, from: number, to: number): playlists.Playlist | null {
  return playlists.reorder(String(id), Number(from), Number(to))
}

export function playlistExport(): string {
  return playlists.exportJson()
}

/**
 * Импорт своих плейлистов из Яндекса. Одним списком, без выбора: так проще
 * и не нужно строить отдельный экран. Существующие названия пропускаем.
 */
export async function importYandexPlaylists(): Promise<{
  created: number
  skipped: number
  titles: string[]
}> {
  await ensureYandexChecked()
  const token = getYandexToken()
  if (!token || !yandexReady() || !yandexUid) {
    throw new Error('Импорт плейлистов доступен при подключённом Яндексе с Плюсом')
  }
  const remote = await yandex.userPlaylists(token, yandexUid)
  const existing = new Set(playlists.list().map((p) => p.title.toLowerCase()))
  const titles: string[] = []
  let skipped = 0
  for (const p of remote) {
    if (existing.has(p.title.toLowerCase())) {
      skipped++
      continue
    }
    const tracks = await yandex.playlistTracks(token, yandexUid, p.kind).catch(() => [] as Track[])
    if (!tracks.length) {
      skipped++
      continue
    }
    playlists.create(p.title, tracks)
    titles.push(p.title)
  }
  return { created: titles.length, skipped, titles }
}

/* ---------------------------- обратная связь ----------------------------- */

export function hideSection(sectionId: string): string[] {
  return recPrefs.hide(sectionId)
}

export function hiddenSections(): string[] {
  return recPrefs.hidden()
}

export function clearHiddenSections(): string[] {
  return recPrefs.clearHidden()
}

/* --------------------------------- поиск --------------------------------- */


/* ------------------------ страницы артиста/альбома ----------------------- */

/** Яндекс-идентификаторы числовые; у YouTube они вида `UC…` / `MPREb…`. */
function isYmArtistId(id: string): boolean {
  return /^(ym-artist:)?[0-9]+$/.test(id)
}

function isYmAlbumId(id: string): boolean {
  return /^(ym-album:)?[0-9]+$/.test(id)
}

export interface PageRef {
  id?: string
  name?: string
}

/**
 * Страница артиста: с Яндексом — настоящая (все треки и альбомы), без него —
 * поиск по имени на YouTube. Поэтому ссылки на исполнителей работают всегда.
 */
export async function artistPage(ref: PageRef): Promise<BrowsePage> {
  await ensureYandexChecked()
  const token = getYandexToken()
  const id = ref.id ? String(ref.id) : ''
  // id с YouTube (`UC…`, `yt-artist:…`) Яндексу отдавать нельзя: он отвечает
  // 200 и пустой страницей «Артист», из-за чего ссылка вела в пустоту
  if (token && yandexReady() && isYmArtistId(id)) {
    try {
      const page = await yandex.artistPage(token, id)
      if (page.tracks.length || page.albums?.length || page.related?.length) return page
    } catch (e) {
      if (!ref.name) throw e
    }
  }
  if (!ref.name && !ref.id) throw new Error('Нет данных об артисте')
  return browse.youtubeArtistPage(ref)
}

/**
 * Страница альбома: с Яндексом — настоящий альбом по id, без него — поиск
 * «артист + название» (альбомов у YouTube нет, честно показываем треки).
 */
export function playlistPage(id: string): Promise<BrowsePage> {
  return browse.youtubePlaylistPage(String(id ?? ''))
}

export async function albumPage(ref: {
  id?: string
  title?: string
  artist?: string
  trackTitle?: string
}): Promise<BrowsePage> {
  await ensureYandexChecked()
  const token = getYandexToken()
  const id = ref.id ? String(ref.id) : ''
  if (token && yandexReady() && isYmAlbumId(id)) {
    try {
      const page = await yandex.albumPage(token, id)
      if (page.tracks.length) return page
    } catch (e) {
      if (!ref.title) throw e
    }
  }
  if (!ref.id && !ref.title) throw new Error('Нет данных об альбоме')
  return browse.youtubeAlbumPage(ref)
}

/**
 * «Радио артиста». С Яндексом — топ + похожие из API; без него — топ из
 * YouTube-поиска и соседи из библиотеки (радио остаётся личным).
 */
export async function artistRadio(ref: PageRef): Promise<{ title: string; tracks: Track[] }> {
  await ensureYandexChecked()
  const token = getYandexToken()
  const id = ref.id ? String(ref.id) : ''
  if (token && yandexReady() && isYmArtistId(id)) {
    try {
      const res = await radio.start(token, id)
      if (res.tracks.length) return res
    } catch (e) {
      if (!ref.name) throw e
    }
  }
  if (!ref.name && !ref.id) throw new Error('Нет данных об артисте')
  return radio.startLocal(ref)
}

/** Дозаправка играющего радио (режим определяется сессией в main). */
/** «Похожее» на трек: работает и на Яндексе, и на YouTube. */
export async function trackSimilar(track: Track): Promise<{ title: string; tracks: Track[] }> {
  await ensureYandexChecked()
  const token = getYandexToken()
  return radio.similar(token && yandexReady() ? token : null, track)
}

export async function radioMore(ref: PageRef): Promise<Track[]> {
  await ensureYandexChecked()
  const token = getYandexToken()
  return radio.more(token && yandexReady() ? token : null, ref)
}

/* --------------------------------- поток --------------------------------- */

/** Dev-диагностика: прогоняет матрицу параметров и показывает, что реально отдаёт сервер. */
export async function debugFileInfo(trackId: string): Promise<unknown> {
  const token = getYandexToken()
  if (!token) throw new Error('Нет токена Яндекса')

  const combos: { label: string; opts: yandex.FileInfoOptions }[] = [
    { label: 'lossless/flac/raw', opts: { quality: 'lossless', codecs: ['flac'], transports: ['raw'] } },
    { label: 'lossless/flac/raw+encraw', opts: { quality: 'lossless', codecs: ['flac'], transports: ['raw', 'encraw'] } },
    { label: 'lossless/all/raw+encraw', opts: { quality: 'lossless', codecs: ['flac', 'aac', 'he-aac', 'mp3'], transports: ['raw', 'encraw'] } },
    { label: 'lossless/all/encraw', opts: { quality: 'lossless', codecs: ['flac', 'aac', 'he-aac', 'mp3'], transports: ['encraw'] } }
  ]

  const out: unknown[] = []
  try {
    const dl = await yandex.downloadInfoList(token, trackId)
    out.push({
      downloadInfo: dl.map((d) => ({ codec: d.codec, kbps: d.bitrateInKbps, preview: Boolean(d.preview) }))
    })
  } catch (e) {
    out.push({ downloadInfo: e instanceof Error ? e.message : String(e) })
  }

  for (const { label, opts } of combos) {
    try {
      const res = await yandex.fileInfo(token, trackId, opts)
      out.push({
        req: label,
        quality: res?.quality ?? null,
        codec: res?.codec ?? null,
        bitrate: res?.bitrate ?? null,
        transport: res?.transport ?? null,
        size: res?.size ?? null,
        hasKey: Boolean(res?.key),
        urlTail: res?.url ? res.url.split('/').slice(-1)[0] : null
      })
    } catch (e) {
      out.push({ req: label, error: e instanceof Error ? e.message : String(e) })
    }
  }
  return out
}

export async function resolveStream(trackId: string, fresh = false, meta?: Track, priority = 1): Promise<ResolvedStream> {
  // сохранённая копия главнее любого источника: играет без сети и без Плюса
  const local = await offline.localStream(trackId)
  if (local) {
    const { filePath, ...rest } = local
    return { ...rest, url: proxifyLocal(filePath, local.mime) }
  }
  if (trackId.startsWith('sc:')) return soundcloud.resolve(trackId, fresh)
  // fresh означает «дай другую ссылку»: без сброса кэша повторный resolve
  // вернул бы тот же самый недоступный rr-хост.
  if (fresh && trackId.startsWith('yt:')) youtube.dropStreamCache(trackId)
  if (trackId.startsWith('ym:')) await ensureYandexChecked()
  if (trackId.startsWith('ym:')) {
    // выбранный вручную вариант важнее источника: даже при живом Яндексе
    // играем ту копию, которую пользователь закрепил через «другой вариант»
    const pinnedYm = fresh ? null : fallback.pinnedVideo(trackId)
    if (pinnedYm) {
      const st = await youtube.resolveStream(`yt:${pinnedYm}`, fresh, priority)
      const m = await fallback.mappingFor(trackId)
      return {
        ...st,
        variant: true,
        variantVideoId: pinnedYm,
        fallbackMatched: m ? { title: m.title, artist: m.artist } : undefined
      }
    }

    const token = getYandexToken()
    const canYandex = Boolean(token) && yandexReady()

    if (canYandex) {
      if (fresh) yandex.dropStreamCache(trackId)
      try {
        const st = await yandex.resolveStream(token as string, trackId)
        return { ...st, source: 'yandex' }
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e)
        // Превью вместо трека = Плюс перестал действовать: гасим Яндекс до перепроверки
        if (message.includes('превью')) {
          yandexPlus = false
          yandexError = 'Яндекс вернул превью вместо трека — Плюс не активен, переключаюсь на YouTube'
        }
        if (!meta) throw e
        console.log('[fallback] Яндекс не отдал трек, ищу на YouTube:', message)
      }
    } else if (!meta) {
      throw new Error('Яндекс недоступен: нет токена или Плюса')
    }

    // Яндекс отключён или сломался — подменяем трек найденной копией на YouTube
    const fb = await fallback.toYoutube(meta as Track, fresh)
    return {
      ...fb.stream,
      fallbackTitle: `${fb.matched.artist} — ${fb.matched.title}`
    }
  }
  // YouTube-трек: если пользователь выбрал другую копию, играем её
  const pinned = fallback.pinnedVideo(trackId)
  if (pinned && trackId !== `yt:${pinned}`) {
    const st = await youtube.resolveStream(`yt:${pinned}`, false, priority)
    const mapping = await fallback.mappingFor(trackId)
    return {
      ...st,
      variant: true,
      variantVideoId: pinned,
      fallbackMatched: mapping ? { title: mapping.title, artist: mapping.artist } : undefined
    }
  }

  // Метаданные всегда из YouTube Music, но если есть Плюс и этот же трек
  // нашёлся в Яндексе — звук берём оттуда: там MP3 320 против Opus ~160.
  if (meta) {
    await ensureYandexChecked()
    const token = getYandexToken()
    if (token && yandexReady()) {
      const playYandex = async (ymId: string): Promise<ResolvedStream | null> => {
        try {
          const st = await yandex.resolveStream(token, ymId)
          return { ...st, source: 'yandex' }
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e)
          if (message.includes('превью')) {
            yandexPlus = false
            yandexError = 'Яндекс вернул превью вместо трека — Плюс не активен, играю с YouTube'
          }
          return null
        }
      }

      const fromYandex = async (): Promise<ResolvedStream | null> => {
        let ymId = yandexMatch.cached(meta)
        if (!ymId) ymId = await yandexMatch.toYandex(token as string, meta)
        return ymId ? playYandex(ymId) : null
      }

      // YouTube резолвим сразу: если Яндекс задумался, стартуем с него, а не
      // держим полоску на нуле. Секунда — предел, после которого ожидание
      // переключения уже выглядит как зависший плеер.
      const yt = youtube.resolveStream(trackId, fresh, priority)
      void yt.catch(() => null)
      const fast = await Promise.race([
        fromYandex(),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 1000))
      ])
      if (fast) return fast
      return await yt
    }
  }

  return youtube.resolveStream(trackId, fresh, priority)
}
