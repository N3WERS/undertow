import type { Track } from './providers/types'
import { snapshot } from './library'
import { artistWeights } from './browse'
import * as youtube from './providers/youtube'
import * as genres from './genres'

/**
 * «Течение» — бесконечный поток рекомендаций по библиотеке.
 *
 * Не плейлист и не радио одного артиста: берём артистов, которых чаще лайкают
 * и слушают, достаём их «Похожих исполнителей», набираем пулы треков и
 * чередуем артистов по кругу. Свои треки из библиотеки почти не звучат
 * (примерно один на двадцать) — поток должен открывать новое, а не повторять
 * лайки. Когда пулы кончаются, подключается второй круг — соседи соседей.
 *
 * Всё на metadata YouTube Music: работает и без Плюса, и с ним.
 */

const SEEDS = 6
const NEIGHBOURS = 10
const RING2_PICKS = 6
const FIRST_FILL = 30
const REFILL = 20
/** как часто в поток попадает трек, который уже есть в библиотеке */
const LIBRARY_CHANCE = 0.06
/** минимум треков между «своими», чтобы они не шли подряд */
const LIBRARY_GAP = 12

interface Pool {
  id: string
  name: string
  tracks: Track[]
}

interface SeedRef {
  id?: string
  name: string
  coverUrl?: string
}

interface Session {
  seeds: SeedRef[]
  used: Set<string>
  /** нормализованные названия: один и тот же трек не должен идти дважды */
  keys: Set<string>
  pools: Pool[]
  /** артисты, чьи соседи ещё не подключены (для второго круга) */
  artists: { id: string; name: string }[]
  known: Set<string>
  libraryIds: Set<string>
  shelf: Track[]
  sinceLibrary: number
  ring: number
  /** с какого пула начинать круг: порядок артистов не должен повторяться */
  cursor: number
  /** выбранный жанр (id корзины) или undefined — «всё» */
  genre?: string
}

let session: Session | null = null
/** первый артист прошлой сборки — новую начинаем с другого */
let lastOpenedArtist = ''

/** Параллельные запросы с ограничением: страницы артистов тяжёлые. */
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

function flat(s: string): string {
  return s
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/\([^)]*\)|\[[^\]]*\]/g, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

/** Ключ трека: название без фитов и скобок, слова по алфавиту. */
function keyOf(title: string): string {
  return [...new Set(flat(title).split(' ').filter(Boolean))].sort().join(' ')
}

const artistOf = (t: Track): string =>
  (t.artists?.[0]?.name ?? t.artist ?? '').split(',')[0].trim()

/**
 * Семена течения: берём не строго топ, а 12 лучших с случайным разбросом.
 * Иначе каждая пересборка начинается с одного и того же артиста.
 */
function pickSeeds(weights: { name: string; score: number }[], count: number): { name: string; score: number }[] {
  return weights
    .slice(0, 16)
    .map((w) => ({ w, jitter: w.score * (0.4 + Math.random() * 1.6) }))
    .sort((a, b) => b.jitter - a.jitter)
    .slice(0, count)
    .map((x) => x.w)
}

function shuffle<T>(list: T[]): T[] {
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[list[i], list[j]] = [list[j], list[i]]
  }
  return list
}

/**
 * Пропускать ли артиста в жанровый поток: своих (помеченных другим жанром)
 * отсекаем, неизвестных пускаем — они соседи по графу и почти всегда в тему,
 * а теги для всех соседей тянуть слишком дорого.
 */
function keepArtist(s: Session, name: string): boolean {
  if (!s.genre) return true
  return !genres.known(name) || genres.matches(name, s.genre)
}

function poolsFrom(
  profiles: ({ id: string; name: string; tracks: Track[] } | null)[],
  libraryIds: Set<string>,
  used: Set<string>,
  keys: Set<string>
): Pool[] {
  const pools: Pool[] = []
  const seenArtist = new Set<string>()
  for (const p of profiles) {
    if (!p || seenArtist.has(p.id)) continue
    seenArtist.add(p.id)
    const tracks: Track[] = []
    for (const t of shuffle([...p.tracks])) {
      if (!t.playable || libraryIds.has(t.id) || used.has(t.id)) continue
      const key = keyOf(t.title)
      if (!key || keys.has(key)) continue
      keys.add(key)
      tracks.push(t)
    }
    if (tracks.length) pools.push({ id: p.id, name: p.name, tracks })
  }
  return pools
}

/**
 * Набирает порцию: по одному треку с каждого пула по кругу, не повторяя
 * артиста подряд, и изредка вставляет что-то из библиотеки.
 */
function draw(s: Session, want: number): Track[] {
  const out: Track[] = []
  const deferred = new Map<Pool, Track[]>()
  let guard = 0
  while (out.length < want && guard++ < want * 12) {
    // каждый круг начинаем с другого артиста — иначе последовательность
    // всегда одна и та же: Big Baby Tape, MACAN, kizaru…
    const start = s.pools.length ? s.cursor % s.pools.length : 0
    const order: Pool[] = start ? [...s.pools.slice(start), ...s.pools.slice(0, start)] : s.pools
    let advanced = false
    for (const pool of order) {
      const last = out.length ? artistOf(out[out.length - 1]).toLowerCase() : ''
      while (pool.tracks.length) {
        const t = pool.tracks.shift() as Track
        if (!t.playable || s.used.has(t.id)) continue
        // тот же артист два раза подряд — отложим его трек на следующий круг
        if (last && artistOf(t).toLowerCase() === last) {
          const back = deferred.get(pool) ?? []
          back.push(t)
          deferred.set(pool, back)
          continue
        }
        s.used.add(t.id)
        out.push(t)
        advanced = true
        break
      }
      if (out.length >= want) break
    }
    for (const [pool, list] of deferred) pool.tracks.push(...list)
    deferred.clear()
    s.cursor++
    if (!advanced) break
  }

  // «своё» — редко и не рядом с другим своим
  s.sinceLibrary += out.length
  if (s.shelf.length && s.sinceLibrary >= LIBRARY_GAP && Math.random() < LIBRARY_CHANCE * out.length) {
    const pick = s.shelf[Math.floor(Math.random() * s.shelf.length)]
    if (pick && !s.used.has(pick.id)) {
      s.used.add(pick.id)
      s.keys.add(keyOf(pick.title))
      out.splice(Math.max(1, out.length - 4), 0, pick)
      s.sinceLibrary = 0
    }
  }
  return out
}

async function expand(s: Session): Promise<boolean> {
  const anchors = session?.artists.slice(0, 5) ?? []
  if (!anchors.length) return false
  const profiles = await mapLimit(anchors, 3, (a) => youtube.musicArtist({ id: a.id }).catch(() => null))
  const seen = new Set<string>()
  const candidates = profiles
    .flatMap((p) => p?.related ?? [])
    .filter(
      (r) =>
        !session?.known.has(r.id) &&
        !seen.has(r.id) &&
        (!session || keepArtist(session, r.name)) &&
        (seen.add(r.id), true)
    )
    .slice(0, RING2_PICKS)
  if (!candidates.length || !session) return false
  for (const c of candidates) session.known.add(c.id)
  const withTracks = await mapLimit(candidates, 3, (c) =>
    youtube.musicArtist({ id: c.id, name: c.name }).catch(() => null)
  )
  const pools = poolsFrom(
    withTracks.map((p) => (p ? { id: p.id, name: p.name, tracks: p.tracks } : null)),
    session.libraryIds,
    session.used,
    session.keys
  )
  if (!pools.length) return false
  session.pools.push(...pools)
  session.ring = 2
  return true
}

/**
 * Запуск: библиотека → любимые артисты → соседи → пулы.
 * С `genre` (id корзины) семена ограничены этим жанром.
 */
export async function start(
  genre?: string
): Promise<{ title: string; seeds: SeedRef[]; tracks: Track[] }> {
  const lib = snapshot()
  let weights = artistWeights()
  if (genre) {
    await genres.ensure().catch(() => undefined)
    const tagged = weights.filter((w) => genres.matches(w.name, genre))
    if (!tagged.length) {
      throw new Error(`В жанре «${genres.nameOf(genre)}» пока мало ваших артистов — выберите другой`)
    }
    weights = tagged
  }
  if (weights.length < (genre ? 1 : 2)) {
    throw new Error('В библиотеке мало артистов: лайкните несколько треков, и течение соберётся')
  }
  /** соседи: чужих по жанру отсекаем, неизвестных пускаем */
  const pass = (name: string): boolean =>
    !genre || !genres.known(name) || genres.matches(name, genre)

  // порядок семян тоже перемешиваем: соседи собираются с первых профилей,
  // и фиксированный порядок всегда вёл в окружение одного и того же артиста
  const seedWeights = shuffle(pickSeeds(weights, SEEDS))
  const libraryIds = new Set([...lib.likes, ...lib.history].map((t) => t.id))
  const seedProfiles = await mapLimit(seedWeights, 3, (w) =>
    youtube.musicArtist({ name: w.name }).catch(() => null)
  )
  const good = seedProfiles.filter((p): p is NonNullable<typeof p> => Boolean(p))

  const known = new Set<string>()
  const neighbours: { id: string; name: string }[] = []
  for (const p of good) {
    known.add(p.id)
    for (const r of p.related) {
      if (!pass(r.name)) continue
      if (known.has(r.id) || neighbours.some((n) => n.id === r.id)) continue
      neighbours.push({ id: r.id, name: r.name })
      if (neighbours.length >= NEIGHBOURS) break
    }
    if (neighbours.length >= NEIGHBOURS) break
  }
  const neighbourProfiles = await mapLimit(neighbours.slice(0, NEIGHBOURS), 4, (n) =>
    youtube.musicArtist({ id: n.id, name: n.name }).catch(() => null)
  )
  for (const n of neighbours) known.add(n.id)

  const used = new Set<string>()
  const keys = new Set<string>()
  const pools = shuffle(
    poolsFrom(
      [...good, ...neighbourProfiles].map((p) => (p ? { id: p.id, name: p.name, tracks: p.tracks } : null)),
      libraryIds,
      used,
      keys
    )
  )
  if (!pools.length) throw new Error('Не удалось набрать треки: попробуйте ещё раз')

  const shelf = shuffle(
    lib.likes.filter((t) => t.playable && t.provider === 'youtube').slice(0, 400)
  ).slice(0, 40)

  const sess: Session = {
    seeds: good.map((p) => ({ id: p.id, name: p.name, coverUrl: p.coverUrl })),
    used,
    keys,
    pools,
    artists: [...good, ...neighbourProfiles.filter(Boolean)].map((p) => ({ id: p!.id, name: p!.name })),
    known,
    libraryIds,
    shelf,
    sinceLibrary: LIBRARY_GAP,
    ring: 1,
    cursor: Math.floor(Math.random() * Math.max(1, pools.length)),
    genre
  }
  session = sess

  let tracks = draw(sess, FIRST_FILL)
  // пересборка не должна начинаться тем же артистом, что и предыдущая
  if (tracks.length && artistOf(tracks[0]).toLowerCase() === lastOpenedArtist) {
    const alt = tracks.findIndex(
      (t, i) => i > 0 && i < 8 && artistOf(t).toLowerCase() !== lastOpenedArtist
    )
    if (alt > 0) tracks.unshift(...tracks.splice(alt, 1))
  }
  if (tracks.length) lastOpenedArtist = artistOf(tracks[0]).toLowerCase()
  tracks = await youtube.fillYears(tracks, 8).catch(() => tracks)
  return {
    title: genre ? `Течение · ${genres.nameOf(genre)}` : 'Течение',
    seeds: sess.seeds,
    tracks
  }
}

/** Дозаправка: сначала остатки пулов, потом второй круг соседей. */
export async function more(): Promise<Track[]> {
  if (!session) return []
  const batch = await youtube.fillYears(draw(session, REFILL), 5)
  if (batch.length >= 8) return batch
  const expanded = await expand(session).catch(() => false)
  if (!expanded) return batch
  return [...batch, ...(await youtube.fillYears(draw(session, REFILL - batch.length), 5))]
}

export function info(): { active: boolean; seeds: SeedRef[]; genre?: string } {
  return { active: Boolean(session), seeds: session?.seeds ?? [], genre: session?.genre }
}

/** Список артистов для «откуда течёт» — без сетевых запросов. */
export function seeds(): { name: string; weight: number }[] {
  return artistWeights()
    .slice(0, 10)
    .map((a) => ({ name: a.name, weight: a.score }))
}
