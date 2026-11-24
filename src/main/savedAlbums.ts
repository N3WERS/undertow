/**
 * Сохранённые альбомы для библиотеки.
 *
 * Это закладки, а не скачанные файлы: храним ссылку и снимок треков, чтобы
 * альбом открывался и играл даже если каталог потом ответит иначе.
 */
import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { sanitizeTrack } from './library'
import type { BrowsePage, Track } from './providers/types'

export interface SavedAlbum {
  id: string
  title: string
  artist: string
  year?: string
  coverUrl?: string
  type?: 'album' | 'single' | 'ep'
  tracks: Track[]
  savedAt: number
}

interface AlbumsFile {
  version: 1
  items: SavedAlbum[]
}

const FILE_VERSION = 1 as const
const MAX_ALBUMS = 500
let cache: AlbumsFile | null = null

function filePath(): string {
  return join(app.getPath('userData'), 'albums.json')
}

function load(): AlbumsFile {
  if (cache) return cache
  try {
    const parsed = JSON.parse(readFileSync(filePath(), 'utf8')) as Partial<AlbumsFile>
    cache = {
      version: FILE_VERSION,
      items: Array.isArray(parsed.items)
        ? (parsed.items as SavedAlbum[]).filter((a) => a?.id && a?.title && Array.isArray(a.tracks))
        : []
    }
  } catch {
    cache = { version: FILE_VERSION, items: [] }
  }
  return cache
}

function flush(next?: AlbumsFile): void {
  const data = next ?? load()
  if (next) cache = next
  const file = filePath()
  try {
    const dir = dirname(file)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    const tmp = `${file}.tmp`
    writeFileSync(tmp, JSON.stringify(data, null, 2), { encoding: 'utf8' })
    renameSync(tmp, file)
  } catch (e) {
    console.error('[albums] не удалось сохранить:', e instanceof Error ? e.message : e)
  }
}

function pagesTracks(tracks: Track[]): Track[] {
  return tracks.map((t) => sanitizeTrack(t)).filter((t) => t.playable)
}

/** Что считать одним и тем же альбомом: id, а при его отсутствии — название+артист. */
function nameKey(title: string, artist?: string): string {
  return `name:${(artist ?? '').trim().toLowerCase()}|${title.trim().toLowerCase()}`
}

function keyOf(album: { id?: string; title: string; artist?: string }): string {
  // синтетический id поиска по названию нестабилен — храним по названию и артисту
  if (album.id && !album.id.startsWith('yt-album-name:')) return String(album.id)
  return nameKey(album.title, album.artist)
}

export function list(): SavedAlbum[] {
  return load().items
}

export function save(page: BrowsePage): SavedAlbum[] {
  if (page.kind !== 'album') throw new Error('Это не альбом')
  if (!page.tracks.length) throw new Error('В альбоме нет доступных треков')

  const first = page.tracks[0]
  const id = keyOf({ id: page.id, title: page.title, artist: first?.artist })
  const data = load()
  const artist = first?.artist || page.subtitle.split(' · ')[0] || 'Неизвестный исполнитель'
  const duplicate = data.items.some(
    (a) => a.id === id || (a.title.toLowerCase() === page.title.toLowerCase() && a.artist.toLowerCase() === artist.toLowerCase())
  )
  if (!duplicate) {
    const album: SavedAlbum = {
      id,
      title: page.title,
      artist,
      year: first?.year,
      coverUrl: page.coverUrl ?? first?.coverUrl,
      tracks: pagesTracks(page.tracks),
      savedAt: Date.now()
    }
    flush({ version: FILE_VERSION, items: [album, ...data.items].slice(0, MAX_ALBUMS) })
  }
  return load().items
}

export function remove(id: string): SavedAlbum[] {
  const data = load()
  const items = data.items.filter((a) => a.id !== id)
  if (items.length !== data.items.length) flush({ version: FILE_VERSION, items })
  return load().items
}

/** Проверка для кнопки на странице альбома. */
export function has(id: string): boolean {
  return load().items.some((a) => a.id === id)
}
