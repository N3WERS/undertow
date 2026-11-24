import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { snapshot } from './library'
import type { Section, Track } from './providers/types'
import * as yandex from './providers/yandex'
import * as prefs from './recPrefs'
import * as browse from './browse'

/**
 * Главная «от библиотеки»: собираем персональные секции из лайков и истории.
 *
 * Логика намеренно простая и объяснимая — никакой модели, только счётчики:
 *   продолжить слушать  → история;
 *   ещё от артиста      → те, кого лайкают чаще всего (artistId из /tracks);
 *   любимый альбом      → альбомы, откуда больше всего лайков;
 *   новое от артиста    → свежий альбом любимого артиста;
 *   давно не слушали    → лайк, который не играл 90+ дней.
 *
 * Результат кэшируется на несколько часов: сборка — это 5–9 запросов к API.
 */

const TTL_MS = 6 * 60 * 60 * 1000
const MIN_LIKES = 15
/** сколько секций «Ещё от …» собирать и сколько в них треков */
const ARTIST_SECTIONS = 6
const ARTIST_TRACKS = 20
const RECENT_DAYS = 45
const FORGOTTEN_DAYS = 90

/** Меняем при изменении формата треков в кэше (например, добавили artistId). */
const CACHE_VERSION = 7

interface Cache {
  v: number
  at: number
  likes: number
  sections: Section[]
}

function cachePath(): string {
  return path.join(app.getPath('userData'), 'home-rec.json')
}

function readCache(): Cache | null {
  try {
    const raw = fs.readFileSync(cachePath(), 'utf8')
    const parsed = JSON.parse(raw) as Cache
    if (!parsed?.sections || !Array.isArray(parsed.sections)) return null
    if (parsed.v !== CACHE_VERSION) return null
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
    /* кэш — не критично */
  }
}

/** Сбрасывает кэш (кнопка «обновить подборку» или изменения в библиотеке). */
export function invalidate(): void {
  try {
    fs.rmSync(cachePath(), { force: true })
  } catch {
    /* пусто */
  }
}

/* --------------------------- профиль пользователя ------------------------- */

interface ArtistStat {
  id: string
  name: string
  likes: number
}
interface AlbumStat {
  id: string
  title: string
  artist: string
  year?: number
  likes: number
}

function bump<T extends { likes: number }>(map: Map<string, T>, key: string, make: () => T): void {
  const cur = map.get(key)
  if (cur) cur.likes++
  else map.set(key, make())
}

/** Артисты и альбомы, которые чаще всего встречаются в лайках. */
async function profile(token: string, likes: Track[]): Promise<{ artists: ArtistStat[]; albums: AlbumStat[] }> {
  const ymLikes = likes.filter((t) => t.provider === 'yandex').slice(0, 200)
  const ids = ymLikes.map((t) => t.id.replace(/^ym:/, ''))
  const artists = new Map<string, ArtistStat>()
  const albums = new Map<string, AlbumStat>()

  for (let i = 0; i < ids.length; i += 100) {
    const batch = ids.slice(i, i + 100)
    const meta = await yandex.tracksMeta(token, batch).catch(() => [])
    for (const m of meta) {
      if (m.artistId && m.artistName) {
        bump(artists, m.artistId, () => ({ id: m.artistId as string, name: m.artistName as string, likes: 0 }))
      }
      if (m.albumId && m.albumTitle) {
        bump(albums, m.albumId, () => ({
          id: m.albumId as string,
          title: m.albumTitle as string,
          artist: m.artistName ?? '',
          year: m.year,
          likes: 0
        }))
      }
    }
  }

  return {
    artists: [...artists.values()].sort((a, b) => b.likes - a.likes),
    albums: [...albums.values()].sort((a, b) => b.likes - a.likes)
  }
}

/** Убирает секции, которые пользователь скрыл. Применяется и к кэшу: скрытие
 *  и возврат работают без пересборки подборки. */
export function applyPrefs(sections: Section[]): Section[] {
  const hidden = prefs.hidden()
  if (!hidden.length) return sections
  return sections.filter((s) => !hidden.includes(s.id))
}

/* --------------------- без Яндекса: только свои данные -------------------- */

/**
 * Подборка из того, что уже лежит локально. Нужна, когда Яндекс недоступен:
 * обнаружить новых артистов без API нельзя, но «продолжить» и «давно не
 * слушали» собираются из библиотеки и работают всегда.
 */
export function localSections(): Section[] {
  const lib = snapshot()
  if (lib.likes.length < MIN_LIKES) return []
  const playedAt = lib.playedAt ?? {}
  const sections: Section[] = []
  const used = new Set<string>()

  const resume: Track[] = []
  const seen = new Set<string>()
  for (const t of lib.history) {
    if (!t.playable || seen.has(t.id)) continue
    seen.add(t.id)
    resume.push(t)
    if (resume.length >= 12) break
  }
  if (resume.length >= 4) {
    for (const t of resume) used.add(t.id)
    sections.push({ id: 'rec-resume', title: 'Продолжить слушать', layout: 'list', items: resume })
  }

  const now = Date.now()
  const forgotten = lib.likes
    .filter((t) => {
      if (!t.playable || used.has(t.id)) return false
      const at = playedAt[t.id]
      return !at || now - at > FORGOTTEN_DAYS * 864e5
    })
    .sort(() => Math.random() - 0.5)
    .slice(0, 18)
  if (forgotten.length >= 6) {
    sections.push({ id: 'rec-forgotten', title: 'Давно не слушали', layout: 'list', items: forgotten })
  }

  return sections
}

const LOCAL_TTL_MS = 6 * 60 * 60 * 1000
/** сколько секций «Ещё от …» показываем на главной без Плюса */
const LOCAL_ARTISTS = 6
const LOCAL_ARTIST_TRACKS = 16
let localCache: { at: number; likes: number; sections: Section[] } | null = null

/** «1 альбом / 2 альбома / 5 альбомов» */
function plural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return `${n} ${one}`
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${n} ${few}`
  return `${n} ${many}`
}

/** Параллельные запросы с ограничением: страницы артистов тяжёлые. */
async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<(R | null)[]> {
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

/**
 * Подборка без Яндекса: локальные секции + «Ещё от …» для любимых артистов,
 * по несколько штук за раз (раньше было только два артиста). Секции несут
 * аватар и подпись, чтобы главная выглядела как лента, а не список строк.
 */
export async function localHome(): Promise<Section[]> {
  const lib = snapshot()
  if (localCache && Date.now() - localCache.at < LOCAL_TTL_MS && Math.abs(localCache.likes - lib.likes.length) < 10) {
    return applyPrefs(localCache.sections)
  }

  const sections = localSections()
  const used = new Set(sections.flatMap((s) => s.items.map((t) => t.id)))
  const likedIds = new Set(lib.likes.map((t) => t.id))

  // кого чаще лайкают — тех и показываем; берём с запасом, часть отсеется
  const candidates = browse
    .artistWeights()
    .filter((a) => a.score >= 5)
    .slice(0, LOCAL_ARTISTS + 4)

  const pages = await mapLimit(candidates, 3, (artist) =>
    browse.youtubeArtistPage({ name: artist.name }).catch(() => null)
  )

  let added = 0
  for (const page of pages) {
    if (added >= LOCAL_ARTISTS) break
    if (!page) continue
    const items = page.tracks.filter((t) => !likedIds.has(t.id) && !used.has(t.id)).slice(0, LOCAL_ARTIST_TRACKS)
    if (items.length < 5) continue
    for (const t of items) used.add(t.id)
    const bits: string[] = []
    const albums = page.albums ?? []
    if (albums.length) bits.push(plural(albums.length, 'альбом', 'альбома', 'альбомов'))
    if (page.tracks.length) bits.push(plural(page.tracks.length, 'трек', 'трека', 'треков'))
    sections.push({
      id: `rec-artist-name:${encodeURIComponent(page.title)}`,
      title: `Ещё от ${page.title}`,
      layout: 'list',
      items,
      subtitle: bits.join(' · '),
      coverUrl: page.coverUrl,
      albums: (page.albums ?? []).filter((a) => a.coverUrl).slice(0, 6)
    })
    added += 1
  }

  localCache = { at: Date.now(), likes: lib.likes.length, sections }
  return applyPrefs(sections)
}

/* ------------------------------- сборка ---------------------------------- */

interface BuildArgs {
  token: string
  force?: boolean
}

export async function build({ token, force }: BuildArgs): Promise<Section[]> {
  const lib = snapshot()
  if (lib.likes.length < MIN_LIKES) return []

  const cached = readCache()
  if (!force && cached) {
    const fresh = Date.now() - cached.at < TTL_MS
    // библиотека заметно изменилась — подборку стоит пересобрать
    const sameLibrary = Math.abs(cached.likes - lib.likes.length) < 10
    if (fresh && sameLibrary) return cached.sections
  }

  const sections = await compose(token, lib.likes, lib.history, lib.playedAt ?? {})
  if (sections.length) writeCache({ v: CACHE_VERSION, at: Date.now(), likes: lib.likes.length, sections })
  return sections
}

async function compose(
  token: string,
  likes: Track[],
  history: Track[],
  playedAt: Record<string, number>
): Promise<Section[]> {
  const now = Date.now()
  const likedIds = new Set(likes.map((t) => t.id))
  const recentIds = new Set(
    Object.entries(playedAt)
      .filter(([, at]) => now - at < RECENT_DAYS * 864e5)
      .map(([id]) => id)
  )
  const used = new Set<string>()
  const sections: Section[] = []

  const push = (
    id: string,
    title: string,
    items: Track[],
    extra?: Pick<Section, 'subtitle' | 'coverUrl' | 'albums'>
  ): void => {
    if (!items.length) return
    for (const t of items) used.add(t.id)
    sections.push({ id, title, layout: 'list', items, ...extra })
  }

  /** Свежие для пользователя треки: не лайкнутые, не игранные недавно, не занятые. */
  const fresh = (list: Track[], min: number, limit: number): Track[] => {
    const out: Track[] = []
    for (const t of list) {
      if (!t.playable || used.has(t.id) || likedIds.has(t.id) || recentIds.has(t.id)) continue
      if (out.some((x) => x.id === t.id)) continue
      out.push(t)
      if (out.length >= limit) break
    }
    return out.length >= min ? out : []
  }

  // 1. Продолжить слушать — история без повторов
  const resume: Track[] = []
  const seen = new Set<string>()
  for (const t of history) {
    if (!t.playable || seen.has(t.id)) continue
    seen.add(t.id)
    resume.push(t)
    if (resume.length >= 12) break
  }
  push('rec-resume', 'Продолжить слушать', resume)

  const { artists, albums } = await profile(token, likes).catch(() => ({ artists: [], albums: [] }))

  // 2. Ещё от любимых артистов — до шести штук, у каждого аватар и подпись
  const topArtists = artists.filter((a) => a.likes >= 2).slice(0, ARTIST_SECTIONS)
  const artistSections = await Promise.allSettled(
    topArtists.map((a) => yandex.artistPage(token, a.id))
  )
  for (const res of artistSections) {
    if (res.status !== 'fulfilled') continue
    const page = res.value
    const items = fresh(page.tracks, 5, ARTIST_TRACKS)
    if (items.length) {
      push(`rec-artist-${page.id}`, `Ещё от ${page.title}`, items, {
        subtitle: page.subtitle,
        coverUrl: page.coverUrl,
        albums: (page.albums ?? []).filter((a) => a.coverUrl).slice(0, 6)
      })
    }
  }

  // 3. Давно не слушали — лайки, которые не играли 90+ дней (или никогда)
  const forgotten = likes
    .filter((t) => {
      if (!t.playable || used.has(t.id)) return false
      const at = playedAt[t.id]
      return !at || now - at > FORGOTTEN_DAYS * 864e5
    })
    .sort(() => Math.random() - 0.5)
    .slice(0, 18)
  if (forgotten.length >= 6) push('rec-forgotten', 'Давно не слушали', forgotten)

  // 4. Любимые альбомы
  const topAlbums = albums.filter((a) => a.likes >= 2).slice(0, 3)
  const albumSections = await Promise.allSettled(
    topAlbums.map(async (a) => ({
      a,
      tracks: await yandex.albumTracks(token, a.id).catch(() => [] as Track[])
    }))
  )
  for (const res of albumSections) {
    if (res.status !== 'fulfilled') continue
    const items = fresh(res.value.tracks, 4, 20)
    if (items.length) {
      push(`rec-album-${res.value.a.id}`, `Альбом «${res.value.a.title}»`, items, {
        subtitle: [res.value.a.artist, res.value.a.year].filter(Boolean).join(' · '),
        coverUrl: res.value.tracks[0]?.coverUrl
      })
    }
  }

  // 5. Новое у любимых артистов: самый свежий альбом
  const year = new Date().getFullYear()
  const newSections = await Promise.allSettled(
    topArtists.slice(0, 2).map(async (a) => {
      const list = await yandex.artistAlbums(token, a.id, 6).catch(() => [])
      const latest = list
        .filter((x) => Number(x.year ?? 0) >= year - 1)
        .sort((x, y2) => Number(y2.year ?? 0) - Number(x.year ?? 0))[0]
      if (!latest) return { a, latest: null, tracks: [] as Track[] }
      return {
        a,
        latest,
        tracks: await yandex.albumTracks(token, latest.id).catch(() => [] as Track[])
      }
    })
  )
  for (const res of newSections) {
    if (res.status !== 'fulfilled') continue
    const items = fresh(res.value.tracks, 3, 14)
    const latest = res.value.latest
    if (items.length) {
      push(`rec-new-${res.value.a.id}`, `Новое от ${res.value.a.name}`, items, {
        subtitle: latest
          ? [`альбом «${latest.title}»`, latest.year ? String(latest.year) : ''].filter(Boolean).join(' · ')
          : undefined,
        coverUrl: items[0]?.coverUrl
      })
    }
  }

  return sections
}
