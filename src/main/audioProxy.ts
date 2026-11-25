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
import { request as httpsRequest } from 'node:https'
import type { AddressInfo } from 'node:net'
import path from 'node:path'
import { log } from './log'

const ALLOWED_HOSTS = ['.googlevideo.com', 'googlevideo.com', '.yandex.net', 'yandex.net', '.yandex.ru', 'yandex.ru']

/** первые 1 МиБ быстрой ссылки; дальше подставляем полный yt-dlp-URL */
const FAST_CHUNK = 1024 * 1024
const fallbacks = new Map<string, { promise: Promise<string>; expires: number }>()

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

/**
 * googlevideo для некоторых клиентов (например, IOS/VISIONOS) отдаёт 403 на
 * открытый Range `bytes=0-` и на запрос без Range. Ограниченный диапазон
 * работает, поэтому открытый хвост режем на куски по 1 МиБ; медиаэлемент
 * затем дозапрашивает следующие диапазоны.
 */
function keyOf(url: string): string {
  try {
    return new URL(url).href
  } catch {
    return url
  }
}

/** Регистрирует полный URL, которым прокси продолжит быстрый первый МиБ. */
export function registerStreamFallback(fastUrl: string, fullUrl: Promise<string>): void {
  const key = keyOf(fastUrl)
  const promise = fullUrl
    .then((u) => keyOf(u))
    .catch((e) => {
      log('proxy fallback err', e instanceof Error ? e.message.slice(0, 120) : String(e))
      throw e
    })
  promise.catch(() => {})
  fallbacks.set(key, { promise, expires: Date.now() + 15 * 60_000 })
  if (fallbacks.size > 64) {
    const oldest = [...fallbacks.entries()].sort((a, b) => a[1].expires - b[1].expires)[0]
    if (oldest) fallbacks.delete(oldest[0])
  }
}

function rangeStart(range: string | undefined): number {
  if (!range) return 0
  const m = /^bytes=(\d+)-/.exec(range)
  return m ? Number(m[1]) : 0
}

function rangeEnd(range: string | undefined): number | null {
  if (!range) return null
  const m = /^bytes=\d+-(\d*)$/.exec(range)
  if (!m || !m[1]) return null
  return Number(m[1])
}

/** Быстрая ссылка отдаёт только первые 1 МиБ. */
function boundFastRange(range: string | undefined): string {
  if (!range) return 'bytes=0-1048575'
  const m = /^bytes=(\d+)-(\d*)$/.exec(range)
  if (!m) return range
  const start = Number(m[1])
  if (start >= FAST_CHUNK) return range
  const end = m[2] ? Math.min(Number(m[2]), FAST_CHUNK - 1) : FAST_CHUNK - 1
  return `bytes=${start}-${end}`
}

function boundOpenRange(range: string | undefined, upstream: URL): string | undefined {
  // В googlevideo-URL есть clen — полный размер файла. Если запрошен
  // открытый хвост, просим сразу весь остаток: иначе Chromium после первого
  // куска делает второй range-запрос, а CDN отдаёт его обрезанным.
  const clen = Number(upstream.searchParams.get('clen'))
  const fullEnd = Number.isFinite(clen) && clen > 0 ? clen - 1 : null
  if (!range) return fullEnd !== null ? `bytes=0-${fullEnd}` : 'bytes=0-1048575'
  const m = /^bytes=(\d+)-$/.exec(range)
  if (!m) return range
  const start = Number(m[1])
  if (fullEnd !== null && start <= fullEnd) return `bytes=${start}-${fullEnd}`
  return `bytes=${start}-${start + 1048575}`
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

  let up: IncomingMessage
  try {
    const rangeHeader = req.headers.range
    let range = boundOpenRange(rangeHeader, upstream)
    const fallback = fallbacks.get(keyOf(upstream.href))
    if (fallback && fallback.expires > Date.now()) {
      const start = rangeStart(rangeHeader)
      const end = rangeEnd(rangeHeader)
      // Первый МиБ — с быстрой ссылки, всё дальше (и любой range за её
      // пределом) — с полного URL, который уже добывает yt-dlp в фоне.
      if (start >= FAST_CHUNK || (end !== null && end >= FAST_CHUNK)) {
        try {
          const full = await new Promise<string>((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error('fallback timeout')), 8_000)
            fallback.promise.then(
              (u) => {
                clearTimeout(timer)
                resolve(u)
              },
              (e) => {
                clearTimeout(timer)
                reject(e)
              }
            )
          })
          log('proxy fallback', upstream.hostname, start)
          upstream = new URL(full)
          range = rangeHeader
        } catch (e) {
          log('proxy fallback miss', upstream.hostname, e instanceof Error ? e.message : String(e))
          range = boundFastRange(rangeHeader)
        }
      } else {
        range = boundFastRange(rangeHeader)
      }
    }
    try {
      up = await openUpstream(upstream, range, ctrl.signal, 0)
    } catch (e) {
      if (ctrl.signal.aborted) throw e
      // Один быстрый повтор: тот же URL может попасть на другой IP/узел,
      // а жёсткий таймер уже отсекает совсем мёртвый connect.
      log('proxy retry', upstream.hostname, e instanceof Error ? e.message.slice(0, 80) : String(e))
      await new Promise((r) => setTimeout(r, 120))
      up = await openUpstream(upstream, range, ctrl.signal, 0)
    }

    for (const h of ['content-length', 'content-range', 'accept-ranges', 'etag', 'last-modified']) {
      const v = up.headers[h]
      if (typeof v === 'string') res.setHeader(h, v)
    }
    const upstreamCt = up.headers['content-type']
    const knownCt = parsed.searchParams.get('ct')
    // Яндекс отдаёт mp3 как application/octet-stream — подменяем на известный тип,
    // иначе браузерный декодер может отказаться от потока
    const ct =
      knownCt && (!upstreamCt || upstreamCt.startsWith('application/octet-stream')) ? knownCt : upstreamCt || 'application/octet-stream'
    res.setHeader('Content-Type', ct)
    res.writeHead(up.statusCode ?? 502)

    if (req.method === 'HEAD') {
      up.resume()
      res.end()
      return
    }

    up.setTimeout(20_000, () => {
      log('proxy stall', upstream.hostname)
      up.destroy(new Error('upstream stalled'))
    })
    up.on('error', () => {
      if (!res.writableEnded) res.end()
    })
    up.pipe(res)
  } catch (e) {
    if (res.destroyed) return
    log('proxy FAIL', upstream.hostname, (e instanceof Error ? e.message : String(e)).slice(0, 160))
    if (!res.headersSent) {
      res.writeHead(502, { 'Content-Type': 'text/plain' })
      res.end(`upstream error: ${e instanceof Error ? e.message : String(e)}`)
    } else {
      res.end()
    }
  }
}

/**
 * Качает googlevideo через штатный node:https, а не через fetch/undici.
 * Undici иногда упирается в 10-секундный connect timeout на отдельные
 * rr-хосты, хотя обычный TLS к тому же IP открывается за десятки мс.
 * Заодно вручную ведём redirect: location может увести на другой rr-хост.
 */
function openUpstream(
  url: URL,
  range: string | undefined,
  signal: AbortSignal,
  depth: number
): Promise<IncomingMessage> {
  return new Promise((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | null = null
    const req = httpsRequest(
      url,
      {
        method: 'GET',
        headers: {
          ...(range ? { Range: range } : {}),
          // Без браузерного User-Agent googlevideo отвечает 302 на
          // случайный rr-хост, и часть таких хостов недоступна.
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
          Accept: '*/*',
          'Accept-Language': 'en-US,en;q=0.9',
          Referer: 'https://www.youtube.com/'
        },
        signal,
        // Не переиспользуем сокеты: после сброса на rr-хосте глобальный
        // keep-alive агент может отдавать мёртвое соединение повторно.
        agent: false,
        timeout: 3_500,
        // ClientHello TLS 1.3 у Node бывает слишком большим и не помещается
        // в один TCP-сегмент: наш SNI-парсер не видит его и DPI сбрасывает
        // соединение. TLS 1.2 даёт компактный hello, который делится штатно.
        maxVersion: 'TLSv1.2'
      },
      (up) => {
        if (timer) clearTimeout(timer)
        const status = up.statusCode ?? 0
        const location = up.headers.location
        if (status >= 300 && status < 400 && location) {
          up.resume()
          if (depth >= 4) {
            reject(new Error('слишком много редиректов'))
            return
          }
          let next: URL
          try {
            next = new URL(location, url)
          } catch {
            reject(new Error('некорректный редирект'))
            return
          }
          if (next.protocol !== 'https:' || !hostAllowed(next.hostname)) {
            reject(new Error('редирект на неразрешённый хост'))
            return
          }
          resolve(openUpstream(next, range, signal, depth + 1))
          return
        }
        resolve(up)
      }
    )
    // timeout в опциях срабатывает только на уже открытом сокете; на
    // «залипшем» connect нужен жёсткий таймер.
    timer = setTimeout(() => req.destroy(new Error('upstream timeout')), 3_500)
    req.on('error', (e) => {
      if (timer) clearTimeout(timer)
      reject(e)
    })
    req.end()
  })
}

/**
 * Быстрая проверка, что ссылка реально отдаёт звук, а не только заголовки:
 * некоторые rr-хосты принимают TLS, отдают 206 и первые килобайты, после
 * чего сбрасывают поток. Ждём всего 1,2 с и 8 КБ — хороший узел успевает
 * прислать больше, мёртвый отсекается почти сразу.
 */
export async function probeStream(url: string, bytes = 8 * 1024, timeout = 1200): Promise<boolean> {
  const started = Date.now()
  let host = ''
  try {
    host = new URL(url).hostname
  } catch {
    return false
  }
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeout)
  let status = 0
  let got = 0
  let error = ''
  try {
    const up = await openUpstream(new URL(url), `bytes=0-${bytes - 1}`, ctrl.signal, 0)
    status = up.statusCode ?? 0
    if (!status || status >= 400) {
      up.resume()
      log('probe dead', host, 'status=' + (status || 'none'), '0B', Date.now() - started + 'ms')
      return false
    }
    got = await new Promise<number>((resolve) => {
      let total = 0
      const finish = (): void => {
        up.off('data', onData)
        up.off('end', finish)
        up.off('error', finish)
        up.off('aborted', finish)
        up.destroy()
        resolve(total)
      }
      const onData = (chunk: Buffer): void => {
        total += chunk.length
        if (total >= bytes) finish()
      }
      up.on('data', onData)
      up.on('end', finish)
      up.on('error', (e) => {
        error = e.message
        finish()
      })
      up.on('aborted', () => {
        error = 'aborted'
        finish()
      })
    })
    const ok = got >= 1024
    if (!ok) log('probe dead', host, 'status=' + status, got + 'B', Date.now() - started + 'ms', error)
    return ok
  } catch (e) {
    error = e instanceof Error ? e.message : String(e)
    log('probe dead', host, 'status=' + (status || 'none'), got + 'B', Date.now() - started + 'ms', error.slice(0, 100))
    return false
  } finally {
    clearTimeout(timer)
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
