/**
 * Локальная библиотека: лайки и история прослушивания.
 *
 * Простой JSON-файл в %APPDATA%/Undertow/library.json: для личного клиента
 * на тысячи записей этого достаточно, а нативной сборки (better-sqlite3)
 * не требуется — нечему ломаться при обновлении Electron.
 *
 * Запись атомарная (tmp + rename) и с задержкой, чтобы пачка лайков
 * не дёргала диск на каждый клик.
 */
import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { Track } from './providers/types'

export interface LikedEntry {
  track: Track
  likedAt: number
}

export interface HistoryEntry {
  track: Track
  playedAt: number
}

export interface LibraryFile {
  version: 1
  likes: LikedEntry[]
  history: HistoryEntry[]
}

export interface LibrarySnapshot {
  likes: Track[]
  history: Track[]
  /** id трека → когда играл последний раз (мс). Нужно подборкам на главной. */
  playedAt: Record<string, number>
  stats: { likes: number; history: number; updatedAt: number | null }
}

const MAX_HISTORY = 2000
const FILE_VERSION = 1 as const

let cache: LibraryFile | null = null
let saveTimer: ReturnType<typeof setTimeout> | null = null
let updatedAt: number | null = null

function filePath(): string {
  return join(app.getPath('userData'), 'library.json')
}

function empty(): LibraryFile {
  return { version: FILE_VERSION, likes: [], history: [] }
}

function sanitizeArtists(list: unknown): { id?: string; name: string }[] | undefined {
  if (!Array.isArray(list)) return undefined
  const out = list
    .map((a) => {
      const raw = a as { id?: unknown; name?: unknown } | null
      if (!raw || typeof raw !== 'object') return null
      const name = typeof raw.name === 'string' ? raw.name.slice(0, 200) : ''
      if (!name) return null
      const entry: { id?: string; name: string } = { name }
      if (raw.id) entry.id = String(raw.id)
      return entry
    })
    .filter((a): a is { id?: string; name: string } => a !== null)
    .slice(0, 12)
  return out.length ? out : undefined
}

function sanitizeTrack(t: Track): Track {
  return {
    id: String(t.id),
    provider: t.provider === 'yandex' ? 'yandex' : 'youtube',
    title: String(t.title ?? '').slice(0, 300),
    artist: String(t.artist ?? '').slice(0, 300),
    artistId: t.artistId ? String(t.artistId) : undefined,
    artists: sanitizeArtists(t.artists),
    album: t.album ? String(t.album).slice(0, 300) : undefined,
    year: t.year ? String(t.year).slice(0, 4) : undefined,
    albumId: t.albumId ? String(t.albumId) : undefined,
    durationSec: typeof t.durationSec === 'number' && Number.isFinite(t.durationSec) ? t.durationSec : null,
    coverUrl: typeof t.coverUrl === 'string' ? t.coverUrl : undefined,
    kind: t.kind ?? 'song',
    subtitle: t.subtitle ? String(t.subtitle).slice(0, 300) : undefined,
    playable: t.playable !== false
  }
}

function load(): LibraryFile {
  if (cache) return cache
  try {
    const raw = readFileSync(filePath(), 'utf8')
    const parsed = JSON.parse(raw) as Partial<LibraryFile>
    cache = {
      version: FILE_VERSION,
      likes: Array.isArray(parsed.likes) ? (parsed.likes as LikedEntry[]).filter((e) => e?.track?.id) : [],
      history: Array.isArray(parsed.history) ? (parsed.history as HistoryEntry[]).filter((e) => e?.track?.id) : []
    }
  } catch {
    cache = empty()
  }
  return cache
}

function scheduleSave(): void {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    saveTimer = null
    flush()
  }, 250)
}

export function flush(): void {
  const data = load()
  const file = filePath()
  try {
    const dir = dirname(file)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    const tmp = `${file}.tmp`
    writeFileSync(tmp, JSON.stringify(data, null, 2), { encoding: 'utf8' })
    renameSync(tmp, file)
    updatedAt = Date.now()
  } catch (e) {
    console.error('[library] не удалось сохранить:', e instanceof Error ? e.message : e)
  }
}

/* --------------------------------- лайки --------------------------------- */

export function likedIds(): string[] {
  return load().likes.map((e) => e.track.id)
}

export function isLiked(trackId: string): boolean {
  return load().likes.some((e) => e.track.id === trackId)
}

/** Ставит или снимает лайк. Возвращает новое состояние. */
export function setLike(track: Track, liked: boolean): boolean {
  const data = load()
  const exists = data.likes.some((e) => e.track.id === track.id)
  if (liked && !exists) {
    data.likes.unshift({ track: sanitizeTrack(track), likedAt: Date.now() })
  } else if (!liked && exists) {
    data.likes = data.likes.filter((e) => e.track.id !== track.id)
  }
  scheduleSave()
  return liked
}

/** Массовое добавление (импорт из Яндекса). Возвращает число реально новых. */
export function mergeLikes(entries: { track: Track; likedAt?: number }[]): number {
  const data = load()
  const known = new Set(data.likes.map((e) => e.track.id))
  let added = 0
  for (const e of entries) {
    if (!e?.track?.id || known.has(e.track.id)) continue
    known.add(e.track.id)
    data.likes.push({ track: sanitizeTrack(e.track), likedAt: e.likedAt ?? Date.now() })
    added += 1
  }
  if (added) {
    // свежие лайки сверху: сортируем по времени проставления
    data.likes.sort((a, b) => b.likedAt - a.likedAt)
    scheduleSave()
    flush()
  }
  return added
}

export function clearLikes(): void {
  const data = load()
  data.likes = []
  scheduleSave()
  flush()
}

/* -------------------------------- история -------------------------------- */

export function addHistory(track: Track): void {
  const data = load()
  const clean = sanitizeTrack(track)
  data.history = data.history.filter((e) => e.track.id !== clean.id)
  data.history.unshift({ track: clean, playedAt: Date.now() })
  if (data.history.length > MAX_HISTORY) data.history.length = MAX_HISTORY
  scheduleSave()
}

export function clearHistory(): void {
  const data = load()
  data.history = []
  scheduleSave()
  flush()
}

/* ------------------------------- снимок ---------------------------------- */

export interface TrackPatch {
  durationSec?: number | null
  artistId?: string
  artists?: { id?: string; name: string }[]
  album?: string
  year?: string
  albumId?: string
  coverUrl?: string
}

/**
 * Дозаполняет метаданные уже сохранённых треков: старые записи лежали без
 * списка исполнителей, поэтому в них не работали ссылки на артистов.
 * Возвращает число реально изменённых треков.
 */
export function patchTracks(patches: Map<string, TrackPatch>): number {
  if (!patches.size) return 0
  const data = load()
  let changed = 0
  const apply = (t: Track): Track => {
    const patch = patches.get(t.id)
    if (!patch) return t
    const next = sanitizeTrack({ ...t, ...patch })
    if (JSON.stringify(next) !== JSON.stringify(t)) changed++
    return next
  }
  data.likes = data.likes.map((e) => ({ ...e, track: apply(e.track) }))
  data.history = data.history.map((e) => ({ ...e, track: apply(e.track) }))
  if (changed) {
    updatedAt = Date.now()
    scheduleSave()
  }
  return changed
}

export function snapshot(): LibrarySnapshot {
  const data = load()
  return {
    likes: data.likes.map((e) => e.track),
    history: data.history.map((e) => e.track),
    playedAt: Object.fromEntries(data.history.map((e) => [e.track.id, e.playedAt])),
    stats: { likes: data.likes.length, history: data.history.length, updatedAt }
  }
}
