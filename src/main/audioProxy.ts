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
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'

const ALLOWED_HOSTS = ['.googlevideo.com', 'googlevideo.com', '.yandex.net', 'yandex.net', '.yandex.ru', 'yandex.ru']

let server: Server | null = null
let secret = ''
let port = 0

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

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  setCors(res)
  if (req.method === 'OPTIONS') {
    res.writeHead(204).end()
    return
  }

  const parsed = new URL(req.url ?? '/', 'http://127.0.0.1')
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

/** Оборачивает прямой URL в локальный прокси. */
export function proxify(upstreamUrl: string, mime?: string): string {
  if (!port) return upstreamUrl
  const encoded = Buffer.from(upstreamUrl, 'utf8').toString('base64url')
  const ct = mime ? `&ct=${encodeURIComponent(mime)}` : ''
  return `http://127.0.0.1:${port}/a?s=${secret}&u=${encoded}${ct}`
}
