/**
 * Очередь загрузок поверх offline.save().
 *
 * Офлайн-файлы и индекс остаются в offline.ts, а здесь — состояние очереди,
 * параллельность, пауза и повтор. Загрузки переживают перезапуск: при старте
 * недокачанные элементы снова встают в очередь.
 */
import { app } from 'electron'
import fsp from 'node:fs/promises'
import path from 'node:path'
import * as offline from './offline'
import * as providers from './providers'
import type { Track } from './providers/types'

export type DownloadStatus = 'queued' | 'downloading' | 'done' | 'error' | 'canceled'

export interface DownloadItem {
  id: string
  track: Track
  status: DownloadStatus
  received: number
  total: number
  percent: number | null
  bytes?: number
  error?: string
  addedAt: number
  finishedAt?: number
}

export interface DownloadsSnapshot {
  items: DownloadItem[]
  paused: boolean
  active: number
  queued: number
  errors: number
}

const CONCURRENCY = 2
const INDEX_VERSION = 1
let loaded = false
let items: DownloadItem[] = []
let paused = false
const running = new Set<string>()
const listeners = new Set<(snapshot: DownloadsSnapshot) => void>()
let writing: Promise<void> | null = null
let writeQueued = false
let persistTimer: ReturnType<typeof setTimeout> | null = null

function indexFile(): string {
  return path.join(app.getPath('userData'), 'downloads.json')
}

function snapshot(): DownloadsSnapshot {
  const sorted = [...items].sort((a, b) => {
    const rank = (item: DownloadItem) =>
      item.status === 'downloading' ? 0 : item.status === 'queued' ? 1 : item.status === 'error' ? 2 : 3
    return rank(a) - rank(b) || a.addedAt - b.addedAt
  })
  return {
    items: sorted,
    paused,
    active: items.filter((item) => item.status === 'downloading').length,
    queued: items.filter((item) => item.status === 'queued').length,
    errors: items.filter((item) => item.status === 'error').length
  }
}

function emit(): void {
  const state = snapshot()
  for (const listener of listeners) listener(state)
  // прогресс приходит сотнями событий; пишем индекс не чаще раза в 300 мс
  if (persistTimer) return
  persistTimer = setTimeout(() => {
    persistTimer = null
    void persist()
  }, 300)
}

async function persist(): Promise<void> {
  if (writing) {
    writeQueued = true
    return writing
  }
  writing = (async () => {
    do {
      writeQueued = false
      const data = { v: INDEX_VERSION, paused, items }
      const tmp = `${indexFile()}.tmp`
      try {
        await fsp.writeFile(tmp, JSON.stringify(data), 'utf8')
        await fsp.rename(tmp, indexFile())
      } catch {
        /* очередь не критична для воспроизведения */
      }
    } while (writeQueued)
  })().finally(() => {
    writing = null
  })
  return writing
}

export function onChange(listener: (snapshot: DownloadsSnapshot) => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export async function init(): Promise<void> {
  if (loaded) return
  loaded = true
  try {
    const raw = await fsp.readFile(indexFile(), 'utf8')
    const json = JSON.parse(raw) as { paused?: boolean; items?: DownloadItem[] }
    paused = Boolean(json.paused)
    items = (json.items ?? [])
      .filter((item) => item?.track?.id)
      .map((item) => ({
        ...item,
        status:
          item.status === 'downloading'
            ? 'queued'
            : item.status === 'done' && (item.bytes ?? 0) > 0
              ? 'done'
              : item.status
      }))
  } catch {
    items = []
  }
  pump()
}

export async function list(): Promise<DownloadsSnapshot> {
  await init()
  return snapshot()
}

/** Добавляет треки в очередь; уже сохранённые и дубли пропускает. */
export async function enqueue(tracks: Track[]): Promise<DownloadsSnapshot> {
  await init()
  const known = new Set(items.map((item) => item.id))
  for (const track of tracks) {
    if (!track?.id || known.has(track.id)) continue
    if (await offline.entryFor(track.id)) continue
    known.add(track.id)
    items.push({
      id: track.id,
      track: JSON.parse(JSON.stringify(track)) as Track,
      status: 'queued',
      received: 0,
      total: 0,
      percent: null,
      addedAt: Date.now()
    })
  }
  emit()
  pump()
  return snapshot()
}

export async function pause(): Promise<DownloadsSnapshot> {
  await init()
  paused = true
  emit()
  return snapshot()
}

export async function resume(): Promise<DownloadsSnapshot> {
  await init()
  paused = false
  emit()
  pump()
  return snapshot()
}

export async function retry(id: string): Promise<DownloadsSnapshot> {
  await init()
  const item = items.find((entry) => entry.id === id)
  if (item && (item.status === 'error' || item.status === 'canceled')) {
    item.status = 'queued'
    item.received = 0
    item.total = 0
    item.percent = null
    delete item.error
    delete item.finishedAt
    emit()
    pump()
  }
  return snapshot()
}

export async function remove(id: string): Promise<DownloadsSnapshot> {
  await init()
  const item = items.find((entry) => entry.id === id)
  if (item?.status === 'downloading') {
    // отменить уже идущий yt-dlp/curl нельзя, но результат не попадёт в очередь
    item.status = 'canceled'
    delete item.error
    emit()
    return snapshot()
  }
  items = items.filter((entry) => entry.id !== id)
  emit()
  return snapshot()
}

export async function clearFinished(): Promise<DownloadsSnapshot> {
  await init()
  items = items.filter((item) => item.status === 'downloading' || item.status === 'queued')
  emit()
  return snapshot()
}

function pump(): void {
  if (paused) return
  while (running.size < CONCURRENCY) {
    const next = items.find((item) => item.status === 'queued')
    if (!next) return
    next.status = 'downloading'
    next.received = 0
    next.total = 0
    next.percent = null
    delete next.error
    running.add(next.id)
    emit()
    void run(next)
  }
}

async function run(item: DownloadItem): Promise<void> {
  try {
    const existing = await offline.entryFor(item.id)
    if (existing) {
      finish(item, existing.bytes)
      return
    }
    const stream = await providers.resolveStream(item.track.id, false, item.track)
    if (stream.source === 'local') {
      const local = await offline.entryFor(item.id)
      if (local) {
        finish(item, local.bytes)
        return
      }
    }
    const entry = await offline.save(item.track, stream, (progress) => {
      const current = items.find((entryItem) => entryItem.id === item.id)
      if (!current || current.status !== 'downloading') return
      current.received = progress.received
      current.total = progress.total
      current.percent = progress.percent
      current.error = progress.error
      emit()
    })
    finish(item, entry.bytes)
  } catch (error) {
    const current = items.find((entry) => entry.id === item.id)
    if (current) {
      if (current.status === 'canceled') {
        // отмена во время загрузки: файл не попал в индекс, элемент убираем
        items = items.filter((entry) => entry.id !== item.id)
      } else {
        current.status = 'error'
        current.error = error instanceof Error ? error.message : String(error)
      }
      emit()
    }
  } finally {
    running.delete(item.id)
    pump()
  }
}

function finish(item: DownloadItem, bytes: number): void {
  const current = items.find((entry) => entry.id === item.id)
  if (!current) return
  if (current.status === 'canceled') {
    items = items.filter((entry) => entry.id !== item.id)
    emit()
    return
  }
  current.status = 'done'
  current.bytes = bytes
  current.percent = 100
  current.finishedAt = Date.now()
  delete current.error
  emit()
}
