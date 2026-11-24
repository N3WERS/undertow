/**
 * Тексты песен из LRCLIB (lrclib.net) — свободная база с LRC-таймингами.
 *
 * Работает без токенов и без Плюса. Стратегия:
 *  1. точный запрос /api/get по артисту, названию и длительности;
 *  2. если не нашлось — /api/search и выбор лучшего варианта по совпадению
 *     названия/артиста и близости длительности.
 * Тексты без таймингов тоже отдаём — показываем как обычный текст.
 */
import type { Track } from './providers/types'

export interface LyricLine {
  /** секунды от начала трека */
  t: number
  text: string
}

export interface Lyrics {
  synced: boolean
  lines: LyricLine[]
  instrumental: boolean
  source: 'lrclib'
}

interface LrclibItem {
  id?: number
  trackName?: string
  artistName?: string
  albumName?: string
  duration?: number
  instrumental?: boolean
  plainLyrics?: string | null
  syncedLyrics?: string | null
}

const UA = 'Undertow/0.1.0 (personal desktop music player)'
const BASE = 'https://lrclib.net/api'
const TIMEOUT = 9000
const TTL = 7 * 24 * 60 * 60 * 1000
const MAX_CACHE = 300

const cache = new Map<string, { at: number; value: Lyrics | null }>()

function keyOf(track: Track): string {
  return `${track.artist.toLowerCase()}|${track.title.toLowerCase()}|${track.durationSec ?? 0}`
}

/** Убираем из названия всё, что мешает поиску: (feat. …), [remix], - Remastered. */
function cleanTitle(title: string): string {
  return title
    .replace(/\((?:feat|ft|with|prod)\.[^)]*\)/gi, ' ')
    .replace(/\[(?:feat|ft|with|prod)\.[^\]]*\]/gi, ' ')
    .replace(/\((?:remaster(?:ed)?|live|radio edit|explicit)[^)]*\)/gi, ' ')
    .replace(/\s+-\s+(?:remaster(?:ed)?|live|radio edit)(?:\s+\d{4})?$/gi, ' ')
    .replace(/\s*[\[(](?:official|lyrics?|audio|video|visualizer)[^\])]*[\])]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function cleanArtist(artist: string): string {
  // «A, B & C» → первый исполнитель: LRCLIB индексирует по основному
  return (artist.split(/\s*(?:,|&|feat\.|ft\.| x |×)\s*/i)[0] ?? artist).replace(/\s+/g, ' ').trim()
}

function parseLrc(text: string): LyricLine[] {
  const out: LyricLine[] = []
  const stamp = /\[(\d{1,3}):(\d{1,2}(?:[.,]\d{1,3})?)\]/g
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line) continue
    const times: number[] = []
    let m: RegExpExecArray | null
    stamp.lastIndex = 0
    while ((m = stamp.exec(line))) {
      const min = Number(m[1])
      const sec = Number(m[2].replace(',', '.'))
      if (Number.isFinite(min) && Number.isFinite(sec)) times.push(min * 60 + sec)
    }
    if (!times.length) continue
    const body = line.replace(stamp, '').trim()
    if (!body) continue
    for (const t of times) out.push({ t, text: body })
  }
  out.sort((a, b) => a.t - b.t)
  return out
}

function toLyrics(item: LrclibItem): Lyrics | null {
  const synced = item.syncedLyrics ? parseLrc(item.syncedLyrics) : []
  if (synced.length) {
    return { synced: true, lines: synced, instrumental: false, source: 'lrclib' }
  }
  if (item.instrumental) {
    return { synced: false, lines: [], instrumental: true, source: 'lrclib' }
  }
  const plain = (item.plainLyrics ?? '').trim()
  if (!plain) return null
  return {
    synced: false,
    lines: plain.split(/\r?\n/).map((text) => ({ t: 0, text })),
    instrumental: false,
    source: 'lrclib'
  }
}

async function api<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`${BASE}${path}`, {
      headers: { 'User-Agent': UA, Accept: 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT)
    })
    if (!res.ok) return null
    return (await res.json()) as T
  } catch {
    return null
  }
}

function score(item: LrclibItem, track: Track, title: string, artist: string): number {
  const want = title.toLowerCase()
  const got = (item.trackName ?? '').toLowerCase()
  let s = 0
  if (got === want) s += 6
  else if (got.includes(want) || want.includes(got)) s += 3
  const wa = artist.toLowerCase()
  const ga = (item.artistName ?? '').toLowerCase()
  if (ga === wa) s += 4
  else if (ga.includes(wa) || wa.includes(ga)) s += 2
  if (track.durationSec && item.duration) {
    const diff = Math.abs(item.duration - track.durationSec)
    if (diff <= 2) s += 5
    else if (diff <= 5) s += 3
    else if (diff <= 12) s += 1
    else s -= 2
  }
  if (item.syncedLyrics) s += 1
  return s
}

export async function get(track: Track): Promise<Lyrics | null> {
  if (!track?.title) return null
  const key = keyOf(track)
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < TTL) return hit.value

  const title = cleanTitle(track.title)
  const artist = cleanArtist(track.artist || '')

  let found: Lyrics | null = null

  // 1. точный эндпоинт: быстрее и без лишней выдачи
  const exact = new URLSearchParams({ track_name: title, artist_name: artist })
  if (track.durationSec) exact.set('duration', String(Math.round(track.durationSec)))
  if (track.album) exact.set('album_name', track.album)
  const direct = await api<LrclibItem>(`/get?${exact.toString()}`)
  if (direct) found = toLyrics(direct)

  // 2. поиск: названия в базах любят отличаться регистром/версиями
  if (!found) {
    const q = new URLSearchParams({ track_name: title, artist_name: artist })
    const list = await api<LrclibItem[]>(`/search?${q.toString()}`)
    const best = (Array.isArray(list) ? list : [])
      .map((item) => ({ item, s: score(item, track, title, artist) }))
      .filter((x) => x.s >= 5)
      .sort((a, b) => b.s - a.s)[0]
    if (best) found = toLyrics(best.item)
  }

  if (cache.size >= MAX_CACHE) cache.clear()
  cache.set(key, { at: Date.now(), value: found })
  return found
}
