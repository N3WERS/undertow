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
/** минимум треков между «своими», чтобы они не шли подряд */
const LIBRARY_GAP = 12

export type FlowFeedback = 'more' | 'less' | 'skipArtist'

export interface FlowRoute {
  /** артист-семя, от которого пришёл трек */
  seed: string
  /** сосед, через которого он попал в поток */
  via?: string
  /** трек уже был в библиотеке */
  library?: boolean
}

export interface FlowStats {
  tracks: number
  seconds: number
  artists: number
  newArtists: number
  libraryTracks: number
}

export interface FlowOptions {
  genres?: string[]
  excludeGenres?: string[]
  novelty?: number
  includeSeeds?: string[]
  excludeSeeds?: string[]
}

export interface FlowSeed {
  id?: string
  name: string
  coverUrl?: string
  weight?: number
}

export interface FlowInfo {
  active: boolean
  seeds: FlowSeed[]
  genre?: string
  genres: string[]
  excludeGenres: string[]
  novelty: number
  routes: Record<string, FlowRoute>
  stats: FlowStats
}

interface Pool {
  id: string
  name: string
  tracks: Track[]
}

type SeedRef = FlowSeed

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
  /** выбранные жанры: пусто — «всё» */
  genres: string[]
  /** жанры, которые нужно исключить */
  excludeGenres: string[]
  /** 0 — больше знакомого, 100 — больше нового */
  novelty: number
  /** артисты, закреплённые вручную */
  included: Set<string>
  /** артисты, исключённые вручную */
  excluded: Set<string>
  /** артисты, которых пропустили во время сессии */
  blocked: Set<string>
  /** артисты, которые должны звучать чаще */
  boosted: Set<string>
  /** id артиста → имя семени, от которого он пришёл */
  parents: Map<string, string>
  /** почему играет конкретный трек */
  routes: Map<string, FlowRoute>
  /** вес семян для полоски в интерфейсе */
  seedWeights: Map<string, number>
  stats: {
    startedAt: number
    tracks: number
    seconds: number
    artists: Set<string>
    libraryTracks: number
    knownArtists: Set<string>
  }
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
  const key = flat(name)
  if (s.excluded.has(key) || s.blocked.has(key)) return false
  if (s.included.has(key)) return true
  if (s.excludeGenres.some((g) => genres.matches(name, g))) return false
  if (!s.genres.length) return true
  return !genres.known(name) || s.genres.some((g) => genres.matches(name, g))
}

function poolsFrom(
  profiles: ({ id: string; name: string; tracks: Track[] } | null)[],
  libraryIds: Set<string>,
  used: Set<string>,
  keys: Set<string>,
  routes?: Map<string, FlowRoute>,
  routeFor?: (p: { id: string; name: string }) => FlowRoute
): Pool[] {
  const pools: Pool[] = []
  const seenArtist = new Set<string>()
  for (const p of profiles) {
    if (!p || seenArtist.has(p.id)) continue
    seenArtist.add(p.id)
    const route = routeFor?.(p) ?? { seed: p.name }
    const tracks: Track[] = []
    for (const t of shuffle([...p.tracks])) {
      if (!t.playable || libraryIds.has(t.id) || used.has(t.id)) continue
      const key = keyOf(t.title)
      if (!key || keys.has(key)) continue
      keys.add(key)
      tracks.push(t)
      routes?.set(t.id, route)
    }
    if (tracks.length) pools.push({ id: p.id, name: p.name, tracks })
  }
  return pools
}

function routeTo(s: Session, p: { id: string; name: string }): FlowRoute {
  const seed = s.parents.get(p.id) ?? p.name
  return seed.toLowerCase() === p.name.toLowerCase() ? { seed } : { seed, via: p.name }
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
    // «Ещё такого»: усиленный артист проходит круг дважды
    const boost = order.filter((p) => s.boosted.has(flat(p.name)))
    let advanced = false
    for (const pool of [...order, ...boost]) {
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

  // «своё» — редко и не рядом с другим своим. Слайдер новизны двигает
  // вероятность от 1% до 15%: на «знакомом» библиотека звучит чаще.
  s.sinceLibrary += out.length
  const libraryChance = 0.01 + ((100 - s.novelty) / 100) * 0.14
  if (s.shelf.length && s.sinceLibrary >= LIBRARY_GAP && Math.random() < libraryChance * out.length) {
    const pick = s.shelf[Math.floor(Math.random() * s.shelf.length)]
    if (pick && !s.used.has(pick.id)) {
      s.used.add(pick.id)
      s.keys.add(keyOf(pick.title))
      s.routes.set(pick.id, { seed: 'ваша библиотека', library: true })
      out.splice(Math.max(1, out.length - 4), 0, pick)
      s.sinceLibrary = 0
    }
  }
  return out
}

async function expand(sessionArg: Session | null = session): Promise<boolean> {
  const s = sessionArg
  if (!s) return false
  const anchors = s.artists.slice(0, 5)
  if (!anchors.length) return false
  const profiles = await mapLimit(anchors, 3, (a) => youtube.musicArtist({ id: a.id }).catch(() => null))
  const seen = new Set<string>()
  const candidates: { id: string; name: string; parent: { id: string; name: string } }[] = []
  for (let i = 0; i < profiles.length; i++) {
    const p = profiles[i]
    const anchor = anchors[i]
    if (!p || !anchor) continue
    for (const r of p.related) {
      if (seen.has(r.id) || s.known.has(r.id)) continue
      if (!keepArtist(s, r.name)) continue
      seen.add(r.id)
      candidates.push({ id: r.id, name: r.name, parent: anchor })
      if (candidates.length >= RING2_PICKS) break
    }
    if (candidates.length >= RING2_PICKS) break
  }
  if (!candidates.length) return false
  for (const c of candidates) {
    s.known.add(c.id)
    s.parents.set(c.id, s.parents.get(c.parent.id) ?? c.parent.name)
  }
  const withTracks = await mapLimit(candidates, 3, (c) =>
    youtube.musicArtist({ id: c.id, name: c.name }).catch(() => null)
  )
  const pools = poolsFrom(
    withTracks.map((p) => (p ? { id: p.id, name: p.name, tracks: p.tracks } : null)),
    s.libraryIds,
    s.used,
    s.keys,
    s.routes,
    (p) => routeTo(s, p)
  )
  if (!pools.length) return false
  s.pools.push(...pools)
  s.ring = 2
  return true
}

/**
 * Запуск: библиотека → любимые артисты → соседи → пулы.
 * С `genre` (id корзины) семена ограничены этим жанром.
 */
export async function start(
  options: FlowOptions = {}
): Promise<{ title: string; seeds: SeedRef[]; tracks: Track[] }> {
  const selectedGenres = [...new Set((options.genres ?? []).filter(Boolean))]
  const excludedGenres = [...new Set((options.excludeGenres ?? []).filter(Boolean))]
  const novelty = Math.max(0, Math.min(100, Math.round(options.novelty ?? 55)))
  const includeNames = (options.includeSeeds ?? []).map((n) => n.trim()).filter(Boolean)
  const excludedNames = (options.excludeSeeds ?? []).map((n) => n.trim()).filter(Boolean)
  if (selectedGenres.length || excludedGenres.length) await genres.ensure().catch(() => undefined)

  const lib = snapshot()
  const libraryIds = new Set([...lib.likes, ...lib.history].map((t) => t.id))
  const excludedKeys = new Set(excludedNames.map(flat))
  const includedKeys = new Set(includeNames.map(flat))

  const passName = (name: string): boolean => {
    const key = flat(name)
    if (excludedKeys.has(key)) return false
    if (excludedGenres.some((g) => genres.matches(name, g))) return false
    if (!selectedGenres.length) return true
    return !genres.known(name) || selectedGenres.some((g) => genres.matches(name, g))
  }

  let weights = artistWeights().filter((w) => {
    if (excludedKeys.has(flat(w.name))) return false
    if (excludedGenres.some((g) => genres.matches(w.name, g))) return false
    return !selectedGenres.length || selectedGenres.some((g) => genres.matches(w.name, g))
  })

  // закреплённые вручную артисты важнее случайного перекоса
  let seedWeights = pickSeeds(weights, SEEDS)
  for (const name of includeNames) {
    if (excludedKeys.has(flat(name))) continue
    if (seedWeights.some((w) => flat(w.name) === flat(name))) continue
    const known = artistWeights().find((w) => flat(w.name) === flat(name))
    seedWeights.push({ name, score: known?.score ?? 0 })
  }
  seedWeights = seedWeights.filter((w) => !excludedKeys.has(flat(w.name)))

  if (!seedWeights.length) {
    throw new Error(
      selectedGenres.length || excludedGenres.length
        ? 'В выбранных жанрах пока мало ваших артистов — измените фильтр'
        : 'В библиотеке мало артистов: лайкните несколько треков, и течение соберётся'
    )
  }

  // порядок семян тоже перемешиваем: соседи собираются с первых профилей,
  // и фиксированный порядок всегда вёл в окружение одного и того же артиста
  const seedProfiles = await mapLimit(shuffle(seedWeights), 3, (w) =>
    youtube.musicArtist({ name: w.name }).catch(() => null)
  )
  const good = seedProfiles.filter((p): p is NonNullable<typeof p> => Boolean(p))
  if (!good.length) throw new Error('Не удалось найти артистов для течения — попробуйте ещё раз')

  const known = new Set<string>()
  const parents = new Map<string, string>()
  const neighbours: { id: string; name: string }[] = []
  for (const p of good) {
    known.add(p.id)
    parents.set(p.id, p.name)
    for (const r of p.related) {
      if (!passName(r.name)) continue
      if (known.has(r.id) || neighbours.some((n) => n.id === r.id)) continue
      neighbours.push({ id: r.id, name: r.name })
      parents.set(r.id, p.name)
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
  const routes = new Map<string, FlowRoute>()
  const seedWeight = new Map(seedWeights.map((w) => [w.name, w.score]))

  const shelf = shuffle(
    lib.likes.filter((t) => t.playable && t.provider === 'youtube').slice(0, 400)
  ).slice(0, 40)

  const knownArtists = new Set(
    [...lib.likes, ...lib.history].map((t) => artistOf(t).toLowerCase()).filter(Boolean)
  )

  const sess: Session = {
    seeds: good.map((p) => ({
      id: p.id,
      name: p.name,
      coverUrl: p.coverUrl,
      weight: seedWeight.get(p.name) ?? 0
    })),
    used,
    keys,
    pools: [],
    artists: [...good, ...neighbourProfiles.filter(Boolean)].map((p) => ({ id: p!.id, name: p!.name })),
    known,
    libraryIds,
    shelf,
    sinceLibrary: LIBRARY_GAP,
    ring: 1,
    cursor: 0,
    genres: selectedGenres,
    excludeGenres: excludedGenres,
    novelty,
    included: includedKeys,
    excluded: excludedKeys,
    blocked: new Set(),
    boosted: new Set(),
    parents,
    routes,
    seedWeights: seedWeight,
    stats: {
      startedAt: Date.now(),
      tracks: 0,
      seconds: 0,
      artists: new Set(),
      libraryTracks: 0,
      knownArtists
    }
  }

  sess.pools = shuffle(
    poolsFrom(
      [...good, ...neighbourProfiles].map((p) => (p ? { id: p.id, name: p.name, tracks: p.tracks } : null)),
      libraryIds,
      used,
      keys,
      routes,
      (p) => routeTo(sess, p)
    )
  )
  if (!sess.pools.length) throw new Error('Не удалось набрать треки: попробуйте ещё раз')
  sess.cursor = Math.floor(Math.random() * Math.max(1, sess.pools.length))
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
  const title =
    selectedGenres.length === 1
      ? `Течение · ${genres.nameOf(selectedGenres[0])}`
      : selectedGenres.length > 1
        ? `Течение · ${selectedGenres.length} жанра`
        : 'Течение'
  return { title, seeds: sess.seeds, tracks }
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

function statsOf(s: Session): FlowStats {
  const artists = [...s.stats.artists]
  return {
    tracks: s.stats.tracks,
    seconds: Math.round(s.stats.seconds),
    artists: artists.length,
    newArtists: artists.filter((a) => !s.stats.knownArtists.has(a.toLowerCase())).length,
    libraryTracks: s.stats.libraryTracks
  }
}

export function info(): FlowInfo {
  const s = session
  if (!s) {
    return {
      active: false,
      seeds: [],
      genres: [],
      excludeGenres: [],
      novelty: 55,
      routes: {},
      stats: { tracks: 0, seconds: 0, artists: 0, newArtists: 0, libraryTracks: 0 }
    }
  }
  return {
    active: true,
    seeds: s.seeds.map((seed) => ({ ...seed, weight: s.seedWeights.get(seed.name) ?? seed.weight ?? 0 })),
    genre: s.genres[0],
    genres: s.genres,
    excludeGenres: s.excludeGenres,
    novelty: s.novelty,
    routes: Object.fromEntries(s.routes.entries()),
    stats: statsOf(s)
  }
}

/** Учитывает фактически начатый трек: треки, минуты, новые артисты. */
export function notePlayed(track: Track): void {
  const s = session
  if (!s) return
  const artist = artistOf(track)
  s.stats.tracks += 1
  s.stats.seconds += Math.max(0, track.durationSec ?? 0)
  if (artist) s.stats.artists.add(artist)
  if (s.libraryIds.has(track.id)) s.stats.libraryTracks += 1
}

/** Слайдер новизны меняет плотность знакомых треков на лету. */
export function setNovelty(value: number): FlowInfo {
  if (session) session.novelty = Math.max(0, Math.min(100, Math.round(value)))
  return info()
}

async function addSeedArtist(s: Session, name: string): Promise<boolean> {
  const key = flat(name)
  if (!key) return false
  s.excluded.delete(key)
  s.blocked.delete(key)
  s.included.add(key)
  if (s.pools.some((p) => flat(p.name) === key)) return true
  const profile = await youtube.musicArtist({ name }).catch(() => null)
  if (!profile) return false
  s.known.add(profile.id)
  s.parents.set(profile.id, profile.name)
  const added = poolsFrom(
    [{ id: profile.id, name: profile.name, tracks: profile.tracks }],
    s.libraryIds,
    s.used,
    s.keys,
    s.routes,
    (p) => routeTo(s, p)
  )
  if (!added.length) return false
  s.pools.push(...added)
  if (!s.seeds.some((seed) => flat(seed.name) === key)) {
    const weight = artistWeights().find((w) => flat(w.name) === key)?.score ?? 0
    s.seeds.push({
      id: profile.id,
      name: profile.name,
      coverUrl: profile.coverUrl,
      weight
    })
    s.seedWeights.set(profile.name, weight)
  }
  return true
}

export async function seedAction(
  action: 'include' | 'exclude',
  name: string
): Promise<FlowInfo> {
  const s = session
  const key = flat(name)
  if (!s || !key) return info()
  if (action === 'include') {
    await addSeedArtist(s, name)
  } else {
    s.excluded.add(key)
    s.blocked.add(key)
    s.included.delete(key)
    s.pools = s.pools.filter((p) => flat(p.name) !== key)
    s.seeds = s.seeds.filter((seed) => flat(seed.name) !== key)
    s.boosted.delete(key)
  }
  return info()
}

export async function feedback(
  action: FlowFeedback,
  track: Track
): Promise<{ tracks: Track[] }> {
  const s = session
  if (!s) return { tracks: [] }
  const artist = artistOf(track)
  s.used.add(track.id)
  s.keys.add(keyOf(track.title))

  if (action === 'less') return { tracks: [] }

  if (action === 'skipArtist') {
    const key = flat(artist)
    s.blocked.add(key)
    s.pools = s.pools.filter((p) => flat(p.name) !== key)
    return { tracks: [] }
  }

  // more: усиливаем артиста и по возможности добавляем его пул
  s.boosted.add(flat(artist))
  await addSeedArtist(s, artist)
  const extra = draw(s, 6)
  return { tracks: await youtube.fillYears(extra, 3).catch(() => extra) }
}

/** Список артистов для «откуда течёт» — без сетевых запросов. */
export function seeds(): { name: string; weight: number }[] {
  return artistWeights()
    .slice(0, 10)
    .map((a) => ({ name: a.name, weight: a.score }))
}
