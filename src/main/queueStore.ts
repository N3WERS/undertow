/**
 * Очередь между запусками.
 *
 * Раньше очередь жила только в памяти рендерера: закрыл приложение — и
 * «Ничего не играет». Теперь состав очереди и текущий индекс сохраняются в
 * %APPDATA%/Undertow/queue.json, а на старте восстанавливаются в паузе: звук
 * не включается сам, но очередь уже на месте. Позиция внутри трека не
 * запоминается — после запуска любой трек начинается с начала.
 *
 * Файл небольшой (до 500 треков), пишется атомарно и с задержкой. Старше
 * двух недель очередь не восстанавливаем: за это время она уже неактуальна.
 */
import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { Track } from './providers/types'

const FILE_VERSION = 1 as const
const MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000
const MAX_TRACKS = 500

export interface SavedQueue {
  tracks: Track[]
  index: number
  shuffled: boolean
  savedAt: number
}

interface QueueFile {
  v: number
  at: number
  index: number
  shuffled: boolean
  tracks: Track[]
}

let state: QueueFile | null = null
let loaded = false
let saveTimer: ReturnType<typeof setTimeout> | null = null

function filePath(): string {
  return join(app.getPath('userData'), 'queue.json')
}

function cleanArtists(list: unknown): { id?: string; name: string }[] | undefined {
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

/** Оставляем только то, что нужно плееру и списку; мусор из файла отсекаем. */
function cleanTrack(t: Track): Track | null {
  if (!t || typeof t !== 'object') return null
  const id = typeof t.id === 'string' ? t.id : ''
  const title = typeof t.title === 'string' ? t.title.slice(0, 300) : ''
  if (!id || !title) return null
  return {
    id,
    provider: t.provider === 'yandex' ? 'yandex' : 'youtube',
    title,
    artist: String(t.artist ?? '').slice(0, 300),
    artistId: t.artistId ? String(t.artistId) : undefined,
    artists: cleanArtists(t.artists),
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

function read(): QueueFile | null {
  if (loaded) return state
  loaded = true
  try {
    const raw = readFileSync(filePath(), 'utf8')
    const parsed = JSON.parse(raw) as Partial<QueueFile>
    if (parsed.v !== FILE_VERSION || !Array.isArray(parsed.tracks)) return null
    const at = Number(parsed.at)
    if (!Number.isFinite(at) || Date.now() - at > MAX_AGE_MS) return null
    const tracks = parsed.tracks
      .map((t) => cleanTrack(t as Track))
      .filter((t): t is Track => t !== null)
      .slice(0, MAX_TRACKS)
    if (!tracks.length) return null
    const index = Math.max(0, Math.min(Math.floor(Number(parsed.index) || 0), tracks.length - 1))
    state = {
      v: FILE_VERSION,
      at,
      index,
      shuffled: Boolean(parsed.shuffled),
      tracks
    }
    return state
  } catch {
    return null
  }
}

function scheduleSave(): void {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    saveTimer = null
    flush()
  }, 500)
}

export function flush(): void {
  if (!state) return
  const file = filePath()
  try {
    const dir = dirname(file)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    const tmp = `${file}.tmp`
    writeFileSync(tmp, JSON.stringify(state), { encoding: 'utf8' })
    renameSync(tmp, file)
  } catch {
    /* диск недоступен — переживём, очередь просто не сохранится */
  }
}

/** Полная замена сохранённой очереди (при изменении состава). */
export function save(input: { tracks: Track[]; index: number; shuffled: boolean }): void {
  const tracks = input.tracks
    .map((t) => cleanTrack(t))
    .filter((t): t is Track => t !== null)
    .slice(0, MAX_TRACKS)
  if (!tracks.length) return
  state = {
    v: FILE_VERSION,
    at: Date.now(),
    index: Math.max(0, Math.min(Math.floor(input.index), tracks.length - 1)),
    shuffled: Boolean(input.shuffled),
    tracks
  }
  scheduleSave()
}

export function load(): SavedQueue | null {
  const data = read()
  if (!data) return null
  return { tracks: data.tracks, index: data.index, shuffled: data.shuffled, savedAt: data.at }
}

export function clear(): void {
  state = null
  loaded = true
  try {
    rmSync(filePath(), { force: true })
  } catch {
    /* ignore */
  }
}
