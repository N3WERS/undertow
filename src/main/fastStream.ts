/**
 * Быстрый путь получения аудио-URL через InnerTube (youtubei.js).
 *
 * Идея: клиент IOS в текущем API отдаёт прямые подписанные ссылки на
 * googlevideo без SABR/дешифровки. Один запрос player занимает ~0,6–0,9 с
 * против 2,7–3,4 с у yt-dlp.
 *
 * Это именно быстрый, но не гарантированный путь: YouTube может ответить
 * LOGIN_REQUIRED, не отдать URL или сменить клиент. Любая такая ситуация
 * возвращает null, и вызывающий код падает в обычный yt-dlp fallback.
 */
import type { Innertube } from 'youtubei.js'
import { log } from './log'

let clientPromise: Promise<Innertube> | null = null
let ready = false

function fastClient(): Promise<Innertube> {
  if (!clientPromise) {
    clientPromise = import('youtubei.js')
      .then(({ Innertube }) =>
        Innertube.create({
          retrieve_player: true,
          generate_session_locally: true,
          lang: 'ru',
          location: 'RU'
        })
      )
      .then((yt) => {
        ready = true
        log('fast client ready')
        return yt
      })
      .catch((e) => {
        clientPromise = null
        ready = false
        log('fast client err', e instanceof Error ? e.message.slice(0, 120) : String(e))
        throw e
      })
  }
  return clientPromise
}

/** Фоновый прогрев клиента: не должен задерживать запуск приложения. */
export function warmFastClient(): void {
  void fastClient().catch(() => {})
}

export function isFastReady(): boolean {
  return ready
}

export interface FastAudio {
  url: string
  mime: string
  bitrateKbps?: number
  itag: number
}

function within<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timeout`)), ms)
    p.then(
      (v) => {
        clearTimeout(timer)
        resolve(v)
      },
      (e) => {
        clearTimeout(timer)
        reject(e)
      }
    )
  })
}

/**
 * Пытается получить прямой аудио-URL. Жёсткий бюджет — timeoutMs на весь
 * путь; при превышении вызывающий сразу уходит в yt-dlp.
 */
export async function fastAudio(videoId: string, timeoutMs = 1200): Promise<FastAudio | null> {
  const started = Date.now()
  try {
    const yt = await within(fastClient(), timeoutMs, 'fast client')
    const left = timeoutMs - (Date.now() - started)
    if (left < 150) {
      log('fast miss', videoId, 'budget', Date.now() - started + 'ms')
      return null
    }
    const info = await within(yt.getInfo(videoId, { client: 'IOS' }), left, 'fast info')
    const status = info.playability_status
    if (status?.status !== 'OK') {
      log('fast miss', videoId, status?.status || 'no status', (status?.reason || '').slice(0, 70))
      return null
    }
    const formats = (info.streaming_data?.adaptive_formats ?? []).filter(
      (f) => f.has_audio && !f.has_video && typeof f.url === 'string' && f.url.startsWith('https://')
    )
    if (!formats.length) {
      log('fast miss', videoId, 'no direct url')
      return null
    }
    const best = formats.sort((a, b) => (b.bitrate ?? 0) - (a.bitrate ?? 0))[0]
    if (!best || typeof best.url !== 'string') {
      log('fast miss', videoId, 'no best format')
      return null
    }
    const out: FastAudio = {
      url: best.url as string,
      mime: (best.mime_type || 'audio/mp4').split(';')[0],
      bitrateKbps: best.bitrate ? Math.round(best.bitrate / 1000) : undefined,
      itag: best.itag
    }
    log('fast ok', videoId, out.itag, out.bitrateKbps ?? '', Date.now() - started + 'ms')
    return out
  } catch (e) {
    log('fast miss', videoId, e instanceof Error ? e.message.slice(0, 100) : String(e), Date.now() - started + 'ms')
    return null
  }
}
