/**
 * Страница «Новинки»: свежие релизы артистов, которые чаще всего звучат
 * в библиотеке.
 *
 * Канонический список релизов берём из YouTube Music — он же используется
 * во всех остальных страницах, и он не путает одноимённых артистов с чужими
 * (в iTunes «MACAN» или «YASMI» — не обязательно наши). iTunes Search API
 * нужен только чтобы уточнить точную дату, тип и обложку по названию релиза.
 *
 * Прослушивания — просмотры лучшего совпадения в поиске YouTube (yt-dlp),
 * поэтому площадка всегда подписана как YouTube.
 *
 * Результат кэшируется на 6 часов: это 14 профилей, 14 ответов iTunes и
 * 14 поисков yt-dlp, то есть несколько секунд.
 */
import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { artistWeights } from './browse'
import { ytSearch } from './ytdlp'
import * as youtube from './providers/youtube'

export type ReleaseType = 'single' | 'ep' | 'album'

export interface ReleaseItem {
  id: string
  title: string
  artist: string
  artistId?: string
  /** id альбома YouTube Music без префикса (MPREb…) */
  albumId?: string
  /** YYYY-MM-DD, если известна точная дата; иначе год */
  date?: string
  year?: string
  type: ReleaseType
  coverUrl?: string
  trackCount?: number
  plays?: number
  /** площадка, откуда взято число прослушиваний */
  playsSource?: string
  /** откуда точная дата — для подписи в интерфейсе */
  dateSource?: string
  source: 'itunes' | 'youtube'
}

const TTL_MS = 6 * 60 * 60 * 1000
const CACHE_VERSION = 1
/** сколько артистов из библиотеки проверяем */
const MAX_ARTISTS = 14
const MAX_ITEMS = 24
/** каталог Apple Music: RU-стор с русскими релизами, зарубежные там тоже есть */
const ITUNES_COUNTRY = 'RU'

interface Cache {
  v: number
  at: number
  artists: number
  items: ReleaseItem[]
}

function cachePath(): string {
  return path.join(app.getPath('userData'), 'releases.json')
}

function readCache(): Cache | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(cachePath(), 'utf8')) as Cache
    if (!parsed || parsed.v !== CACHE_VERSION || !Array.isArray(parsed.items)) return null
    return parsed
  } catch {
    return null
  }
}

function writeCache(cache: Cache): void {
  try {
    const file = cachePath()
    fs.writeFileSync(`${file}.tmp`, JSON.stringify(cache), 'utf8')
    fs.renameSync(`${file}.tmp`, file)
  } catch {
    /* кэш не критичен */
  }
}

interface ItunesAlbum {
  collectionId: number
  collectionName: string
  artistName: string
  releaseDate?: string
  trackCount?: number
  artworkUrl100?: string
}

function flat(s: string): string {
  return s
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

function words(s: string): string[] {
  return [...new Set(flat(s).split(' ').filter((w) => w.length >= 3))]
}

/** Совпадение названий релизов по словам, а не по подстроке. */
function titleScore(a: string, b: string): number {
  const aw = words(a)
  const bw = new Set(words(b))
  if (!aw.length || !bw.size) return 0
  const hits = aw.filter((w) => bw.has(w)).length
  return Math.round((hits / Math.max(aw.length, bw.size)) * 100)
}

/**
 * Насколько строка iTunes похожа на нашего артиста. Имена вроде «MACAN» часто
 * совпадают с одноимёнными группами, поэтому засчитываем только точное
 * совпадение или коллаб («MACAN & Kiliana»). Само наличие релиза всё равно
 * проверяется по YouTube Music, iTunes здесь лишь уточняет дату.
 */
function artistScore(wanted: string, got: string): number {
  const a = flat(wanted)
  const b = flat(got)
  if (!a || !b) return 0
  if (a === b) return 100
  if (b.startsWith(`${a} `)) return 80
  return 0
}

function cleanTitle(name: string): string {
  return name.replace(/\s*-\s*(single|ep)\s*$/i, '').trim()
}

function typeOf(album: ItunesAlbum, fallback?: ReleaseType): ReleaseType {
  const name = album.collectionName.toLowerCase()
  if (album.trackCount === 1 || /-\s*single\s*$/.test(name)) return 'single'
  if (/-\s*ep\s*$/.test(name)) return 'ep'
  return fallback ?? 'album'
}

async function itunesAlbums(artist: string): Promise<ItunesAlbum[]> {
  const url =
    'https://itunes.apple.com/search?term=' +
    encodeURIComponent(artist) +
    `&entity=album&limit=50&country=${ITUNES_COUNTRY}`
  const res = await fetch(url, { signal: AbortSignal.timeout(9000) })
  if (!res.ok) return []
  const data = (await res.json()) as { results?: ItunesAlbum[] }
  return Array.isArray(data.results) ? data.results : []
}

/**
 * Ищем в iTunes именно тот релиз, который YouTube Music считает последним:
 * совпадение артиста и названия. Если iTunes отдаёт чужого однофамильца —
 * просто останемся при годе из YouTube Music.
 */
function matchItunes(artist: string, title: string, albums: ItunesAlbum[]): ItunesAlbum | null {
  const wanted = cleanTitle(title)
  const scored = albums
    .map((album) => ({
      album,
      artist: artistScore(artist, album.artistName),
      title: titleScore(wanted, cleanTitle(album.collectionName))
    }))
    .filter((x) => x.artist >= 80 && x.title >= 60 && x.album.releaseDate)
    .sort((a, b) => b.title - a.title || b.artist - a.artist)
  return scored[0]?.album ?? null
}

/**
 * Просмотры: ищем релиз на YouTube и берём число у ролика, где совпадают
 * и название, и артист. Если такого нет — самый просматриваемый из выдачи.
 */
async function playsOf(artist: string, title: string): Promise<number | null> {
  try {
    const rows = await ytSearch(`${artist} ${title}`, 5)
    const wanted = words(title)
    const artistKey = flat(artist)
    const matches = rows.filter((r) => {
      const text = flat(`${r.title} ${r.uploader}`)
      const hits = wanted.filter((w) => text.includes(w)).length
      return hits >= Math.max(1, Math.ceil(wanted.length / 2)) && text.includes(artistKey)
    })
    const best = matches.find((r) => r.views) ?? matches[0] ?? rows.find((r) => r.views)
    return best?.views ?? null
  } catch {
    return null
  }
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<(R | null)[]> {
  const out: (R | null)[] = new Array(items.length).fill(null)
  let next = 0
  const workers = Array.from({ length: Math.min(limit, items.length) || 1 }, async () => {
    while (next < items.length) {
      const i = next++
      try {
        out[i] = await fn(items[i])
      } catch {
        out[i] = null
      }
    }
  })
  await Promise.all(workers)
  return out
}

/** Самый свежий релиз из профиля YouTube Music. */
function newestRef(profile: youtube.YmArtistProfile): youtube.YmAlbumRef | null {
  const albums = profile.albums.filter((a) => a.year && /^\d{4}$/.test(a.year))
  if (!albums.length) return null
  // годы сортируем, внутри года сохраняем порядок YouTube (свежие выше)
  return [...albums].sort((a, b) => Number(b.year) - Number(a.year))[0]
}

export async function list(force = false): Promise<{ items: ReleaseItem[]; updatedAt: number; artists: number }> {
  const cached = readCache()
  if (!force && cached && Date.now() - cached.at < TTL_MS) {
    return { items: cached.items, updatedAt: cached.at, artists: cached.artists }
  }

  const weights = artistWeights().slice(0, MAX_ARTISTS)
  if (!weights.length) return { items: [], updatedAt: Date.now(), artists: 0 }

  const built = await mapLimit(weights, 3, async (w): Promise<ReleaseItem | null> => {
    const profile = await youtube.musicArtist({ name: w.name }).catch(() => null)
    if (!profile) return null
    const ref = newestRef(profile)
    if (!ref) return null

    const [itunes, plays] = await Promise.all([
      itunesAlbums(profile.name).catch(() => [] as ItunesAlbum[]),
      playsOf(profile.name, ref.title)
    ])
    const exact = matchItunes(profile.name, ref.title, itunes)
    const date = exact?.releaseDate?.slice(0, 10) || ref.year
    return {
      id: `yt-album:${ref.id}`,
      title: ref.title,
      artist: profile.name,
      artistId: `yt-artist:${profile.id}`,
      albumId: ref.id,
      date,
      year: (date ?? '').slice(0, 4) || ref.year,
      type: exact ? typeOf(exact, ref.type) : (ref.type ?? 'album'),
      coverUrl: exact?.artworkUrl100?.replace(/\/\d+x\d+bb\./, '/600x600bb.') ?? ref.coverUrl ?? profile.coverUrl,
      trackCount: exact?.trackCount,
      plays: plays ?? undefined,
      playsSource: plays ? 'YouTube' : undefined,
      dateSource: exact ? 'Apple Music' : 'YouTube Music',
      source: exact ? 'itunes' : 'youtube'
    }
  })

  const seen = new Set<string>()
  const items = built
    .filter((x): x is ReleaseItem => Boolean(x))
    .filter((x) => {
      const key = `${flat(x.artist)}|${flat(x.title)}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .sort((a, b) => String(b.date ?? '').localeCompare(String(a.date ?? '')))
    .slice(0, MAX_ITEMS)

  const cache: Cache = { v: CACHE_VERSION, at: Date.now(), artists: weights.length, items }
  writeCache(cache)
  return { items, updatedAt: cache.at, artists: weights.length }
}
