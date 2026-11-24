/**
 * Жанры артистов для «Течения по жанрам».
 *
 * Жанр в музыкальных API есть только на уровне артиста/альбома, поэтому
 * рулим артистами, а не отдельными треками. Источников два, гибрид:
 *   • iTunes Search API — есть всегда, отдаёт человеческие русские жанры
 *     («Хип-хоп», «Хард-рок»), но не знает часть нишевых артистов;
 *   • Яндекс (`/artists/{id}.genres`) — только при сохранённом токене,
 *     отдаёт слуги вроде `foreignrap`, зато это сам Яндекс.
 *
 * Всё сводится к фиксированным корзинам (`BUCKETS`), чтобы в чипах не
 * появлялись «Зимние праздники». Список жанров динамический: показываем
 * только те корзины, которые реально встречаются в библиотеке, и сортируем
 * по весу артистов.
 *
 * Кэш: `%APPDATA%/Undertow/genres.json`, живёт 120 дней. Тегируются только
 * верхние 48 артистов по весу — этого хватает и для чипов, и для семян.
 */
import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { snapshot } from './library'
import { artistWeights } from './browse'
import { getYandexToken } from './store'
import * as yandex from './providers/yandex'

interface Bucket {
  id: string
  name: string
  words: string[]
}

/** Порядок важен: «инди-рок» должен попасть в инди, а не в рок. */
const BUCKETS: Bucket[] = [
  {
    id: 'hiphop',
    name: 'хип-хоп',
    words: ['хип-хоп', 'хип хоп', 'хипхоп', 'рэп', 'rap', 'hip hop', 'hip-hop', 'hiphop', 'trap', 'трэп', 'drill']
  },
  { id: 'indie', name: 'инди', words: ['инди', 'indie'] },
  {
    id: 'rock',
    name: 'рок',
    words: ['рок', 'rock', 'метал', 'metal', 'панк', 'punk', 'альтернатив', 'alternative', 'гранж', 'grunge']
  },
  {
    id: 'pop',
    name: 'поп',
    words: ['поп', 'pop', 'вокал', 'vocal', 'танцевальная поп', 'dance pop', 'dancepop']
  },
  {
    id: 'electronic',
    name: 'электроника',
    words: [
      'электрон',
      'electronic',
      'electro',
      'techno',
      'техно',
      'house',
      'хаус',
      'trance',
      'транс',
      'dubstep',
      'дабстеп',
      'ambient',
      'эмбиент',
      'dance',
      'танцевальн',
      'idm',
      'edm',
      'synth'
    ]
  },
  {
    id: 'rnb',
    name: 'R&B и соул',
    words: ['r&b', 'rnb', 'r n b', 'соул', 'soul', 'фанк', 'funk', 'госпел', 'gospel']
  },
  { id: 'jazz', name: 'джаз', words: ['джаз', 'jazz'] },
  { id: 'classical', name: 'классика', words: ['классик', 'classical', 'опера', 'opera'] },
  { id: 'soundtrack', name: 'саундтреки', words: ['саундтрек', 'soundtrack', 'score', 'ost'] },
  {
    id: 'folk',
    name: 'фолк',
    words: ['фолк', 'folk', 'этно', 'ethno', 'кантри', 'country', 'авторская']
  },
  { id: 'reggae', name: 'регги', words: ['регги', 'reggae', 'ска', 'ska'] },
  { id: 'latin', name: 'латина', words: ['латин', 'latin'] },
  { id: 'blues', name: 'блюз', words: ['блюз', 'blues'] },
  { id: 'chanson', name: 'шансон', words: ['шансон', 'chanson'] }
]

const BUCKET_BY_ID = new Map(BUCKETS.map((b) => [b.id, b]))

export interface GenreArtist {
  name: string
  weight: number
  coverUrl?: string
  artistId?: string
}

export interface GenreInfo {
  id: string
  name: string
  /** сколько артистов из библиотеки помечено этим жанром */
  artists: number
  /** суммарный вес (лайк = 3, прослушивание = 1) */
  weight: number
}

interface Entry {
  at: number
  genres: string[]
  source: 'itunes' | 'yandex' | 'both'
}

interface CacheFile {
  v: number
  artists: Record<string, Entry>
}

const TTL_MS = 120 * 24 * 60 * 60 * 1000
const CACHE_VERSION = 4
/** сколько артистов библиотеки тегировать (сверху по весу) */
const MAX_TAG = 120
const PARALLEL = 5

let cache: Map<string, Entry> | null = null
let pending: Promise<void> | null = null
let dirty = false

function cachePath(): string {
  return path.join(app.getPath('userData'), 'genres.json')
}

function key(name: string): string {
  return name
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Первый исполнитель в строке «A, B» — по нему и ищем жанр. */
function primary(name: string): string {
  return name.split(',')[0].trim()
}

function bucketOf(label: string): string | null {
  const l = label.toLowerCase().replace(/ё/g, 'е')
  for (const b of BUCKETS) {
    if (b.words.some((w) => l.includes(w))) return b.id
  }
  return null
}

function loadFile(): void {
  if (cache) return
  cache = new Map()
  try {
    const parsed = JSON.parse(fs.readFileSync(cachePath(), 'utf8')) as CacheFile
    if (parsed?.v !== CACHE_VERSION || !parsed.artists) return
    for (const [name, entry] of Object.entries(parsed.artists)) {
      if (entry && Array.isArray(entry.genres)) cache.set(name, entry)
    }
  } catch {
    /* первый запуск — кэша нет */
  }
}

function saveFile(): void {
  if (!cache || !dirty) return
  try {
    const file = cachePath()
    const data: CacheFile = { v: CACHE_VERSION, artists: Object.fromEntries(cache) }
    fs.writeFileSync(`${file}.tmp`, JSON.stringify(data), 'utf8')
    fs.renameSync(`${file}.tmp`, file)
    dirty = false
  } catch {
    /* кэш не критичен */
  }
}

function fresh(entry: Entry | undefined): boolean {
  return Boolean(entry && Date.now() - entry.at < TTL_MS)
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<void> {
  let next = 0
  const workers = Array.from({ length: Math.min(limit, items.length) || 1 }, async () => {
    while (next < items.length) {
      const i = next++
      try {
        await fn(items[i])
      } catch {
        /* один артист не должен ломать остальные */
      }
    }
  })
  await Promise.all(workers)
}

/* -------------------------------- источники ------------------------------- */

interface ItunesAlbum {
  artistName?: string
  primaryGenreName?: string
}

function nameScore(wanted: string, got: string): number {
  const a = key(wanted)
  const b = key(got)
  if (!a || !b) return 0
  if (a === b) return 100
  if (b.startsWith(`${a} `)) return 80
  return 0
}

async function itunesGenres(name: string): Promise<string[]> {
  const url =
    'https://itunes.apple.com/search?term=' +
    encodeURIComponent(name) +
    '&entity=album&limit=50&country=RU'
  const res = await fetch(url, { signal: AbortSignal.timeout(9000) })
  if (!res.ok) return []
  const data = (await res.json()) as { results?: ItunesAlbum[] }
  const counts = new Map<string, number>()
  for (const album of data.results ?? []) {
    if (nameScore(name, String(album.artistName ?? '')) < 80) continue
    const bucket = bucketOf(String(album.primaryGenreName ?? ''))
    if (!bucket) continue
    counts.set(bucket, (counts.get(bucket) ?? 0) + 1)
  }
  // только самый частый жанр: второй часто оказывается случайным
  // («регги» у рэпера из-за одного альбома-однофамильца)
  const best = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]
  if (!best) return []
  // одно совпадение принимаем (у многих артистов всего один релиз в iTunes),
  // но если альбомов несколько, жанр должен подтвердиться хотя бы дважды
  const matched = [...counts.values()].reduce((a, b) => a + b, 0)
  if (matched > 1 && best[1] < 2) return []
  return [best[0]]
}

/** Числовые id Яндекса из библиотеки: по ним жанр приходит без поиска. */
function yandexIds(): Map<string, string> {
  const out = new Map<string, string>()
  const lib = snapshot()
  for (const t of [...lib.likes, ...lib.history]) {
    if (t.provider !== 'yandex' || !t.artistId || !/^\d+$/.test(t.artistId)) continue
    const name = (t.artists?.[0]?.name ?? t.artist ?? '').split(',')[0].trim()
    if (name && !out.has(key(name))) out.set(key(name), t.artistId)
  }
  return out
}

async function tagOne(name: string, ymId: string | undefined, token: string | null): Promise<Entry> {
  const [fromItunes, fromYandex] = await Promise.all([
    itunesGenres(name).catch(() => [] as string[]),
    ymId && token ? yandex.artistGenres(token, ymId).catch(() => [] as string[]) : Promise.resolve([])
  ])
  // Если артист есть в Яндексе, верим его первому жанру: iTunes часто
  // находит однофамильца и приносит «регги» рэперу. iTunes — только когда
  // Яндекса нет или он ничего не сказал.
  const ym = fromYandex.map(bucketOf).filter((x): x is string => Boolean(x)).slice(0, 1)
  const genres = ym.length ? ym : fromItunes.slice(0, 1)
  const source: Entry['source'] =
    fromItunes.length && ym.length ? 'both' : ym.length ? 'yandex' : 'itunes'
  return { at: Date.now(), genres, source }
}

/* --------------------------------- публичное ------------------------------- */

/**
 * Загружает кэш и дозаполняет жанры верхних артистов библиотеки.
 * При отсутствии сети просто остаются уже известные теги.
 */
export async function ensure(): Promise<void> {
  loadFile()
  if (pending) return pending
  pending = (async () => {
    const weights = artistWeights().slice(0, MAX_TAG)
    const ids = yandexIds()
    const token = getYandexToken()
    const todo = weights.filter((w) => !fresh(cache?.get(key(w.name)))).map((w) => w.name)
    if (!todo.length) return
    await mapLimit(todo, PARALLEL, async (name) => {
      const entry = await tagOne(primary(name), ids.get(key(name)), token)
      if (!cache) cache = new Map()
      const previous = cache.get(key(name))
      // не затираем хорошие теги пустым ответом сети
      if (entry.genres.length || !previous?.genres.length) {
        cache.set(key(name), entry)
        dirty = true
      }
    })
    saveFile()
  })()
  try {
    await pending
  } finally {
    pending = null
  }
}

/** Жанры, которые реально есть в библиотеке, сверху — самые «весомые». */
export function list(): GenreInfo[] {
  loadFile()
  const byGenre = new Map<string, GenreInfo>()
  for (const w of artistWeights()) {
    const entry = cache?.get(key(w.name))
    if (!entry?.genres.length) continue
    for (const id of entry.genres) {
      const bucket = BUCKET_BY_ID.get(id)
      if (!bucket) continue
      const row = byGenre.get(id) ?? { id, name: bucket.name, artists: 0, weight: 0 }
      row.artists++
      row.weight += w.score
      byGenre.set(id, row)
    }
  }
  // один артист — это ещё не жанр, а вот два уже дают поток с соседями
  return [...byGenre.values()]
    .filter((g) => g.artists >= 2)
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 8)
}

/** Топ артистов жанра из библиотеки — для страницы «Жанры». */
export function detail(id: string): { genre: GenreInfo | null; artists: GenreArtist[] } {
  loadFile()
  const info = list().find((g) => g.id === id) ?? null
  const lib = snapshot()

  // обложка и id артиста — из любого его трека в библиотеке
  const meta = new Map<string, { coverUrl?: string; artistId?: string }>()
  for (const t of [...lib.likes, ...lib.history]) {
    const name = (t.artists?.[0]?.name ?? t.artist ?? '').split(',')[0].trim()
    if (!name) continue
    const k = key(name)
    const prev = meta.get(k)
    if (!prev || (!prev.coverUrl && t.coverUrl)) {
      meta.set(k, { coverUrl: prev?.coverUrl ?? t.coverUrl, artistId: prev?.artistId ?? t.artistId })
    }
  }

  const artists = artistWeights()
    .filter((w) => matches(w.name, id))
    .slice(0, 24)
    .map((w) => {
      const m = meta.get(key(w.name))
      return { name: w.name, weight: w.score, coverUrl: m?.coverUrl, artistId: m?.artistId }
    })
  return { genre: info, artists }
}

export function nameOf(id: string): string {
  return BUCKET_BY_ID.get(id)?.name ?? id
}

/** Жанр известен (есть хотя бы один тег) — иначе артист считается неизвестным. */
export function known(name: string): boolean {
  loadFile()
  return Boolean(cache?.get(key(name))?.genres.length)
}

/** Артист помечен этим жанром. Неизвестные сюда не попадают — см. known(). */
export function matches(name: string, genre: string): boolean {
  loadFile()
  return Boolean(cache?.get(key(name))?.genres.includes(genre))
}
