/**
 * Перенос лайков из импортированной библиотеки Яндекса в YouTube.
 *
 * Яндекс-API здесь не используется: берём треки, которые уже лежат в
 * library.json, ищем их на YouTube Music и добавляем найденную YouTube-копию
 * в лайки. Положительные и отрицательные результаты кэшируются, чтобы
 * повторный импорт не искал одно и то же заново.
 */
import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import type { Track } from './providers/types'
import * as youtube from './providers/youtube'
import { mergeLikes, snapshot } from './library'

export interface YoutubeImportResult {
  imported: number
  searched: number
  skipped: number
  remaining: number
  total: number
}

interface CachedHit {
  track: Track
  at: number
}

interface CachedMiss {
  miss: true
  at: number
  v?: number
}

type CacheFile = Record<string, CachedHit | CachedMiss>

const CACHE_TTL = 30 * 24 * 60 * 60_000
const MISS_VERSION = 2
const BAD_VERSION =
  /(remix|slowed|sped\s*up|nightcore|8d|reverb|cover|karaoke|instrumental|mashup|bootleg|live|ремикс|кавер|караоке|замедлен|ускорен|реверб)/i

let cache: CacheFile | null = null

function cachePath(): string {
  return path.join(app.getPath('userData'), 'yt-import-map.json')
}

function loadCache(): CacheFile {
  if (cache) return cache
  try {
    cache = JSON.parse(fs.readFileSync(cachePath(), 'utf8')) as CacheFile
  } catch {
    cache = {}
  }
  return cache
}

function saveCache(): void {
  if (!cache) return
  try {
    const file = cachePath()
    fs.writeFileSync(`${file}.tmp`, JSON.stringify(cache), 'utf8')
    fs.renameSync(`${file}.tmp`, file)
  } catch {
    /* импорт не должен падать из-за кэша */
  }
}

function norm(s: string): string {
  return s
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/\([^)]*\)|\[[^\]]*\]/g, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function words(s: string): Set<string> {
  const all = norm(s).split(' ').filter(Boolean)
  const long = all.filter((w) => w.length > 1)
  // «П О Р Ш Е» и другие названия по буквам не должны превращаться в пустой набор
  return new Set(long.length ? long : all)
}

function overlap(a: string, b: string): number {
  const ta = words(a)
  const tb = words(b)
  if (!ta.size || !tb.size) return 0
  let hit = 0
  for (const w of ta) if (tb.has(w)) hit += 1
  return hit / Math.min(ta.size, tb.size)
}

function clean(s: string): string {
  return s
    .replace(/\((?:feat|ft|prod|remaster|live|version)[^)]*\)/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function firstArtist(s: string): string {
  return s.split(/\s*(?:,|&|feat\.|ft\.)\s*/i)[0]?.trim() || s
}

function matchScore(source: Track, candidate: Track): number {
  if (!candidate.playable || candidate.provider !== 'youtube') return -1
  const title = overlap(clean(source.title), clean(candidate.title))
  const artist = overlap(firstArtist(source.artist), firstArtist(candidate.artist))
  if (title < 0.65) return -1
  let score = title * 0.7 + artist * 0.3
  // чужой исполнитель при точном названии — почти всегда кавер/ремикс/одноимённый трек
  if (artist === 0) score -= 0.2
  if (source.durationSec && candidate.durationSec) {
    const delta = Math.abs(source.durationSec - candidate.durationSec)
    if (delta > 30) score -= 0.25
    else if (delta < 8) score += 0.05
  }
  return score
}

async function findYoutube(track: Track): Promise<Track | null> {
  const artist = firstArtist(track.artist)
  const title = clean(track.title)
  const queries = [
    `${artist} ${title}`,
    title,
    `${artist} ${title.split(/\s[-–—]\s/)[0]}`
  ]
    .map((q) => q.replace(/\s+/g, ' ').trim())
    .filter((q, i, list) => q && list.indexOf(q) === i)

  let best: Track | null = null
  let bestScore = 0

  for (const query of queries) {
    const found = await youtube.search(query, 8).catch(() => [] as Track[])
    for (const candidate of found) {
      if (BAD_VERSION.test(candidate.title)) continue
      if (/^(youtube|topic|various artists|auto-generated)$/i.test(firstArtist(candidate.artist))) continue
      const score = matchScore(track, candidate)
      if (score > bestScore) {
        best = candidate
        bestScore = score
      }
    }
    if (bestScore >= 0.85) break
  }

  return bestScore >= 0.7 ? best : null
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) || 1 }, async () => {
      while (next < items.length) {
        const i = next++
        out[i] = await fn(items[i])
      }
    })
  )
  return out
}

export interface ImportEntry {
  track: Track
  likedAt?: number
}

export interface ImportOptions {
  /** 0 или не задано — обработать всё; иначе максимум треков за вызов. */
  limit?: number
  concurrency?: number
}

/**
 * Ищет YouTube-копии для переданных Яндекс-треков и добавляет в лайки
 * только YouTube-версии. Сами Яндекс-треки в библиотеку не попадают.
 */
export async function importTracks(
  input: ImportEntry[],
  options: ImportOptions = {}
): Promise<YoutubeImportResult> {
  const lib = snapshot()
  const known = loadCache()
  const seen = new Set<string>()
  const all = input.filter((e) => {
    const t = e.track
    if (!t || t.provider !== 'yandex' || !t.playable) return false
    if (seen.has(t.id)) return false
    seen.add(t.id)
    return true
  })
  const max = options.limit && options.limit > 0 ? Math.min(all.length, Math.floor(options.limit)) : all.length
  const queue = all.slice(0, max)
  const usedYt = new Set<string>()
  let searched = 0
  let skipped = 0

  const results = await mapLimit(queue, Math.max(1, options.concurrency ?? 6), async (entry) => {
    const track = entry.track
    const cached = known[track.id]
    let found: Track | null = null

    if (cached && !('miss' in cached) && Date.now() - cached.at < CACHE_TTL) {
      found = cached.track
    } else if (
      cached &&
      'miss' in cached &&
      cached.v === MISS_VERSION &&
      Date.now() - cached.at < CACHE_TTL
    ) {
      skipped += 1
      return null
    } else {
      searched += 1
      found = await findYoutube(track).catch(() => null)
      known[track.id] = found
        ? { track: found, at: Date.now() }
        : { miss: true, at: Date.now(), v: MISS_VERSION }
    }

    if (!found || usedYt.has(found.id)) {
      skipped += 1
      return null
    }
    usedYt.add(found.id)
    return { track: found, likedAt: entry.likedAt ?? lib.likedAt?.[track.id] ?? Date.now() }
  })

  const entries = results.filter((x): x is { track: Track; likedAt: number } => x !== null)
  const imported = mergeLikes(entries)
  saveCache()

  return {
    imported,
    searched,
    skipped,
    remaining: Math.max(0, all.length - queue.length),
    total: input.length
  }
}

/** Перенос Яндекса, который уже лежит в локальной библиотеке. */
export async function importYoutubeFromYandex(limit = 20): Promise<YoutubeImportResult> {
  const lib = snapshot()
  const entries = lib.likes
    .filter((t) => t.provider === 'yandex' && t.playable)
    .map((track) => ({ track, likedAt: lib.likedAt?.[track.id] }))
  return importTracks(entries, { limit })
}
