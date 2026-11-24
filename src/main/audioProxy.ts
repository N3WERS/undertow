/**
 * Локальный аудио-прокси.
 *
 * Зачем: ни googlevideo.com, ни Яндекс не отдают Access-Control-Allow-Origin,
 * а Web Audio (MediaElementAudioSourceNode) требует CORS, иначе в граф приходит
 * тишина. Поэтому аудио идёт через 127.0.0.1, где мы сами ставим CORS-заголовки,
 * пробрасываем Range (перемотка) и отдаём корректный Content-Type.
 *
 * Бонус: здесь же позже появится расшифровка lossless (transport: encraw).
 */
import { randomBytes } from 'node:crypto'
import fs from 'node:fs'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import path from 'node:path'

const ALLOWED_HOSTS = ['.googlevideo.com', 'googlevideo.com', '.yandex.net', 'yandex.net', '.yandex.ru', 'yandex.ru']

let server: Server | null = null
let secret = ''
let port = 0
/** папка, из которой разрешено отдавать локальные файлы (сохранённые треки) */
let localRoot = ''

function hostAllowed(hostname: string): boolean {
  const h = hostname.toLowerCase()
  return ALLOWED_HOSTS.some((suffix) => (suffix.startsWith('.') ? h.endsWith(suffix) : h === suffix))
}

function setCors(res: ServerResponse): void {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'range, content-type')
  res.setHeader('Access-Control-Expose-Headers', 'content-range, content-length, accept-ranges, content-type')
}

async function serveLocal(req: IncomingMessage, res: ServerResponse, parsed: URL): Promise<void> {
  if (parsed.searchParams.get('s') !== secret) {
    res.writeHead(403).end()
    return
  }
  let file: string
  try {
    file = path.resolve(Buffer.from(parsed.searchParams.get('p') ?? '', 'base64url').toString('utf8'))
  } catch {
    res.writeHead(400).end()
    return
  }
  const root = path.resolve(localRoot)
  // никаких выходов из папки сохранённых треков
  if (!localRoot || (file !== root && !file.startsWith(root + path.sep))) {
    res.writeHead(403).end()
    return
  }

  let stat: fs.Stats
  try {
    stat = await fs.promises.stat(file)
  } catch {
    res.writeHead(404).end()
    return
  }
  if (!stat.isFile()) {
    res.writeHead(404).end()
    return
  }

  const ct = parsed.searchParams.get('ct') || 'application/octet-stream'
  res.setHeader('Content-Type', ct)
  res.setHeader('Accept-Ranges', 'bytes')
  const range = req.headers.range
  if (range) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(range.trim())
    if (m) {
      const start = m[1] ? Number(m[1]) : 0
      const end = m[2] ? Math.min(Number(m[2]), stat.size - 1) : stat.size - 1
      if (start <= end && start < stat.size) {
        res.statusCode = 206
        res.setHeader('Content-Range', `bytes ${start}-${end}/${stat.size}`)
        res.setHeader('Content-Length', end - start + 1)
        if (req.method === 'HEAD') {
          res.end()
          return
        }
        fs.createReadStream(file, { start, end }).pipe(res)
        return
      }
    }
  }
  res.setHeader('Content-Length', stat.size)
  res.statusCode = 200
  if (req.method === 'HEAD') {
    res.end()
    return
  }
  fs.createReadStream(file).pipe(res)
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  setCors(res)
  if (req.method === 'OPTIONS') {
    res.writeHead(204).end()
    return
  }

  const parsed = new URL(req.url ?? '/', 'http://127.0.0.1')
  if (parsed.pathname === '/f') {
    await serveLocal(req, res, parsed)
    return
  }
  if (parsed.pathname !== '/a') {
    res.writeHead(404).end()
    return
  }
  if (parsed.searchParams.get('s') !== secret) {
    res.writeHead(403).end()
    return
  }

  const encoded = parsed.searchParams.get('u')
  if (!encoded) {
    res.writeHead(400).end()
    return
  }

  let upstream: URL
  try {
    upstream = new URL(Buffer.from(encoded, 'base64url').toString('utf8'))
  } catch {
    res.writeHead(400).end()
    return
  }
  if (upstream.protocol !== 'https:' || !hostAllowed(upstream.hostname)) {
    res.writeHead(403).end()
    return
  }

  const ctrl = new AbortController()
  res.on('close', () => ctrl.abort())

  try {
    const range = req.headers.range
    const up = await fetch(upstream, {
      headers: range ? { Range: range } : {},
      signal: ctrl.signal,
      redirect: 'follow'
    })

    for (const h of ['content-length', 'content-range', 'accept-ranges', 'etag', 'last-modified']) {
      const v = up.headers.get(h)
      if (v) res.setHeader(h, v)
    }
    const upstreamCt = up.headers.get('content-type')
    const knownCt = parsed.searchParams.get('ct')
    // Яндекс отдаёт mp3 как application/octet-stream — подменяем на известный тип,
    // иначе браузерный декодер может отказаться от потока
    const ct =
      knownCt && (!upstreamCt || upstreamCt.startsWith('application/octet-stream')) ? knownCt : upstreamCt || 'application/octet-stream'
    res.setHeader('Content-Type', ct)
    res.writeHead(up.status)

    if (req.method === 'HEAD' || !up.body) {
      res.end()
      return
    }

    const reader = up.body.getReader()
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (!res.write(Buffer.from(value))) {
        await new Promise<void>((resolve) => res.once('drain', () => resolve()))
      }
    }
    res.end()
  } catch (e) {
    if (!res.headersSent) {
      res.writeHead(502, { 'Content-Type': 'text/plain' })
      res.end(`upstream error: ${e instanceof Error ? e.message : String(e)}`)
    } else {
      res.end()
    }
  }
}

export async function startAudioProxy(): Promise<number> {
  if (server) return port
  secret = randomBytes(16).toString('hex')
  server = createServer((req, res) => {
    void handle(req, res)
  })
  server.requestTimeout = 0
  server.headersTimeout = 30_000

  await new Promise<void>((resolve, reject) => {
    server!.once('error', reject)
    server!.listen(0, '127.0.0.1', () => resolve())
  })

  port = (server.address() as AddressInfo).port
  return port
}

export function setLocalRoot(dir: string): void {
  localRoot = dir
}

/** Оборачивает путь к сохранённому файлу в локальный прокси. */
export function proxifyLocal(filePath: string, mime?: string): string {
  if (!port) return filePath
  const encoded = Buffer.from(filePath, 'utf8').toString('base64url')
  const ct = mime ? `&ct=${encodeURIComponent(mime)}` : ''
  return `http://127.0.0.1:${port}/f?s=${secret}&p=${encoded}${ct}`
}

/** Оборачивает прямой URL в локальный прокси. */
export function proxify(upstreamUrl: string, mime?: string): string {
  if (!port) return upstreamUrl
  const encoded = Buffer.from(upstreamUrl, 'utf8').toString('base64url')
  const ct = mime ? `&ct=${encodeURIComponent(mime)}` : ''
  return `http://127.0.0.1:${port}/a?s=${secret}&u=${encoded}${ct}`
}
