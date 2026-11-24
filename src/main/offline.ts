/**
 * Локальные копии треков.
 *
 * Файл качается в `%APPDATA%/Undertow/offline`, рядом лежит `offline.json`
 * с метаданными. Плеер всегда предпочитает локальную копию: она не зависит
 * от Плюса, протухших ссылок googlevideo и доступна без сети.
 */
import { app } from 'electron'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { ResolvedStream, Track } from './providers/types'
import { ytDownload } from './ytdlp'

export interface OfflineEntry {
  track: Track
  /** имя файла внутри папки offline */
  file: string
  mime: string
  bytes: number
  bitrateKbps?: number
  savedAt: number
  source: 'yandex' | 'youtube'
}

export interface OfflineSnapshot {
  items: OfflineEntry[]
  count: number
  bytes: number
}

export interface OfflineProgress {
  id: string
  received: number
  total: number
  /** 0..100, null если сервер не сообщил размер */
  percent: number | null
  status: 'downloading' | 'done' | 'error'
  error?: string
}

const INDEX_VERSION = 1
let loaded = false
let entries = new Map<string, OfflineEntry>()
let dir = ''

function rootDir(): string {
  if (!dir) dir = path.join(app.getPath('userData'), 'offline')
  return dir
}

function indexPath(): string {
  return path.join(app.getPath('userData'), 'offline.json')
}

function safeTrack(track: Track): Track {
  // храним полную копию метаданных: трек должен открываться и быть подписан
  // даже если исходный каталог потом изменится
  return JSON.parse(JSON.stringify(track)) as Track
}

async function ensureDir(): Promise<void> {
  await fsp.mkdir(rootDir(), { recursive: true })
}

async function writeIndex(): Promise<void> {
  const data = {
    v: INDEX_VERSION,
    items: [...entries.values()].sort((a, b) => b.savedAt - a.savedAt)
  }
  const tmp = `${indexPath()}.tmp`
  await fsp.writeFile(tmp, JSON.stringify(data), 'utf8')
  await fsp.rename(tmp, indexPath())
}

export async function init(): Promise<void> {
  if (loaded) return
  loaded = true
  await ensureDir()
  try {
    const raw = await fsp.readFile(indexPath(), 'utf8')
    const json = JSON.parse(raw) as { v?: number; items?: OfflineEntry[] }
    const next = new Map<string, OfflineEntry>()
    for (const entry of json.items ?? []) {
      if (!entry?.track?.id || !entry.file) continue
      const full = path.join(rootDir(), entry.file)
      if (!fs.existsSync(full)) continue
      next.set(entry.track.id, entry)
    }
    entries = next
    if (next.size !== (json.items ?? []).length) await writeIndex()
  } catch {
    // индекса ещё нет или он битый — начинаем с пустого списка
    entries = new Map()
  }
}

export async function list(): Promise<OfflineSnapshot> {
  await init()
  const items = [...entries.values()].sort((a, b) => b.savedAt - a.savedAt)
  return {
    items,
    count: items.length,
    bytes: items.reduce((sum, e) => sum + (e.bytes || 0), 0)
  }
}

export async function entryFor(id: string): Promise<OfflineEntry | null> {
  await init()
  const entry = entries.get(id)
  if (!entry) return null
  if (!fs.existsSync(path.join(rootDir(), entry.file))) return null
  return entry
}

/** Локальный поток для плеера (путь отдаёт audioProxy). */
export async function localStream(id: string): Promise<(ResolvedStream & { filePath: string }) | null> {
  const entry = await entryFor(id)
  if (!entry) return null
  return {
    url: '',
    mime: entry.mime,
    bitrateKbps: entry.bitrateKbps,
    ttlMs: Number.MAX_SAFE_INTEGER,
    source: 'local',
    filePath: path.join(rootDir(), entry.file)
  }
}

export function extensionFor(mime: string, fallback = 'webm'): string {
  const m = mime.toLowerCase()
  if (m.includes('mpeg') || m.includes('mp3')) return 'mp3'
  if (m.includes('mp4') || m.includes('m4a') || m.includes('aac')) return 'm4a'
  if (m.includes('flac')) return 'flac'
  if (m.includes('ogg') || m.includes('opus')) return 'ogg'
  if (m.includes('webm')) return 'webm'
  return fallback
}

function mimeOf(ext: string): string {
  if (ext === 'mp3') return 'audio/mpeg'
  if (ext === 'm4a') return 'audio/mp4'
  if (ext === 'flac') return 'audio/flac'
  if (ext === 'ogg') return 'audio/ogg'
  return 'audio/webm'
}

/** Удаляет локальную копию трека. */
export async function remove(id: string): Promise<boolean> {
  await init()
  const entry = entries.get(id)
  if (!entry) return false
  entries.delete(id)
  await writeIndex()
  await fsp.rm(path.join(rootDir(), entry.file), { force: true }).catch(() => undefined)
  return true
}

/** Удаляет все сохранённые копии. */
export async function clearAll(): Promise<number> {
  await init()
  const items = [...entries.values()]
  entries = new Map()
  await writeIndex()
  await Promise.all(items.map((e) => fsp.rm(path.join(rootDir(), e.file), { force: true }).catch(() => undefined)))
  return items.length
}

/**
 * Скачивает уже разрешённый поток. Разрешение ссылки делает вызывающая
 * сторона (providers), чтобы здесь не было циклического импорта.
 */
export async function save(
  track: Track,
  stream: ResolvedStream,
  onProgress?: (progress: OfflineProgress) => void
): Promise<OfflineEntry> {
  await init()
  const existing = await entryFor(track.id)
  if (existing) return existing
  await ensureDir()

  const ext = extensionFor(stream.mime)
  const hash = createHash('sha1').update(track.id).digest('hex').slice(0, 20)
  let file = `${hash}.${ext}`
  let target = path.join(rootDir(), file)
  const tmp = `${target}.part`

  const report = (received: number, total: number, status: OfflineProgress['status'], error?: string) => {
    onProgress?.({
      id: track.id,
      received,
      total,
      percent: total > 0 ? Math.min(100, Math.round((received / total) * 100)) : null,
      status,
      error
    })
  }

  const fetchToFile = async (): Promise<{ bytes: number; total: number }> => {
    let bytes = 0
    let size = 0
    const res = await fetch(stream.url, {
      headers: {
        // googlevideo не любит пустой User-Agent, а Яндекс спокойно отдаёт файл
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Undertow/1.0',
        Accept: '*/*'
      },
      redirect: 'follow'
    })
    if (!res.ok || !res.body) throw new Error(`Сервер отдал ${res.status}`)
    size = Number(res.headers.get('content-length') ?? 0) || 0
    report(0, size, 'downloading')

    const meter = new Transform({
      transform(chunk: Buffer, _enc, cb) {
        bytes += chunk.length
        report(bytes, size, 'downloading')
        cb(null, chunk)
      }
    })
    await pipeline(Readable.fromWeb(res.body as never), meter, fs.createWriteStream(tmp))
    if (bytes < 20_000) throw new Error('Файл получился слишком маленьким')
    return { bytes, total: size }
  }

  let received = 0
  let total = 0
  try {
    if (stream.videoId) {
      // YouTube отдаёт одиночное соединение очень медленно — качаем через yt-dlp
      // кусками, а если он недоступен, откатываемся на прямую ссылку
      try {
        const base = `${hash}.dl`
        const got = await ytDownload(stream.videoId, rootDir(), base, (pct) => report(pct, 100, 'downloading'))
        const gotExt = path.extname(got.file).slice(1).toLowerCase() || ext
        file = `${hash}.${gotExt}`
        target = path.join(rootDir(), file)
        await fsp.rename(got.file, target)
        received = got.bytes
        total = got.bytes
      } catch (e) {
        console.log(
          '[offline] yt-dlp не скачал, пробую прямую ссылку:',
          e instanceof Error ? e.message : String(e)
        )
        const leftovers = (await fsp.readdir(rootDir())).filter((f) => f.startsWith(`${hash}.dl`))
        await Promise.all(leftovers.map((f) => fsp.rm(path.join(rootDir(), f), { force: true }).catch(() => undefined)))
        const got = await fetchToFile()
        received = got.bytes
        total = got.total
        await fsp.rename(tmp, target)
      }
    } else {
      const got = await fetchToFile()
      received = got.bytes
      total = got.total
      await fsp.rename(tmp, target)
    }

    const entry: OfflineEntry = {
      track: safeTrack(track),
      file,
      mime: mimeOf(path.extname(file).slice(1)) || stream.mime,
      bytes: received,
      bitrateKbps: stream.bitrateKbps,
      savedAt: Date.now(),
      source: stream.source === 'yandex' ? 'yandex' : 'youtube'
    }
    entries.set(track.id, entry)
    await writeIndex()
    report(received, total || received, 'done')
    return entry
  } catch (e) {
    await fsp.rm(tmp, { force: true }).catch(() => undefined)
    const message = e instanceof Error ? e.message : String(e)
    report(received, total, 'error', message)
    throw e
  }
}

export function localRoot(): string {
  return rootDir()
}
