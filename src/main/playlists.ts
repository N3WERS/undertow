/**
 * Локальные плейлисты: собственные списки треков, независимые от очереди.
 *
 * Хранятся в `%APPDATA%/Undertow/playlists.json` вместе с копиями треков —
 * так плейлист открывается мгновенно и не зависит от того, жив ли ещё трек
 * в Яндексе. Дубликаты внутри плейлиста отсекаются по `id`.
 *
 * Импорт из Яндекса делает providers/index (нужен токен и uid), сюда приходят
 * уже готовые Track[].
 */
import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import type { Track } from './providers/types'

export interface PlaylistSummary {
  id: string
  title: string
  count: number
  coverUrl?: string
  updatedAt: number
}

export interface Playlist extends PlaylistSummary {
  tracks: Track[]
  createdAt: number
}

/** Как плейлист лежит в файле: без вычисляемых count/coverUrl. */
interface Stored {
  id: string
  title: string
  tracks: Track[]
  createdAt: number
  updatedAt: number
}

interface Store {
  v: number
  items: Stored[]
}

const FILE_VERSION = 1
const MAX_PLAYLISTS = 200
const MAX_TRACKS = 3000
const MAX_TITLE = 80

let cache: Store | null = null

function file(): string {
  return path.join(app.getPath('userData'), 'playlists.json')
}

function sanitizeTrack(raw: Track): Track | null {
  if (!raw || typeof raw.id !== 'string' || !raw.title) return null
  return {
    id: raw.id,
    provider: raw.provider === 'yandex' ? 'yandex' : 'youtube',
    title: String(raw.title).slice(0, 300),
    artist: String(raw.artist ?? '').slice(0, 300),
    artistId: raw.artistId ? String(raw.artistId) : undefined,
    artists: Array.isArray(raw.artists)
      ? raw.artists
          .filter((a) => a && typeof a.name === 'string')
          .slice(0, 12)
          .map((a) => ({ id: a.id ? String(a.id) : undefined, name: String(a.name).slice(0, 200) }))
      : undefined,
    album: raw.album ? String(raw.album).slice(0, 300) : undefined,
    year: raw.year ? String(raw.year).slice(0, 4) : undefined,
    albumId: raw.albumId ? String(raw.albumId) : undefined,
    durationSec:
      typeof raw.durationSec === 'number' && Number.isFinite(raw.durationSec) ? raw.durationSec : null,
    coverUrl: typeof raw.coverUrl === 'string' ? raw.coverUrl : undefined,
    kind: raw.kind ?? 'song',
    subtitle: raw.subtitle ? String(raw.subtitle).slice(0, 300) : undefined,
    playable: raw.playable !== false
  }
}

function load(): Store {
  if (cache) return cache
  try {
    const parsed = JSON.parse(fs.readFileSync(file(), 'utf8')) as Partial<Store>
    const items: Stored[] = Array.isArray(parsed.items)
      ? parsed.items
          .filter((p) => p && typeof p.id === 'string' && typeof p.title === 'string')
          .map((p) => ({
            id: p.id,
            title: p.title,
            tracks: Array.isArray(p.tracks) ? p.tracks.map(sanitizeTrack).filter((t): t is Track => Boolean(t)) : [],
            createdAt: typeof p.createdAt === 'number' ? p.createdAt : Date.now(),
            updatedAt: typeof p.updatedAt === 'number' ? p.updatedAt : Date.now()
          }))
      : []
    cache = { v: FILE_VERSION, items }
  } catch {
    cache = { v: FILE_VERSION, items: [] }
  }
  return cache
}

function save(): void {
  if (!cache) return
  try {
    const target = file()
    fs.writeFileSync(`${target}.tmp`, JSON.stringify(cache), 'utf8')
    fs.renameSync(`${target}.tmp`, target)
  } catch (e) {
    console.error('[playlists] не удалось сохранить:', e instanceof Error ? e.message : e)
  }
}

function summary(p: Stored): PlaylistSummary {
  return {
    id: p.id,
    title: p.title,
    count: p.tracks.length,
    coverUrl: p.tracks.find((t) => t.coverUrl)?.coverUrl,
    updatedAt: p.updatedAt
  }
}

export function list(): PlaylistSummary[] {
  return load()
    .items.slice()
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .map(summary)
}

export function get(id: string): Playlist | null {
  const p = load().items.find((x) => x.id === id)
  return p ? { ...summary(p), tracks: [...p.tracks], createdAt: p.createdAt } : null
}

export function create(title: string, tracks: Track[] = []): Playlist {
  const store = load()
  const clean = tracks.map(sanitizeTrack).filter((t): t is Track => Boolean(t))
  const playlist: Stored = {
    id: `pl_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    title: (title.trim() || 'Новый плейлист').slice(0, MAX_TITLE),
    tracks: dedupe(clean),
    createdAt: Date.now(),
    updatedAt: Date.now()
  }
  store.items.unshift(playlist)
  if (store.items.length > MAX_PLAYLISTS) store.items.length = MAX_PLAYLISTS
  save()
  return { ...summary(playlist), tracks: playlist.tracks, createdAt: playlist.createdAt }
}

export function rename(id: string, title: string): Playlist | null {
  const p = load().items.find((x) => x.id === id)
  if (!p) return null
  const next = title.trim().slice(0, MAX_TITLE)
  if (next) {
    p.title = next
    p.updatedAt = Date.now()
    save()
  }
  return get(id)
}

export function remove(id: string): boolean {
  const store = load()
  const before = store.items.length
  store.items = store.items.filter((p) => p.id !== id)
  if (store.items.length !== before) {
    save()
    return true
  }
  return false
}

function dedupe(tracks: Track[]): Track[] {
  const seen = new Set<string>()
  const out: Track[] = []
  for (const t of tracks) {
    if (seen.has(t.id)) continue
    seen.add(t.id)
    out.push(t)
    if (out.length >= MAX_TRACKS) break
  }
  return out
}

/** Добавляет треки в конец, пропуская уже имеющиеся. Возвращает сколько новых. */
export function addTracks(id: string, tracks: Track[]): number {
  const p = load().items.find((x) => x.id === id)
  if (!p) return 0
  const have = new Set(p.tracks.map((t) => t.id))
  let added = 0
  for (const raw of tracks) {
    const t = sanitizeTrack(raw)
    if (!t || have.has(t.id) || p.tracks.length >= MAX_TRACKS) continue
    have.add(t.id)
    p.tracks.push(t)
    added++
  }
  if (added) {
    p.updatedAt = Date.now()
    save()
  }
  return added
}

export function removeTrack(id: string, trackId: string): Playlist | null {
  const p = load().items.find((x) => x.id === id)
  if (!p) return null
  const before = p.tracks.length
  p.tracks = p.tracks.filter((t) => t.id !== trackId)
  if (p.tracks.length !== before) {
    p.updatedAt = Date.now()
    save()
  }
  return get(id)
}

/** Перемещение внутри плейлиста (`to` — индекс в списке после удаления). */
export function reorder(id: string, from: number, to: number): Playlist | null {
  const p = load().items.find((x) => x.id === id)
  if (!p) return null
  if (from < 0 || from >= p.tracks.length || to < 0 || to >= p.tracks.length || from === to) return get(id)
  const [row] = p.tracks.splice(from, 1)
  p.tracks.splice(to, 0, row)
  p.updatedAt = Date.now()
  save()
  return get(id)
}

/** JSON для экспорта: и плейлисты, и их треки, с версией формата. */
export function exportJson(): string {
  return JSON.stringify({ app: 'Undertow', kind: 'playlists', version: FILE_VERSION, items: load().items }, null, 2)
}
