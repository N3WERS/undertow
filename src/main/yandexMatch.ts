/**
 * Поиск того же трека в Яндексе по метаданным YouTube Music.
 *
 * Нужен для правила «метаданные и каталог — YouTube Music, звук — Яндекс,
 * если есть Плюс». Первый запуск трека стоит один поиск в Яндексе, дальше
 * пара лежит в `ym-map.json`. Отрицательный результат тоже кэшируется, чтобы
 * не искать заново треки, которых в Яндексе нет.
 */
import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import * as yandex from './providers/yandex'
import type { Track } from './providers/types'

interface Hit {
  ymId: string
  title: string
  artist: string
  durationSec: number | null
  delta: number
  at: number
}

interface Miss {
  miss: true
  at: number
}

type MapFile = Record<string, Hit | Miss>

const POS_TTL = 90 * 24 * 60 * 60 * 1000
const NEG_TTL = 3 * 24 * 60 * 60 * 1000
const MAX_ENTRIES = 4000
const MAX_DELTA = 8

const BAD_VERSION =
  /(remix|slowed|sped ?up|nightcore|8d|reverb|cover|acoustic|piano|instrumental|karaoke|tribute|минус|\blive\b|\bextended\b|rework|bootleg|mashup)/i

let cache: MapFile | null = null

function filePath(): string {
  return path.join(app.getPath('userData'), 'ym-map.json')
}

function load(): MapFile {
  if (cache) return cache
  try {
    cache = JSON.parse(fs.readFileSync(filePath(), 'utf8')) as MapFile
  } catch {
    cache = {}
  }
  return cache
}

function save(): void {
  if (!cache) return
  try {
    fs.writeFileSync(`${filePath()}.tmp`, JSON.stringify(cache), 'utf8')
    fs.renameSync(`${filePath()}.tmp`, filePath())
  } catch (e) {
    console.error('[yandex-match] не сохранил карту:', e instanceof Error ? e.message : e)
  }
}

function norm(s: string): string {
  return s
    .toLowerCase()
    .replace(/\([^)]*\)|\[[^\]]*\]/g, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function overlap(a: string, b: string): number {
  const ta = new Set(norm(a).split(' ').filter((w) => w.length > 1))
  const tb = new Set(norm(b).split(' ').filter((w) => w.length > 1))
  if (!ta.size || !tb.size) return 0
  let hit = 0
  for (const w of ta) if (tb.has(w)) hit += 1
  return hit / Math.max(ta.size, tb.size)
}

function clean(s: string): string {
  return s.replace(/\((?:feat|ft|prod|remaster|live|version)[^)]*\)/gi, ' ').replace(/\s+/g, ' ').trim()
}

function firstArtist(artist: string): string {
  return artist.split(/\s*(?:,|&|feat\.|ft\.)\s*/i)[0]?.trim() || artist
}

export async function toYandex(token: string, track: Track): Promise<string | null> {
  const key = track.id
  const map = load()
  const saved = map[key]
  if (saved) {
    if ('miss' in saved ? Date.now() - saved.at < NEG_TTL : Date.now() - saved.at < POS_TTL) {
      return 'miss' in saved ? null : saved.ymId
    }
  }

  const query = `${firstArtist(track.artist)} ${clean(track.title)}`.replace(/\s+/g, ' ').trim()
  if (!query) return null

  let found: Scored | null = null
  try {
    const candidates = await yandex.search(token, query, 12)
    found = pick(track, candidates)
  } catch {
    // сеть или Яндекс икнули: не кэшируем промах, попробуем в следующий раз
    return null
  }

  if (!found) {
    store(key, { miss: true, at: Date.now() })
    return null
  }
  store(key, {
    ymId: found.id,
    title: found.title,
    artist: found.artist,
    durationSec: found.durationSec ?? null,
    delta: found.delta,
    at: Date.now()
  })
  return found.id
}

interface Scored extends Track {
  delta: number
  score: number
}

function pick(want: Track, list: Track[]): Scored | null {
  const wantTitle = norm(want.title)
  const wantArtist = firstArtist(want.artist)
  const wantHasBad = BAD_VERSION.test(want.title)
  let best: Scored | null = null

  for (const c of list) {
    if (!c.playable || !c.id.startsWith('ym:')) continue
    const gotTitle = norm(c.title)
    if (!gotTitle) continue
    const titleHit =
      gotTitle === wantTitle
        ? 1
        : gotTitle.includes(wantTitle) || wantTitle.includes(gotTitle)
          ? 0.78
          : overlap(want.title, c.title)
    const artistHit = Math.max(overlap(wantArtist, c.artist), overlap(want.artist, c.artist))
    if (titleHit < 0.6 || artistHit < 0.33) continue
    if (!wantHasBad && BAD_VERSION.test(c.title)) continue

    const delta =
      want.durationSec && c.durationSec ? Math.abs(want.durationSec - c.durationSec) : 0
    if (want.durationSec && c.durationSec && delta > MAX_DELTA) continue

    const score = titleHit + artistHit * 0.5 - delta / 60
    if (!best || score > best.score) best = { ...c, delta: Math.round(delta), score }
  }
  return best && best.score >= 0.95 ? best : null
}

function store(key: string, value: Hit | Miss): void {
  const map = load()
  map[key] = value
  const keys = Object.keys(map)
  if (keys.length > MAX_ENTRIES) {
    for (const k of keys.slice(0, keys.length - MAX_ENTRIES)) delete map[k]
  }
  save()
}
