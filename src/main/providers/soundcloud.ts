/**
 * SoundCloud как дополнительный источник.
 *
 * У yt-dlp экстрактор SoundCloud сейчас ломается на защищённом JS-ассете,
 * поэтому ходим в публичный api-v2 сами. Страница SoundCloud отдаёт
 * одноразовый client_id в hydration-блоке; его кэшируем и обновляем при 401.
 *
 * Звук приходит HLS-плейлистом. Рендерер проигрывает его через hls.js,
 * поэтому resolve отдаёт m3u8-ссылку с флагом hls.
 */
import { execFile } from 'node:child_process'
import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import type { ResolvedStream, Track } from './types'

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

let clientIdCache: string | null = null
let clientIdAt = 0
let clientLoaded = false
const CLIENT_TTL = 6 * 60 * 60_000
// Запасной публичный client_id: главная SoundCloud периодически закрывается
// от нашего IP, а api-v2 продолжает работать. Если он протухнет, обновим со страницы.
const FALLBACK_CLIENT_ID = 'QhVEWrrJKvW4uSU5u5EoI0FTXYUGzy5k'

function clientFile(): string {
  return path.join(app.getPath('userData'), 'soundcloud-client.json')
}

function readClientFile(): { id: string; at: number } | null {
  try {
    const raw = JSON.parse(fs.readFileSync(clientFile(), 'utf8')) as { id?: string; at?: number }
    if (typeof raw.id === 'string' && raw.id.length >= 20) {
      return { id: raw.id, at: Number(raw.at) || 0 }
    }
  } catch {
    /* файла ещё нет */
  }
  return null
}

function writeClientFile(id: string, at: number): void {
  try {
    fs.writeFileSync(clientFile(), JSON.stringify({ id, at }), 'utf8')
  } catch {
    /* не критично: обновим со страницы в следующий раз */
  }
}
const streamCache = new Map<string, { stream: ResolvedStream; expires: number }>()

interface ScUser {
  username?: string
  permalink_url?: string
  avatar_url?: string
}

interface ScTranscoding {
  url?: string
  preset?: string
  format?: { protocol?: string; mime_type?: string }
}

interface ScTrack {
  id?: number
  title?: string
  permalink_url?: string
  artwork_url?: string
  duration?: number
  full_duration?: number
  streamable?: boolean
  policy?: string
  user?: ScUser
  publisher_metadata?: { artist?: string }
  media?: { transcodings?: ScTranscoding[] }
}

async function requestText(url: string, timeout = 20_000): Promise<{ status: number; body: string }> {
  // Electron/Node TLS у SoundCloud на некоторых сетях обрывается, а системный
  // curl (Schannel) проходит. Поэтому транспорт — curl.exe, который есть в Windows.
  return new Promise((resolve, reject) => {
    execFile(
      'curl.exe',
      [
        '-sS',
        '-L',
        '--compressed',
        '--max-time',
        String(Math.max(5, Math.round(timeout / 1000))),
        '-A',
        UA,
        '-H',
        'Accept: text/html,application/json;q=0.9,*/*;q=0.8',
        '-H',
        'Accept-Language: en-US,en;q=0.9',
        '-w',
        '__SC_STATUS__:%{http_code}',
        url
      ],
      { maxBuffer: 8 * 1024 * 1024, windowsHide: true, timeout: timeout + 2_000 },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(`SoundCloud: ${(stderr || error.message).trim().slice(0, 120)}`))
          return
        }
        const marker = stdout.lastIndexOf('__SC_STATUS__:')
        if (marker < 0) {
          reject(new Error('SoundCloud: пустой ответ'))
          return
        }
        const body = stdout.slice(0, marker)
        const status = Number(stdout.slice(marker + '__SC_STATUS__:'.length).trim()) || 0
        resolve({ status, body })
      }
    )
  })
}

async function getClientId(force = false): Promise<string> {
  if (!clientLoaded) {
    const disk = readClientFile()
    if (disk) {
      clientIdCache = disk.id
      clientIdAt = disk.at
    }
    clientLoaded = true
  }
  // Пока API не ответил 401, страницу не дёргаем: она часто закрыта, а id живёт долго.
  if (!force && clientIdCache) return clientIdCache
  try {
    const res = await requestText('https://soundcloud.com/', 8_000)
    if (res.status < 200 || res.status >= 300) throw new Error(`главная страница ${res.status}`)
    const html = res.body
    const patterns = [
      /"hydratable":"apiClient","data":\{"id":"([A-Za-z0-9]{20,40})"/,
      /"apiClient".{0,120}"id":"([A-Za-z0-9]{20,40})"/,
      /client_id["']?\s*[:=]\s*["']([A-Za-z0-9]{20,40})["']/
    ]
    for (const re of patterns) {
      const id = re.exec(html)?.[1]
      if (id) {
        clientIdCache = id
        clientIdAt = Date.now()
        writeClientFile(id, clientIdAt)
        return id
      }
    }
    throw new Error('страница не отдала client_id')
  } catch (e) {
    if (clientIdCache) return clientIdCache
    // первый запуск без кэша: пробуем известный публичный id
    clientIdCache = FALLBACK_CLIENT_ID
    clientIdAt = Date.now() - CLIENT_TTL + 30 * 60_000
    writeClientFile(clientIdCache, clientIdAt)
    return clientIdCache
  }
}

async function api<T>(path: string, params: Record<string, string | number> = {}): Promise<T> {
  const request = async (force: boolean): Promise<{ status: number; body: string }> => {
    const id = await getClientId(force)
    const url = new URL(`https://api-v2.soundcloud.com${path}`)
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value))
    url.searchParams.set('client_id', id)
    return requestText(url.toString())
  }
  let res = await request(false)
  if (res.status === 401) res = await request(true)
  if (res.status < 200 || res.status >= 300) throw new Error(`SoundCloud API ${res.status}`)
  return JSON.parse(res.body) as T
}


function toTrack(t: ScTrack): Track | null {
  const id = t.id
  const title = (t.title ?? '').trim()
  if (!id || !title) return null
  const artist = (t.publisher_metadata?.artist || t.user?.username || 'SoundCloud').trim()
  const durationSec = Math.max(0, Math.round((t.full_duration ?? t.duration ?? 0) / 1000))
  const cover = t.artwork_url
    ? t.artwork_url.replace('-large', '-t500x500')
    : t.user?.avatar_url?.replace('-large', '-t500x500')
  return {
    id: `sc:${id}`,
    provider: 'soundcloud',
    title,
    artist,
    album: undefined,
    durationSec,
    coverUrl: cover,
    kind: 'song',
    playable: t.streamable !== false && t.policy !== 'BLOCK'
  }
}

export async function search(query: string, limit = 20, offset = 0): Promise<Track[]> {
  const term = query.trim()
  if (!term) return []
  const data = await api<{ collection?: ScTrack[] }>('/search/tracks', {
    q: term,
    limit: Math.max(1, Math.min(40, limit)),
    offset: Math.max(0, Math.floor(offset) || 0),
    linked_partitioning: 0
  })
  return (data.collection ?? []).map(toTrack).filter((t): t is Track => Boolean(t))
}

export async function resolve(trackId: string, fresh = false): Promise<ResolvedStream> {
  const id = trackId.replace(/^sc:/, '')
  if (!/^\d+$/.test(id)) throw new Error('Некорректный SoundCloud-трек')
  if (fresh) streamCache.delete(id)
  const cached = streamCache.get(id)
  if (cached && cached.expires > Date.now()) return cached.stream

  const track = await api<ScTrack>(`/tracks/${id}`)
  const list = (track.media?.transcodings ?? []).filter((t) => Boolean(t.url))
  const usable = list.filter((t) => {
    const protocol = t.format?.protocol
    return protocol === 'hls' || protocol === 'progressive'
  })
  if (!usable.length) throw new Error('SoundCloud не отдал поток для этого трека')
  const rank = (t: ScTranscoding): number => {
    if (t.preset === 'aac_160k') return 0
    if (t.format?.protocol === 'progressive') return 1
    if (t.preset === 'aac_96k') return 2
    return 3
  }
  const chosen = usable.sort((a, b) => rank(a) - rank(b))[0]
  if (!chosen?.url) throw new Error('SoundCloud не отдал поток для этого трека')
  const res = await requestText(
    `${chosen.url}?client_id=${encodeURIComponent(await getClientId())}`
  )
  if (res.status < 200 || res.status >= 300) throw new Error(`SoundCloud stream ${res.status}`)
  const data = JSON.parse(res.body) as { url?: string }
  if (!data.url) throw new Error('SoundCloud вернул пустую ссылку')
  const hls = chosen.format?.protocol === 'hls'
  const bitrateKbps = chosen.preset?.includes('160') ? 160 : chosen.preset?.includes('96') ? 96 : undefined
  const stream: ResolvedStream = {
    url: data.url,
    mime: hls
      ? 'application/vnd.apple.mpegurl'
      : (chosen.format?.mime_type ?? 'audio/mpeg').split(';')[0],
    bitrateKbps,
    hls,
    ttlMs: 45 * 60_000,
    source: 'soundcloud'
  }
  streamCache.set(id, { stream, expires: Date.now() + 45 * 60_000 })
  return stream
}
