import { app } from 'electron'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import type { Track } from './providers/types'
import { snapshot } from './library'
import { artistWeights } from './browse'
import * as youtube from './providers/youtube'

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

const RING2_PICKS = 6
const FIRST_FILL = 30
const REFILL = 20
/** минимум треков между «своими», чтобы они не шли подряд */
const LIBRARY_GAP = 12
/** сколько треков-якорей берём из библиотеки */
const ANCHORS = 12
/** сколько похожих треков запрашиваем у каждого якоря */
const ANCHOR_RELATED = 30
/** квота одного якоря на скользящие 30 треков */
const ANCHOR_QUOTA = 4
const ANCHOR_WINDOW = 30
/** сколько якорей меняем за одно пополнение */
const ROTATE_COUNT = 2
/** кэш Up next */
const RELATED_TTL = 6 * 60 * 60_000

export type FlowFeedback = 'more' | 'less' | 'skipArtist'
export type FlowTier = 'hit' | 'recent' | 'deep'
export type FlowAnchorRole = 'like' | 'top' | 'middle' | 'history' | 'unexpected' | 'manual'

export interface FlowAnchor {
  track: Track
  role: FlowAnchorRole
  /** закреплён вручную — не участвует в ротации */
  pinned?: boolean
}

const MAX_STREAM = 700
const MAX_ROUTES = 1200

const PRESET = {
  novelty: 40,
  tiers: { hit: 0.4, recent: 0.4, deep: 0.2 } as Record<FlowTier, number>,
  recentDays: 21
}

/** Новизна 0 — больше знакомого, 100 — больше нового. */
function weightsFor(novelty: number): Record<FlowTier, number> {
  const n = Math.max(0, Math.min(100, novelty)) / 100
  const deep = 0.12 + n * 0.28
  const hit = 0.52 - n * 0.3
  return { hit, recent: Math.max(0, 1 - hit - deep), deep }
}

function applyNovelty(s: Session, value: number): void {
  s.novelty = Math.max(0, Math.min(100, Math.round(value)))
  s.tierWeights = weightsFor(s.novelty)
  s.shelfChance = 0.02 + (1 - s.novelty / 100) * 0.08
}

export interface FlowRoute {
  /** артист-семя, от которого пришёл трек */
  seed: string
  /** сосед, через которого он попал в поток */
  via?: string
  /** трек уже был в библиотеке */
  library?: boolean
  /** трек-якорь, если рекомендация пришла из Up next */
  anchor?: string
  /** 1 — прямо от якоря, 2 — второй шаг по трек-графу */
  hop?: number
  /** id якоря, если рекомендация пришла из Up next */
  anchorId?: string
  tier?: FlowTier
}

export interface FlowStats {
  tracks: number
  seconds: number
  newArtists: number
  started: number
  completed: number
  skipped: number
}

export interface FlowOptions {
  novelty?: number
  includeSeeds?: string[]
  excludeSeeds?: string[]
  /** начать поток от этих артистов (трек, альбом, плейлист) */
  startArtists?: string[]
  /** треки, от которых запущен поток: они становятся ручными якорями */
  startTracks?: Track[]
  /** подпись источника для заголовка */
  sourceTitle?: string
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
  novelty: number
  anchors: FlowAnchor[]
  routes: Record<string, FlowRoute>
  stats: FlowStats
  anchorYield: Record<string, number>
  secondHops: number
}

interface Pool {
  id: string
  name: string
  tracks: Track[]
  /** артист уже есть в библиотеке */
  known: boolean
  source: 'artist' | 'track'
  anchor?: Track
  buckets: Record<FlowTier, Track[]>
}

interface Session {
  seeds: FlowSeed[]
  anchors: FlowAnchor[]
  used: Set<string>
  /** нормализованные названия: один и тот же трек не должен идти дважды */
  keys: Set<string>
  pools: Pool[]
  /** артисты, чьи соседи ещё не подключены (для второго круга) */
  artists: { id: string; name: string }[]
  known: Set<string>
  libraryIds: Set<string>
  /** нормализованные имена артистов, которые есть в библиотеке */
  libraryArtists: Set<string>
  shelf: Track[]
  sinceLibrary: number
  /** с какого пула начинать круг: порядок артистов не должен повторяться */
  cursor: number
  /** сколько треков уже взято у знакомых и новых артистов */
  knownDrawn: number
  newDrawn: number
  /** 0 — больше знакомого, 100 — больше нового */
  novelty: number
  /** доля трек-графа в потоке */
  trackShare: number
  /** целевые доли хитов, новинок и глубины */
  tierWeights: Record<FlowTier, number>
  recentDays: number
  playedAt: Record<string, number>
  /** отдельные пулы Up next: по одному на якорь */
  trackPools: Pool[]
  tierDrawn: Record<FlowTier, number>
  /** сколько треков уже взято у «неожиданного» якоря */
  unexpectedDrawn: number
  /** id якорей, которые дали треки в последних ANCHOR_WINDOW */
  anchorRecent: string[]
  /** сколько треков дал каждый якорь за сессию */
  anchorYield: Map<string, number>
  /** ручная оценка якоря по дослушиваниям/пропускам */
  anchorScore: Map<string, number>
  /** закреплённые якоря */
  pinnedAnchors: Set<string>
  /** очередность ротации ролей */
  rotationCursor: number
  /** последняя позиция артиста в потоке */
  artistLastAt: Map<string, number>
  /** последние эпохи для ограничения однообразия */
  eraRecent: string[]
  /** сколько длинных треков подряд */
  longStreak: number
  /** сколько пополнений подряд дали мало треков */
  stagnantRefills: number
  /** сколько раз сработал второй шаг */
  secondHops: number
  /** вероятность вставки своего трека */
  shelfChance: number
  /** аварийно разрешить глубину, если другие категории закончились */
  deepRelief: boolean
  /** треки, для которых уже запрашивали второй шаг трек-графа */
  secondHopSeeds: Set<string>
  sourceDrawn: { artist: number; track: number }
  artistCounts: Map<string, number>
  hitCounts: Map<string, number>
  albumCounts: Map<string, number>
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
  /** всё, что уже выдал поток: для сохранения в плейлист */
  stream: Track[]
  stats: {
    tracks: number
    seconds: number
    artists: Set<string>
    knownArtists: Set<string>
    started: number
    completed: number
    skipped: number
  }
}

let session: Session | null = null
let sessionQueue: Track[] = []
let sessionIndex = 0
/** кэш Up next по video id */
const relatedCache = new Map<string, { at: number; tracks: Track[] }>()
/** первый артист прошлой сборки — новую начинаем с другого */
let lastOpenedArtist = ''

interface Discovery {
  name: string
  coverUrl?: string
  at: number
}

let storeLoaded = false
let blockedArtists = new Set<string>()
let discoveriesMap = new Map<string, Discovery>()
/** id трека → сколько раз его пропустили; 2+ — больше не ставим. */
let skippedTracks = new Map<string, number>()
/** имя артиста → накопленный вкус: чаще/реже. */
let artistTaste = new Map<string, number>()

function flowStorePath(name: string): string {
  return path.join(app.getPath('userData'), name)
}

const SESSION_FILE = 'flow-session.json'
let sessionWrite: Promise<void> = Promise.resolve()

interface PersistedFlow {
  v: 1
  at: number
  s: Record<string, unknown>
  queue?: Track[]
  index?: number
}

function serializeSession(s: Session): PersistedFlow {
  return {
    v: 1,
    at: Date.now(),
    s: {
      seeds: s.seeds,
      anchors: s.anchors,
      used: [...s.used],
      keys: [...s.keys],
      pools: s.pools,
      artists: s.artists,
      known: [...s.known],
      libraryIds: [...s.libraryIds],
      libraryArtists: [...s.libraryArtists],
      shelf: s.shelf,
      sinceLibrary: s.sinceLibrary,
      cursor: s.cursor,
      knownDrawn: s.knownDrawn,
      newDrawn: s.newDrawn,
      novelty: s.novelty,
      trackShare: s.trackShare,
      tierWeights: s.tierWeights,
      recentDays: s.recentDays,
      playedAt: s.playedAt,
      trackPools: s.trackPools,
      tierDrawn: s.tierDrawn,
      unexpectedDrawn: s.unexpectedDrawn,
      anchorRecent: s.anchorRecent,
      anchorYield: [...s.anchorYield],
      anchorScore: [...s.anchorScore],
      pinnedAnchors: [...s.pinnedAnchors],
      rotationCursor: s.rotationCursor,
      artistLastAt: [...s.artistLastAt],
      eraRecent: s.eraRecent,
      longStreak: s.longStreak,
      stagnantRefills: s.stagnantRefills,
      secondHops: s.secondHops,
      shelfChance: s.shelfChance,
      deepRelief: s.deepRelief,
      secondHopSeeds: [...s.secondHopSeeds],
      sourceDrawn: s.sourceDrawn,
      artistCounts: [...s.artistCounts],
      hitCounts: [...s.hitCounts],
      albumCounts: [...s.albumCounts],
      included: [...s.included],
      excluded: [...s.excluded],
      blocked: [...s.blocked],
      boosted: [...s.boosted],
      parents: [...s.parents],
      routes: [...s.routes],
      seedWeights: [...s.seedWeights],
      stream: s.stream,
      stats: {
        tracks: s.stats.tracks,
        seconds: s.stats.seconds,
        artists: [...s.stats.artists],
        knownArtists: [...s.stats.knownArtists],
        started: s.stats.started,
        completed: s.stats.completed,
        skipped: s.stats.skipped
      }
    }
  }
}

function restoreSession(data: Record<string, unknown>): Session {
  const d = data as Record<string, any>
  return {
    seeds: d.seeds ?? [],
    anchors: d.anchors ?? [],
    used: new Set(d.used ?? []),
    keys: new Set(d.keys ?? []),
    pools: d.pools ?? [],
    artists: d.artists ?? [],
    known: new Set(d.known ?? []),
    libraryIds: new Set(d.libraryIds ?? []),
    libraryArtists: new Set(d.libraryArtists ?? []),
    shelf: d.shelf ?? [],
    sinceLibrary: d.sinceLibrary ?? LIBRARY_GAP,
    cursor: d.cursor ?? 0,
    knownDrawn: d.knownDrawn ?? 0,
    newDrawn: d.newDrawn ?? 0,
    novelty: d.novelty ?? PRESET.novelty,
    trackShare: d.trackShare ?? 1,
    tierWeights: d.tierWeights ?? weightsFor(d.novelty ?? PRESET.novelty),
    recentDays: d.recentDays ?? PRESET.recentDays,
    playedAt: d.playedAt ?? {},
    trackPools: d.trackPools ?? [],
    tierDrawn: d.tierDrawn ?? { hit: 0, recent: 0, deep: 0 },
    unexpectedDrawn: d.unexpectedDrawn ?? 0,
    anchorRecent: d.anchorRecent ?? [],
    anchorYield: new Map(d.anchorYield ?? []),
    anchorScore: new Map(d.anchorScore ?? []),
    pinnedAnchors: new Set(d.pinnedAnchors ?? []),
    rotationCursor: d.rotationCursor ?? 0,
    artistLastAt: new Map(d.artistLastAt ?? []),
    eraRecent: d.eraRecent ?? [],
    longStreak: d.longStreak ?? 0,
    stagnantRefills: d.stagnantRefills ?? 0,
    secondHops: d.secondHops ?? 0,
    shelfChance: d.shelfChance ?? 0.05,
    deepRelief: false,
    secondHopSeeds: new Set(d.secondHopSeeds ?? []),
    sourceDrawn: d.sourceDrawn ?? { artist: 0, track: 0 },
    artistCounts: new Map(d.artistCounts ?? []),
    hitCounts: new Map(d.hitCounts ?? []),
    albumCounts: new Map(d.albumCounts ?? []),
    included: new Set(d.included ?? []),
    excluded: new Set(d.excluded ?? []),
    blocked: new Set(d.blocked ?? []),
    boosted: new Set(d.boosted ?? []),
    parents: new Map(d.parents ?? []),
    routes: new Map(d.routes ?? []),
    seedWeights: new Map(d.seedWeights ?? []),
    stream: d.stream ?? [],
    stats: {
      tracks: d.stats?.tracks ?? 0,
      seconds: d.stats?.seconds ?? 0,
      artists: new Set(d.stats?.artists ?? []),
      knownArtists: new Set(d.stats?.knownArtists ?? []),
      started: d.stats?.started ?? 0,
      completed: d.stats?.completed ?? 0,
      skipped: d.stats?.skipped ?? 0
    }
  }
}

function saveSession(): void {
  if (!session) return
  trimSession(session)
  const file = flowStorePath(SESSION_FILE)
  const data = serializeSession(session)
  data.queue = sessionQueue
  data.index = sessionIndex
  const payload = JSON.stringify(data)
  // Не блокируем main на каждом пропуске/пополнении: записи идут по очереди.
  sessionWrite = sessionWrite
    .then(async () => {
      await fsp.writeFile(`${file}.tmp`, payload, 'utf8')
      await fsp.rename(`${file}.tmp`, file)
    })
    .catch(() => {
      /* память потока не должна ломать воспроизведение */
    })
}

export interface LastFlowInfo {
  available: boolean
  tracks: number
  savedAt: number
}

export function lastFlow(): LastFlowInfo {
  if (session) {
    return { available: session.stream.length > 0, tracks: session.stream.length, savedAt: Date.now() }
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(flowStorePath(SESSION_FILE), 'utf8')) as PersistedFlow
    if (parsed?.v !== 1 || !Array.isArray(parsed.s?.stream)) {
      return { available: false, tracks: 0, savedAt: 0 }
    }
    return {
      available: parsed.s.stream.length > 0,
      tracks: parsed.s.stream.length,
      savedAt: parsed.at
    }
  } catch {
    return { available: false, tracks: 0, savedAt: 0 }
  }
}

export function resume(): { tracks: Track[]; info: FlowInfo; queue: Track[]; index: number } {
  try {
    const parsed = JSON.parse(fs.readFileSync(flowStorePath(SESSION_FILE), 'utf8')) as PersistedFlow
    if (parsed?.v !== 1 || !parsed.s) throw new Error('bad session')
    session = restoreSession(parsed.s)
    sessionQueue = Array.isArray(parsed.queue) ? parsed.queue : []
    sessionIndex = Math.max(0, Math.min(sessionQueue.length - 1, Number(parsed.index) || 0))
    return { tracks: session.stream, info: info(), queue: sessionQueue, index: sessionIndex }
  } catch {
    throw new Error('Прошлое течение не найдено')
  }
}

/** Очередь, которую сейчас показывает плеер, — для точного продолжения. */
export function setQueue(queue: Track[], index: number): void {
  sessionQueue = Array.isArray(queue) ? queue : []
  sessionIndex = Math.max(0, Math.min(sessionQueue.length - 1, Number(index) || 0))
  saveSession()
}

function loadFlowStores(): void {
  if (storeLoaded) return
  storeLoaded = true
  try {
    const blocked = JSON.parse(fs.readFileSync(flowStorePath('flow-blocked.json'), 'utf8')) as string[]
    if (Array.isArray(blocked)) blockedArtists = new Set(blocked.map(flat).filter(Boolean))
  } catch {
    blockedArtists = new Set()
  }
  try {
    const list = JSON.parse(fs.readFileSync(flowStorePath('flow-discoveries.json'), 'utf8')) as Discovery[]
    if (Array.isArray(list)) {
      for (const item of list) {
        if (item?.name) discoveriesMap.set(flat(item.name), item)
      }
    }
  } catch {
    discoveriesMap = new Map()
  }
  try {
    const taste = JSON.parse(fs.readFileSync(flowStorePath('flow-taste.json'), 'utf8')) as {
      tracks?: Record<string, number>
      artists?: Record<string, number>
    }
    for (const [id, count] of Object.entries(taste?.tracks ?? {})) {
      if (typeof count === 'number' && count > 0) skippedTracks.set(id, count)
    }
    for (const [name, score] of Object.entries(taste?.artists ?? {})) {
      if (typeof score === 'number' && Math.abs(score) > 0.01) artistTaste.set(flat(name), score)
    }
  } catch {
    skippedTracks = new Map()
    artistTaste = new Map()
  }
}

function saveTaste(): void {
  saveFlowStore('flow-taste.json', {
    tracks: Object.fromEntries(skippedTracks),
    artists: Object.fromEntries(artistTaste)
  })
}

function isTasteBlocked(track: Track): boolean {
  loadFlowStores()
  return (skippedTracks.get(track.id) ?? 0) >= 2
}

/** Слишком часто пропускаемый артист перестаёт попадать в поток. */
function isArtistTasteBlocked(name: string): boolean {
  loadFlowStores()
  return (artistTaste.get(flat(name)) ?? 0) <= -8
}

function saveFlowStore(name: string, data: unknown): void {
  const file = flowStorePath(name)
  const tmp = `${file}.tmp`
  void fsp
    .writeFile(tmp, JSON.stringify(data), 'utf8')
    .then(() => fsp.rename(tmp, file))
    .catch(() => undefined)
}

function isBlocked(name: string): boolean {
  loadFlowStores()
  return blockedArtists.has(flat(name))
}

function rememberDiscovery(name: string, coverUrl?: string): void {
  loadFlowStores()
  const key = flat(name)
  if (!key || discoveriesMap.has(key)) return
  discoveriesMap.set(key, { name, coverUrl, at: Date.now() })
  saveFlowStore('flow-discoveries.json', [...discoveriesMap.values()].slice(-200))
}

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
  return true
}

const DERIVATIVE =
  /(slowed|reverb|nightcore|sped\s*up|speed\s*up|8d|cover|karaoke|instrumental|lyrics?|mashup|bootleg|remix|ремикс|кавер|караоке|замедлен|ускорен|реверб|реакц|смотрит|обзор|разбор|подкаст|интервью|react)/i

function isDerivative(title: string): boolean {
  return DERIVATIVE.test(title)
}

function isRecentYear(year: string | undefined): boolean {
  const n = Number(year)
  if (!Number.isFinite(n) || n < 1900) return false
  return n >= new Date().getFullYear() - 1
}

/** Хиты — начало каталога, новинки — свежие годы, остальное — глубина. */
function tierOf(track: Track, index: number): FlowTier {
  if (index < 5) return 'hit'
  // «Новинка» — только если год действительно известен и свежий.
  if (isRecentYear(track.year)) return 'recent'
  return 'deep'
}

function emptyBuckets(): Record<FlowTier, Track[]> {
  return { hit: [], recent: [], deep: [] }
}

function deepBlocked(s: Session): boolean {
  if (s.deepRelief) return false
  const total = s.tierDrawn.hit + s.tierDrawn.recent + s.tierDrawn.deep
  if (total < 6) return false
  // Небольшой запас сверх целевой доли: глубина не должна разрастаться,
  // когда новинок в пулах мало.
  const cap = Math.max(1, Math.round(total * (s.tierWeights.deep + 0.03)))
  return s.tierDrawn.deep >= cap
}

function tierOrder(s: Session): FlowTier[] {
  const total = s.tierDrawn.hit + s.tierDrawn.recent + s.tierDrawn.deep
  const order: FlowTier[] = ['hit', 'recent', 'deep']
  if (total < 3) return order
  return order
    .filter((tier) => tier !== 'deep' || !deepBlocked(s))
    .map((tier) => ({
      tier,
      gap: s.tierWeights[tier] - (total ? s.tierDrawn[tier] / total : 0)
    }))
    .sort((a, b) => b.gap - a.gap)
    .map((x) => x.tier)
}

function recentlyPlayed(s: Session, track: Track): boolean {
  const at = s.playedAt[track.id]
  if (!at) return false
  return Date.now() - at < s.recentDays * 24 * 60 * 60 * 1000
}

function anchorKey(track: Track): string {
  return `${flat(track.title)}|${flat(artistOf(track))}`
}

function uniqueAnchors(list: FlowAnchor[]): FlowAnchor[] {
  const seen = new Set<string>()
  const out: FlowAnchor[] = []
  for (const a of list) {
    if (!a?.track?.id) continue
    const key = anchorKey(a.track)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(a)
  }
  return out
}

interface AnchorPools {
  all: Track[]
  liked: Track[]
  likesNew: Track[]
  recent: Track[]
  topArtists: { name: string; tracks: Track[] }[]
  topPool: Track[]
  middle: Track[]
  outside: Track[]
  historyTop: { name: string; tracks: Track[] }[]
  byId: Set<string>
}

/** Одни и те же правила для первичного выбора и для ротации якорей. */
function buildAnchorPools(lib: ReturnType<typeof snapshot>, pass: (name: string) => boolean): AnchorPools {
  const eligible = (t: Track): boolean =>
    Boolean(t) &&
    t.provider === 'youtube' &&
    t.playable &&
    !isDerivative(t.title) &&
    !isTasteBlocked(t) &&
    !isArtistTasteBlocked(t.artist) &&
    pass(t.artist)
  const liked = lib.likes.filter(eligible)
  const history = lib.history.filter(eligible)
  const all = [...liked, ...history]
  const likedAt = lib.likedAt ?? {}
  const likesNew = [...liked].sort((a, b) => (likedAt[b.id] ?? 0) - (likedAt[a.id] ?? 0))
  const historyNew = [...history].sort(
    (a, b) => (lib.playedAt[b.id] ?? 0) - (lib.playedAt[a.id] ?? 0)
  )
  const artistOfTrack = (t: Track): string => flat(artistOf(t))

  const artistsFrom = (tracks: Track[]): Map<string, Track[]> => {
    const map = new Map<string, Track[]>()
    for (const t of tracks) {
      const key = artistOfTrack(t)
      if (!key) continue
      const list = map.get(key) ?? []
      list.push(t)
      map.set(key, list)
    }
    return map
  }

  const likeArtists = artistsFrom(liked)
  const topArtists = [...likeArtists.entries()]
    .sort((a, b) => b[1].length - a[1].length)
    .map(([name, tracks]) => ({ name, tracks }))

  // Если YouTube-лайков мало, добираем частых артистов из YouTube-истории.
  if (topArtists.length < 8) {
    const known = new Set(topArtists.map((x) => x.name))
    for (const [name, tracks] of [...artistsFrom(history).entries()].sort(
      (a, b) => b[1].length - a[1].length
    )) {
      if (known.has(name)) continue
      topArtists.push({ name, tracks })
      if (topArtists.length >= 8) break
    }
  }

  const recent = likesNew.length ? likesNew : historyNew
  const n = recent.length
  const midStart = Math.floor(n * 0.4)
  const midEnd = Math.max(midStart + 1, Math.ceil(n * 0.6))
  const middle = recent.slice(midStart, midEnd)
  const topNames = new Set(topArtists.map((x) => x.name))
  const outside = all.filter((t) => !topNames.has(artistOfTrack(t)))

  const likedArtists = new Set(liked.map(artistOfTrack).filter(Boolean))
  const historyCounts = new Map<string, number>()
  for (const t of history) {
    const key = artistOfTrack(t)
    if (!key) continue
    historyCounts.set(key, (historyCounts.get(key) ?? 0) + 1)
  }
  const historyAll = [...historyCounts.entries()].sort((a, b) => b[1] - a[1])
  const historyTop = historyAll
    .filter(([name]) => likedArtists.has(name))
    .map(([name]) => ({ name, tracks: liked.filter((t) => artistOfTrack(t) === name) }))
    .filter((x) => x.tracks.length)
  if (!historyTop.length) {
    for (const [name] of historyAll) {
      const tracks = liked.filter((t) => artistOfTrack(t) === name)
      if (tracks.length) historyTop.push({ name, tracks })
    }
  }
  if (!historyTop.length) {
    for (const [name] of historyAll) {
      const tracks = history.filter((t) => artistOfTrack(t) === name)
      if (tracks.length) historyTop.push({ name, tracks })
    }
  }

  return {
    all,
    liked,
    likesNew,
    recent,
    topArtists,
    topPool: topArtists.flatMap((x) => x.tracks),
    middle,
    outside,
    historyTop,
    byId: new Set(all.map((t) => t.id))
  }
}

function pickAnchors(
  lib: ReturnType<typeof snapshot>,
  startTracks: Track[],
  pass: (name: string) => boolean
): FlowAnchor[] {
  const pools = buildAnchorPools(lib, pass)
  const chosen: FlowAnchor[] = []
  const artistOfTrack = (t: Track): string => flat(artistOf(t))
  const artistUsed = (track: Track): boolean =>
    chosen.some((a) => artistOfTrack(a.track) === artistOfTrack(track))

  const add = (track: Track | undefined, role: FlowAnchorRole, strictArtist = false): boolean => {
    if (!track || !pools.byId.has(track.id)) return false
    if (chosen.some((a) => anchorKey(a.track) === anchorKey(track))) return false
    if (strictArtist && artistUsed(track)) return false
    chosen.push({ track, role })
    return true
  }

  const pickRandom = (
    pool: Track[],
    role: FlowAnchorRole,
    count: number,
    distinctArtists = false
  ): number => {
    let picked = 0
    const tryPool = (strict: boolean): void => {
      for (const t of shuffle([...pool])) {
        if (picked >= count) return
        if (chosen.some((a) => a.track.id === t.id)) continue
        if (strict && distinctArtists && artistUsed(t)) continue
        if (add(t, role, strict && distinctArtists)) picked++
      }
    }
    tryPool(true)
    if (picked < count) tryPool(false)
    return picked
  }

  // Явный запуск от трека/альбома/плейлиста: эти треки важнее случайного выбора.
  for (const t of startTracks.slice(0, ANCHORS)) add(t, 'manual')

  // 1–4: четыре случайных трека из 35 последних лайков.
  pickRandom(pools.recent.slice(0, 35), 'like', 4)

  // 5–9: пять треков от самых частых артистов в лайках.
  let topPicks = 0
  for (const entry of shuffle(pools.topArtists)) {
    if (topPicks >= 5) break
    if (pickRandom(entry.tracks, 'top', 1, true) > 0) topPicks++
  }
  if (topPicks < 5) pickRandom(pools.topPool, 'top', 5 - topPicks, false)

  // 8: один случайный трек из середины списка лайков.
  pickRandom(pools.middle.length ? pools.middle : pools.recent, 'middle', 1, true)

  // 9: случайный «неожиданный» трек — вне верхних артистов по лайкам.
  pickRandom(pools.outside.length ? pools.outside : pools.all, 'unexpected', 1, true)

  // 10: случайный трек артиста, который чаще всего в истории и есть в лайках.
  for (const entry of pools.historyTop) {
    if (chosen.length >= ANCHORS) break
    if (artistUsed({ id: '', artist: entry.name } as Track)) continue
    if (pickRandom(entry.tracks, 'history', 1, false) > 0) break
  }
  if (!chosen.some((a) => a.role === 'history') && pools.historyTop.length) {
    pickRandom(pools.historyTop[0].tracks, 'history', 1, false)
  }

  // Если библиотека маленькая — добираем оставшиеся слоты без строгих правил.
  for (const t of [...pools.recent, ...pools.all]) {
    if (chosen.length >= ANCHORS) break
    add(t, chosen.length < 2 ? 'like' : 'middle', false)
  }

  return uniqueAnchors(chosen).slice(0, ANCHORS)
}

function pickReplacement(
  pools: AnchorPools,
  role: 'like' | 'top' | 'middle' | 'history',
  current: FlowAnchor[]
): Track | null {
  const usedKeys = new Set(current.map((a) => anchorKey(a.track)))
  const usedArtists = new Set(current.map((a) => flat(artistOf(a.track))))
  const free = (t: Track, artistStrict: boolean): boolean =>
    !usedKeys.has(anchorKey(t)) && (!artistStrict || !usedArtists.has(flat(artistOf(t))))

  if (role === 'like') {
    for (const t of shuffle(pools.recent.slice(0, 35))) {
      if (free(t, true)) return t
    }
    for (const t of shuffle(pools.recent.slice(0, 35))) {
      if (free(t, false)) return t
    }
    return null
  }

  if (role === 'top') {
    for (const entry of shuffle(pools.topArtists)) {
      const options = shuffle(entry.tracks.filter((t) => free(t, true)))
      if (options[0]) return options[0]
    }
    for (const t of shuffle(pools.topPool)) if (free(t, false)) return t
    return null
  }

  if (role === 'middle') {
    for (const t of shuffle(pools.middle.length ? pools.middle : pools.recent)) {
      if (free(t, true)) return t
    }
    for (const t of shuffle(pools.middle.length ? pools.middle : pools.recent)) {
      if (free(t, false)) return t
    }
    return null
  }

  for (const entry of pools.historyTop) {
    if (usedArtists.has(entry.name)) continue
    const options = shuffle(entry.tracks.filter((t) => free(t, false)))
    if (options[0]) return options[0]
  }
  for (const entry of pools.historyTop) {
    const options = shuffle(entry.tracks.filter((t) => free(t, false)))
    if (options[0]) return options[0]
  }
  return null
}

function poolsFrom(
  profiles: ({ id: string; name: string; tracks: Track[] } | null)[],
  libraryIds: Set<string>,
  used: Set<string>,
  keys: Set<string>,
  routes?: Map<string, FlowRoute>,
  routeFor?: (p: { id: string; name: string }) => FlowRoute,
  knownArtists?: Set<string>,
  source: 'artist' | 'track' = 'artist',
  anchor?: Track
): Pool[] {
  const pools: Pool[] = []
  const seenArtist = new Set<string>()
  for (const p of profiles) {
    if (!p || seenArtist.has(p.id)) continue
    seenArtist.add(p.id)
    const route = routeFor?.(p) ?? { seed: p.name }
    const pool: Pool = {
      id: p.id,
      name: p.name,
      tracks: [],
      known: Boolean(knownArtists?.has(flat(p.name))),
      source,
      anchor,
      buckets: emptyBuckets()
    }
    const rank = new Map(p.tracks.map((t, i) => [t.id, i]))
    const shuffled = shuffle([...p.tracks])
    for (const t of shuffled) {
      if (!t.playable || libraryIds.has(t.id) || used.has(t.id) || isTasteBlocked(t)) continue
      if (isDerivative(t.title)) continue
      const key = keyOf(t.title)
      if (!key || keys.has(key)) continue
      keys.add(key)
      const tier = tierOf(t, rank.get(t.id) ?? 99)
      pool.tracks.push(t)
      pool.buckets[tier].push(t)
      routes?.set(t.id, { ...route, tier })
    }
    if (pool.tracks.length) pools.push(pool)
  }
  return pools
}

function routeTo(s: Session, p: { id: string; name: string }): FlowRoute {
  const seed = s.parents.get(p.id) ?? p.name
  return seed.toLowerCase() === p.name.toLowerCase() ? { seed } : { seed, via: p.name }
}

/** Удаляет выбранный трек из всех очередей пула. */
function takeTrack(pool: Pool, track: Track): void {
  pool.tracks = pool.tracks.filter((t) => t.id !== track.id)
  for (const tier of ['hit', 'recent', 'deep'] as FlowTier[]) {
    pool.buckets[tier] = pool.buckets[tier].filter((t) => t.id !== track.id)
  }
}

function trackAllowed(s: Session, pool: Pool, track: Track, lastArtist: string, lastAlbum: string): boolean {
  if (!track.playable || s.used.has(track.id) || isTasteBlocked(track)) return false
  if (recentlyPlayed(s, track)) return false
  if (isDerivative(track.title)) return false
  const artist = flat(artistOf(track))
  if (isArtistTasteBlocked(artistOf(track))) return false
  // Жанровый фильтр работает не только для якорей, но и для каждого кандидата.
  if (!keepArtist(s, artistOf(track))) return false
  if (artist && (s.artistCounts.get(artist) ?? 0) >= 3) return false
  if (artist && artist === lastArtist) return false
  // После двух треков артист должен отдохнуть несколько позиций.
  const totalDrawn = s.tierDrawn.hit + s.tierDrawn.recent + s.tierDrawn.deep
  const lastAt = s.artistLastAt.get(artist)
  if (artist && lastAt !== undefined && totalDrawn - lastAt < 4 && (s.artistCounts.get(artist) ?? 0) >= 2) {
    return false
  }
  const album = flat(track.album ?? '')
  if (album && album === lastAlbum && s.albumCounts.get(album)) return false
  if (album && (s.albumCounts.get(album) ?? 0) >= 2) return false
  if (pool.source === 'artist' && pool.buckets.hit.some((t) => t.id === track.id)) {
    if ((s.hitCounts.get(artist) ?? 0) >= 2) return false
  }
  const year = Number(track.year)
  if (Number.isFinite(year) && year >= 1900) {
    const era = String(Math.floor(year / 10) * 10)
    const sameEra = s.eraRecent.filter((x) => x === era).length
    if (s.eraRecent.length >= 20 && sameEra >= Math.ceil(s.eraRecent.length * 0.7)) return false
  }
  if ((track.durationSec ?? 0) > 360 && s.longStreak >= 2) return false
  return true
}

function poolRole(s: Session, pool: Pool): FlowAnchorRole | undefined {
  if (!pool.anchor) return undefined
  return s.anchors.find((a) => a.track.id === pool.anchor?.id)?.role
}

function chooseFromPool(
  s: Session,
  pool: Pool,
  tier: FlowTier,
  lastArtist: string,
  lastAlbum: string
): Track | null {
  const role = poolRole(s, pool)
  // «Неожиданный» даёт максимум 2 трека и никогда не отдаёт глубину.
  if (role === 'unexpected' && (s.unexpectedDrawn >= 2 || tier === 'deep')) return null
  // Один якорь не должен забирать весь поток.
  if (pool.anchor && s.anchorRecent.filter((id) => id === pool.anchor?.id).length >= ANCHOR_QUOTA) {
    return null
  }
  if (tier === 'deep' && deepBlocked(s)) return null
  for (const t of [...pool.buckets[tier]]) {
    if (trackAllowed(s, pool, t, lastArtist, lastAlbum)) return t
  }
  return null
}

/**
 * Набирает порцию: смешивает трек-граф и артист-граф, держит доли
 * хитов/новинок/глубины, не повторяет артиста и альбом подряд.
 */
function draw(s: Session, want: number): Track[] {
  const out: Track[] = []
  let guard = 0
  const allPools = () => [...s.trackPools, ...s.pools]
  while (out.length < want && guard++ < want * 20) {
    const lastArtist = out.length ? flat(artistOf(out[out.length - 1])) : ''
    const lastAlbum = out.length ? flat(out[out.length - 1].album ?? '') : ''

    const totalSource = s.sourceDrawn.artist + s.sourceDrawn.track
    const wantTrack =
      s.trackPools.length > 0 &&
      (totalSource === 0
        ? Math.random() < s.trackShare
        : s.sourceDrawn.track / totalSource < s.trackShare)
    const sourceOrder: ('track' | 'artist')[] = wantTrack ? ['track', 'artist'] : ['artist', 'track']

    let picked: Track | null = null
    let pickedPool: Pool | null = null
    let pickedTier: FlowTier = 'deep'

    for (const source of sourceOrder) {
      const pools = allPools().filter((p) => p.source === source && p.tracks.length)
      if (!pools.length) continue
      const start = s.cursor % pools.length
      const ordered = start ? [...pools.slice(start), ...pools.slice(0, start)] : pools
      const tiers = tierOrder(s)
      // Сначала держим категорию, затем источник: так доли не разъезжаются.
      for (const tier of tiers) {
        // На старте специально ставим хит → новинку → глубину.
        for (const pool of ordered) {
          const t = chooseFromPool(s, pool, tier, lastArtist, lastAlbum)
          if (!t) continue
          picked = t
          pickedPool = pool
          pickedTier = pool.buckets.hit.some((x) => x.id === t.id)
            ? 'hit'
            : pool.buckets.recent.some((x) => x.id === t.id)
              ? 'recent'
              : 'deep'
          break
        }
        if (picked) break
      }
      if (picked) break
    }

    // Если выбранный источник/категория закончились — берём что угодно.
    if (!picked) {
      for (const pool of allPools()) {
        for (const tier of ['hit', 'recent', 'deep'] as FlowTier[]) {
          const t = chooseFromPool(s, pool, tier, lastArtist, lastAlbum)
          if (!t) continue
          picked = t
          pickedPool = pool
          pickedTier = tier
          break
        }
        if (picked) break
      }
    }

    if (!picked || !pickedPool) break
    takeTrack(pickedPool, picked)
    s.used.add(picked.id)
    out.push(picked)
    s.tierDrawn[pickedTier] += 1
    if (poolRole(s, pickedPool) === 'unexpected') s.unexpectedDrawn += 1
    if (pickedPool.source === 'track') s.sourceDrawn.track += 1
    else s.sourceDrawn.artist += 1
    const artist = flat(artistOf(picked))
    if (artist) {
      s.artistCounts.set(artist, (s.artistCounts.get(artist) ?? 0) + 1)
      s.artistLastAt.set(artist, s.tierDrawn.hit + s.tierDrawn.recent + s.tierDrawn.deep)
    }
    if (pickedTier === 'hit' && artist) s.hitCounts.set(artist, (s.hitCounts.get(artist) ?? 0) + 1)
    const album = flat(picked.album ?? '')
    if (album) s.albumCounts.set(album, (s.albumCounts.get(album) ?? 0) + 1)
    if (pickedPool.anchor) {
      s.anchorRecent.push(pickedPool.anchor.id)
      if (s.anchorRecent.length > ANCHOR_WINDOW) s.anchorRecent.shift()
      s.anchorYield.set(pickedPool.anchor.id, (s.anchorYield.get(pickedPool.anchor.id) ?? 0) + 1)
    }
    const year = Number(picked.year)
    if (Number.isFinite(year) && year >= 1900) {
      s.eraRecent.push(String(Math.floor(year / 10) * 10))
      if (s.eraRecent.length > 30) s.eraRecent.shift()
    }
    s.longStreak = (picked.durationSec ?? 0) > 360 ? s.longStreak + 1 : 0

    if (pickedPool.source === 'track' && pickedPool.anchor) {
      s.routes.set(picked.id, {
        seed: artistOf(pickedPool.anchor),
        via: pickedPool.anchor.title,
        anchor: pickedPool.anchor.title,
        anchorId: pickedPool.anchor.id,
        hop: s.routes.get(picked.id)?.hop ?? 1,
        tier: pickedTier
      })
    } else {
      const route = s.routes.get(picked.id) ?? { seed: pickedPool.name }
      s.routes.set(picked.id, { ...route, tier: pickedTier })
    }
    s.cursor++
  }

  // «своё» — редко и не зависит от новизны: слайдер отвечает за состав
  // артистов, а не за количество треков из библиотеки.
  s.sinceLibrary += out.length
  if (s.shelf.length && s.sinceLibrary >= LIBRARY_GAP && Math.random() < s.shelfChance * out.length) {
    const pick = s.shelf[Math.floor(Math.random() * s.shelf.length)]
    if (pick && !s.used.has(pick.id) && !recentlyPlayed(s, pick)) {
      s.used.add(pick.id)
      s.keys.add(keyOf(pick.title))
      s.routes.set(pick.id, { seed: 'ваша библиотека', library: true, tier: 'deep' })
      out.splice(Math.max(1, out.length - 4), 0, pick)
      s.sinceLibrary = 0
    }
  }

  for (const track of out) {
    const artist = artistOf(track)
    if (artist && !s.libraryArtists.has(flat(artist))) rememberDiscovery(artist, track.coverUrl)
  }
  s.stream.push(...out)
  trimSession(s)
  return out
}

/** Не даём сессии расти бесконечно: очередь и маршруты старых треков не нужны. */
function trimSession(s: Session): void {
  if (s.stream.length > MAX_STREAM) s.stream = s.stream.slice(-MAX_STREAM)
  if (s.routes.size <= MAX_ROUTES) return
  const keep = new Set(s.stream.map((t) => t.id))
  for (const id of s.routes.keys()) {
    if (s.routes.size <= MAX_ROUTES) break
    if (!keep.has(id)) s.routes.delete(id)
  }
}

/** Первый трек не должен быть случайным: хит, новинка или характерная глубина. */
function strengthenOpening(s: Session, tracks: Track[]): Track[] {
  if (tracks.length < 3) return tracks
  const tiers = new Map<string, FlowTier>()
  for (const [id, route] of s.routes) if (route.tier) tiers.set(id, route.tier)
  const want: FlowTier[] = ['hit', 'recent', 'deep']
  for (let i = 0; i < 3; i++) {
    if (tiers.get(tracks[i].id) === want[i]) continue
    const at = tracks.findIndex((t, j) => j > i && j < 10 && tiers.get(t.id) === want[i])
    if (at > i) [tracks[i], tracks[at]] = [tracks[at], tracks[i]]
  }
  return tracks
}

/** Трек-граф: YouTube Music Up next для каждого якоря. */
async function trackPoolsFor(
  anchors: FlowAnchor[],
  libraryIds: Set<string>,
  used: Set<string>,
  keys: Set<string>,
  routes: Map<string, FlowRoute>,
  libraryArtists: Set<string>,
  hop = 1
): Promise<Pool[]> {
  const sourceAnchors = anchors.filter(
    (a) => a.track?.provider === 'youtube' && a.track.id.startsWith('yt:')
  )
  if (!sourceAnchors.length) return []
  const results = await mapLimit(sourceAnchors, 5, async (a) => {
    const key = `${a.track.id}:${ANCHOR_RELATED}`
    const hit = relatedCache.get(key)
    let list: Track[]
    if (hit && Date.now() - hit.at < RELATED_TTL) {
      list = hit.tracks
    } else {
      list = await youtube
        .relatedTracks(a.track.id.slice(3), ANCHOR_RELATED)
        .catch(() => [] as Track[])
      if (list.length) {
        relatedCache.set(key, { at: Date.now(), tracks: list })
        if (relatedCache.size > 240) {
          const oldest = relatedCache.keys().next().value
          if (oldest) relatedCache.delete(oldest)
        }
      }
    }
    return { anchor: a.track, tracks: list.filter((t) => t.id !== a.track.id) }
  })

  const pools: Pool[] = []
  for (const item of results) {
    if (!item || !item.tracks.length) continue
    const anchor = item.anchor
    const pool = poolsFrom(
      [{ id: `anchor:${anchor.id}`, name: artistOf(anchor), tracks: item.tracks }],
      libraryIds,
      used,
      keys,
      routes,
      () => ({ seed: artistOf(anchor), via: anchor.title, anchor: anchor.title, hop }),
      libraryArtists,
      'track',
      anchor
    )[0]
    if (pool) pools.push(pool)
  }
  return pools
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
    (p) => routeTo(s, p),
    s.libraryArtists
  )
  if (!pools.length) return false
  s.pools.push(...pools)
  return true
}

/**
 * Запуск: библиотека → любимые артисты → соседи → пулы.
 * С `genre` (id корзины) семена ограничены этим жанром.
 */
export async function start(
  options: FlowOptions = {}
): Promise<{ title: string; seeds: FlowSeed[]; tracks: Track[] }> {
  loadFlowStores()
  const novelty = Math.max(0, Math.min(100, Math.round(options.novelty ?? PRESET.novelty)))
  const includeNames = (options.includeSeeds ?? []).map((n) => n.trim()).filter(Boolean)
  const excludedNames = (options.excludeSeeds ?? []).map((n) => n.trim()).filter(Boolean)
  const startTracks = (options.startTracks ?? []).filter((t) => t?.id && t.playable)

  const lib = snapshot()
  const libraryIds = new Set([...lib.likes, ...lib.history].map((t) => t.id))
  const libraryArtists = new Set(
    [...lib.likes, ...lib.history].map((t) => flat(artistOf(t))).filter(Boolean)
  )
  const excludedKeys = new Set(excludedNames.map(flat))
  const includedKeys = new Set(includeNames.map(flat))

  const passName = (name: string): boolean => {
    const key = flat(name)
    if (isBlocked(name)) return false
    return !excludedKeys.has(key)
  }

  const anchors = pickAnchors(lib, startTracks, passName)
  if (!anchors.length) {
    throw new Error('В библиотеке мало треков: лайкните несколько, и течение соберётся')
  }

  const used = new Set<string>()
  const keys = new Set<string>()
  const routes = new Map<string, FlowRoute>()
  const seedWeight = new Map<string, number>()

  const shelf = shuffle(
    lib.likes
      .filter((t) => t.playable && t.provider === 'youtube' && !isTasteBlocked(t))
      .slice(0, 400)
  ).slice(0, 40)

  const knownArtists = new Set(
    [...lib.likes, ...lib.history].map((t) => artistOf(t).toLowerCase()).filter(Boolean)
  )

  const trackPools = await trackPoolsFor(anchors, libraryIds, used, keys, routes, libraryArtists)

  const anchorSeeds: FlowSeed[] = []
  const seenSeed = new Set<string>()
  for (const anchor of uniqueAnchors(anchors)) {
    const name = artistOf(anchor.track)
    const key = flat(name)
    if (!key || seenSeed.has(key)) continue
    seenSeed.add(key)
    anchorSeeds.push({
      id: anchor.track.artistId,
      name,
      coverUrl: anchor.track.coverUrl,
      weight: 0
    })
  }

  const sess: Session = {
    seeds: anchorSeeds,
    anchors,
    used,
    keys,
    pools: [],
    artists: [],
    known: new Set<string>(),
    libraryIds,
    libraryArtists,
    shelf,
    sinceLibrary: LIBRARY_GAP,
    cursor: 0,
    novelty,
    trackShare: 1,
    tierWeights: weightsFor(novelty),
    recentDays: PRESET.recentDays,
    playedAt: lib.playedAt,
    trackPools,
    tierDrawn: { hit: 0, recent: 0, deep: 0 },
    unexpectedDrawn: 0,
    anchorRecent: [],
    anchorYield: new Map(),
    anchorScore: new Map(),
    pinnedAnchors: new Set(),
    rotationCursor: 0,
    artistLastAt: new Map(),
    eraRecent: [],
    longStreak: 0,
    stagnantRefills: 0,
    secondHops: 0,
    shelfChance: 0.02 + (1 - novelty / 100) * 0.08,
    deepRelief: false,
    secondHopSeeds: new Set<string>(),
    sourceDrawn: { artist: 0, track: 0 },
    artistCounts: new Map(),
    hitCounts: new Map(),
    albumCounts: new Map(),
    knownDrawn: 0,
    newDrawn: 0,
    included: includedKeys,
    excluded: excludedKeys,
    blocked: new Set(),
    boosted: new Set(),
    parents: new Map<string, string>(),
    routes,
    seedWeights: seedWeight,
    stream: [],
    stats: {
      tracks: 0,
      seconds: 0,
      artists: new Set(),
      knownArtists,
      started: 0,
      completed: 0,
      skipped: 0
    }
  }

  if (!sess.trackPools.length) {
    throw new Error('Не удалось найти похожие треки для якорей — попробуйте ещё раз')
  }
  sess.cursor = Math.floor(Math.random() * Math.max(1, sess.trackPools.length))
  session = sess
  sessionQueue = []
  sessionIndex = 0

  let tracks = draw(sess, FIRST_FILL)
  tracks = strengthenOpening(sess, tracks)
  // пересборка не должна начинаться тем же артистом, что и предыдущая
  if (tracks.length && artistOf(tracks[0]).toLowerCase() === lastOpenedArtist) {
    const alt = tracks.findIndex(
      (t, i) => i > 0 && i < 8 && artistOf(t).toLowerCase() !== lastOpenedArtist
    )
    if (alt > 0) tracks.unshift(...tracks.splice(alt, 1))
  }
  if (tracks.length) lastOpenedArtist = artistOf(tracks[0]).toLowerCase()
  tracks = await youtube.fillYears(tracks, 8).catch(() => tracks)
  saveSession()
  return { title: 'Течение', seeds: sess.seeds, tracks }
}

/** Мягкая ротация: два якоря за пополнение, по кругу ролей. */
async function rotateAnchors(s: Session, force = false): Promise<void> {
  const poolSet = buildAnchorPools(snapshot(), (name) => keepArtist(s, name))
  const roles: ('like' | 'top' | 'middle' | 'history')[] = ['like', 'top', 'middle', 'history']
  const order = [...roles.slice(s.rotationCursor), ...roles.slice(0, s.rotationCursor)]
  const replacements: { old: FlowAnchor; next: Track; role: 'like' | 'top' | 'middle' | 'history' }[] = []
  let current = [...s.anchors]
  const limit = force ? 4 : ROTATE_COUNT

  for (const role of order) {
    if (replacements.length >= limit) break
    const olds = current.filter(
      (a) => a.role === role && !s.pinnedAnchors.has(a.track.id)
    )
    if (!olds.length) continue
    // Сначала меняем якорь, который давно не давал треков или давал пропуски.
    const old = [...olds].sort((a, b) => {
      const sa = s.anchorScore.get(a.track.id) ?? 0
      const sb = s.anchorScore.get(b.track.id) ?? 0
      if (sa !== sb) return sa - sb
      return (s.anchorYield.get(a.track.id) ?? 0) - (s.anchorYield.get(b.track.id) ?? 0)
    })[0]
    if (!old) continue
    const next = pickReplacement(poolSet, role, current)
    if (!next || next.id === old.track.id) continue
    replacements.push({ old, next, role })
    current = [...current, { track: next, role }]
  }
  if (!replacements.length) return

  const newEntries = replacements.map((r) => ({ track: r.next, role: r.role }))
  const newPools = await trackPoolsFor(newEntries, s.libraryIds, s.used, s.keys, s.routes, s.libraryArtists)
  const byAnchor = new Map(newPools.map((p) => [p.anchor?.id, p]))
  let changed = false

  for (const replacement of replacements) {
    if (!byAnchor.has(replacement.next.id)) continue
    s.trackPools = s.trackPools.filter((p) => p.anchor?.id !== replacement.old.track.id)
    s.anchors = s.anchors.map((a) =>
      a === replacement.old ? { track: replacement.next, role: replacement.role } : a
    )
    s.pinnedAnchors.delete(replacement.old.track.id)
    changed = true
  }
  if (changed) {
    s.trackPools.push(...newPools)
    s.rotationCursor = (s.rotationCursor + replacements.length) % roles.length
  }
}

/** Второй шаг: берём уже сыгранные треки и добавляем их Up next. */
async function addSecondHop(s: Session, limit = 2): Promise<number> {
  const anchorIds = new Set(s.anchors.map((a) => a.track.id))
  const seeds = shuffle(
    s.stream
      .filter(
        (t) =>
          t?.id &&
          t.playable &&
          !anchorIds.has(t.id) &&
          !s.secondHopSeeds.has(t.id) &&
          s.routes.get(t.id)?.hop === 1
      )
      .slice(-40)
  ).slice(0, limit)
  if (!seeds.length) return 0

  for (const seed of seeds) s.secondHopSeeds.add(seed.id)
  const entries: FlowAnchor[] = seeds.map((track) => ({ track, role: 'manual' }))
  const pools = await trackPoolsFor(entries, s.libraryIds, s.used, s.keys, s.routes, s.libraryArtists, 2)
  if (!pools.length) return 0
  s.trackPools.push(...pools)
  s.secondHops += pools.length

  // Не больше четырёх побочных пулов: второй шаг не должен подменять поток.
  const child = s.trackPools.filter((p) => p.anchor && !anchorIds.has(p.anchor.id))
  if (child.length > 4) {
    const drop = new Set(child.slice(0, child.length - 4))
    s.trackPools = s.trackPools.filter((p) => !drop.has(p))
  }
  return pools.length
}

/** Ручное управление якорем: закрепить, заменить, убрать. */
export async function anchorAction(
  action: 'pin' | 'replace' | 'remove',
  anchorId: string
): Promise<FlowInfo> {
  const s = session
  if (!s || !anchorId) return info()
  const anchor = s.anchors.find((a) => a.track.id === anchorId)
  if (!anchor) return info()

  if (action === 'pin') {
    if (s.pinnedAnchors.has(anchorId)) s.pinnedAnchors.delete(anchorId)
    else s.pinnedAnchors.add(anchorId)
    saveSession()
    return info()
  }

  if (action === 'remove') {
    s.anchors = s.anchors.filter((a) => a.track.id !== anchorId)
    s.trackPools = s.trackPools.filter((p) => p.anchor?.id !== anchorId)
    s.pinnedAnchors.delete(anchorId)
    saveSession()
    return info()
  }

  const poolSet = buildAnchorPools(snapshot(), (name) => keepArtist(s, name))
  const knownRoles: ('like' | 'top' | 'middle' | 'history')[] = ['like', 'top', 'middle', 'history']
  const role = knownRoles.includes(anchor.role as never)
    ? (anchor.role as 'like' | 'top' | 'middle' | 'history')
    : null
  const next = role
    ? pickReplacement(poolSet, role, s.anchors)
    : shuffle(poolSet.all.filter((t) => !s.anchors.some((a) => a.track.id === t.id)))[0] ?? null
  if (!next || next.id === anchorId) return info()

  const pools = await trackPoolsFor(
    [{ track: next, role: anchor.role }],
    s.libraryIds,
    s.used,
    s.keys,
    s.routes,
    s.libraryArtists
  )
  const pool = pools.find((p) => p.anchor?.id === next.id)
  if (!pool) return info()
  s.anchors = s.anchors.map((a) => (a.track.id === anchorId ? { track: next, role: anchor.role } : a))
  s.trackPools = s.trackPools.filter((p) => p.anchor?.id !== anchorId)
  s.trackPools.push(pool)
  s.pinnedAnchors.delete(anchorId)
  saveSession()
  return info()
}

/** Дозаправка: меняет часть якорей и добирает следующие 20 треков. */
export async function more(): Promise<Track[]> {
  if (!session) return []
  await rotateAnchors(session).catch(() => undefined)
  let batch = draw(session, REFILL)
  // Сначала пробуем второй шаг по трек-графу: похожие на уже сыгранные
  // треки дают свежий материал без ухода в глубину.
  if (batch.length < 8) {
    await addSecondHop(session, 2).catch(() => 0)
    batch = [...batch, ...draw(session, REFILL - batch.length)]
  }
  // Если и второй шаг не помог — только тогда аварийная глубина.
  // Не раздуваем глубину из-за недобора в пару треков.
  if (batch.length < 4) {
    session.deepRelief = true
    batch = [...batch, ...draw(session, REFILL - batch.length)]
    session.deepRelief = false
  }
  const filled = await youtube.fillYears(batch, 5)
  if (filled.length >= 8) {
    session.stagnantRefills = 0
    saveSession()
    return filled
  }
  const expanded = await expand(session).catch(() => false)
  if (!expanded) {
    session.stagnantRefills += 1
    if (session.stagnantRefills >= 3) {
      session.stagnantRefills = 0
      await rotateAnchors(session, true).catch(() => undefined)
      const extra = await youtube.fillYears(draw(session, REFILL - filled.length), 5)
      saveSession()
      return [...filled, ...extra]
    }
    saveSession()
    return filled
  }
  const result = [...filled, ...(await youtube.fillYears(draw(session, REFILL - filled.length), 5))]
  session.stagnantRefills = result.length < 10 ? session.stagnantRefills + 1 : 0
  saveSession()
  return result
}

function statsOf(s: Session): FlowStats {
  const artists = [...s.stats.artists]
  return {
    tracks: s.stats.tracks,
    seconds: Math.round(s.stats.seconds),
    newArtists: artists.filter((a) => !s.stats.knownArtists.has(a.toLowerCase())).length,
    started: s.stats.started,
    completed: s.stats.completed,
    skipped: s.stats.skipped
  }
}

export function info(): FlowInfo {
  const s = session
  if (!s) {
    return {
      active: false,
      seeds: [],
      novelty: 40,
      anchors: [],
      routes: {},
      stats: { tracks: 0, seconds: 0, newArtists: 0, started: 0, completed: 0, skipped: 0 },
      anchorYield: {},
      secondHops: 0
    }
  }
  return {
    active: true,
    seeds: s.seeds.map((seed) => ({ ...seed, weight: s.seedWeights.get(seed.name) ?? seed.weight ?? 0 })),
    novelty: s.novelty,
    anchors: s.anchors.map((a) => ({ ...a, pinned: s.pinnedAnchors.has(a.track.id) })),
    routes: Object.fromEntries(s.routes.entries()),
    stats: statsOf(s),
    anchorYield: Object.fromEntries(s.anchorYield.entries()),
    secondHops: s.secondHops
  }
}

/** Лёгкий ответ для плашки в мини-плеере: только причина одного трека. */
export function route(trackId: string): FlowRoute | null {
  return session?.routes.get(trackId) ?? null
}

/** Учитывает фактически начатый трек: треки, минуты, новые артисты. */
export function notePlayed(track: Track): void {
  const s = session
  if (!s) return
  const artist = artistOf(track)
  s.stats.tracks += 1
  s.stats.started += 1
  s.stats.seconds += Math.max(0, track.durationSec ?? 0)
  if (artist) s.stats.artists.add(artist)
}

/** Автоматическая телеметрия: дослушал или пропустил. */
export function listen(
  action: 'completed' | 'skipped',
  track: Track,
  _playedSeconds = 0
): void {
  const s = session
  if (!s || !track?.id) return
  const route = s.routes.get(track.id)
  const anchorId = route?.anchorId
  const artist = artistOf(track)
  const artistKey = flat(artist)

  if (action === 'completed') {
    s.stats.completed += 1
    if (anchorId) s.anchorScore.set(anchorId, (s.anchorScore.get(anchorId) ?? 0) + 2)
    if (artistKey) artistTaste.set(artistKey, Math.min(30, (artistTaste.get(artistKey) ?? 0) + 0.35))
    saveTaste()
  } else {
    s.stats.skipped += 1
    skippedTracks.set(track.id, (skippedTracks.get(track.id) ?? 0) + 1)
    if (anchorId) s.anchorScore.set(anchorId, (s.anchorScore.get(anchorId) ?? 0) - 2)
    if (artistKey) artistTaste.set(artistKey, Math.max(-30, (artistTaste.get(artistKey) ?? 0) - 0.6))
    saveTaste()
  }
  saveSession()
}

/** Полный сброс выученных вкусов: веса артистов, пропуски и рейтинги якорей. */
export function resetTaste(): FlowInfo {
  artistTaste.clear()
  skippedTracks.clear()
  blockedArtists.clear()
  saveFlowStore('flow-blocked.json', [])
  if (session) {
    session.anchorScore.clear()
    session.anchorYield.clear()
    session.anchorRecent = []
    session.stagnantRefills = 0
    saveSession()
  }
  saveTaste()
  return info()
}

/** Слайдер новизны меняет плотность знакомых треков на лету. */
export function setNovelty(value: number): FlowInfo {
  if (session) {
    applyNovelty(session, value)
    saveSession()
  }
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
    (p) => routeTo(s, p),
    s.libraryArtists
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
    loadFlowStores()
    if (blockedArtists.delete(key)) saveFlowStore('flow-blocked.json', [...blockedArtists])
    await addSeedArtist(s, name)
  } else {
    loadFlowStores()
    blockedArtists.add(key)
    saveFlowStore('flow-blocked.json', [...blockedArtists])
    s.excluded.add(key)
    s.blocked.add(key)
    s.included.delete(key)
    s.pools = s.pools.filter((p) => flat(p.name) !== key)
    s.trackPools = s.trackPools.filter((p) => !p.anchor || flat(artistOf(p.anchor)) !== key)
    s.seeds = s.seeds.filter((seed) => flat(seed.name) !== key)
    s.boosted.delete(key)
  }
  saveSession()
  return info()
}

export async function feedback(
  action: FlowFeedback,
  track: Track
): Promise<{ tracks: Track[] }> {
  const s = session
  if (!s) return { tracks: [] }
  const artist = artistOf(track)
  const artistKey = flat(artist)
  s.used.add(track.id)
  s.keys.add(keyOf(track.title))

  const bumpTaste = (delta: number): void => {
    if (!artistKey) return
    const next = Math.max(-30, Math.min(30, (artistTaste.get(artistKey) ?? 0) + delta))
    artistTaste.set(artistKey, next)
  }

  if (action === 'less') {
    s.stats.skipped += 1
    skippedTracks.set(track.id, (skippedTracks.get(track.id) ?? 0) + 1)
    const anchorId = s.routes.get(track.id)?.anchorId
    if (anchorId) s.anchorScore.set(anchorId, (s.anchorScore.get(anchorId) ?? 0) - 2)
    bumpTaste(-1)
    saveTaste()
    // «Авто» осторожнее, если пропускают новое, и смелее, если знакомое.
    const known = s.libraryArtists.has(artistKey)
    applyNovelty(s, Math.max(15, Math.min(90, s.novelty + (known ? 1 : -4))))
    saveSession()
    return { tracks: [] }
  }

  if (action === 'skipArtist') {
    s.blocked.add(artistKey)
    bumpTaste(-3)
    saveTaste()
    s.pools = s.pools.filter((p) => flat(p.name) !== artistKey)
    s.trackPools = s.trackPools.filter((p) => !p.anchor || flat(artistOf(p.anchor)) !== artistKey)
    relatedCache.clear()
    saveSession()
    return { tracks: [] }
  }

  // more: усиливаем артиста и по возможности добавляем его пул
  s.boosted.add(artistKey)
  bumpTaste(2)
  saveTaste()
  await addSeedArtist(s, artist)
  const extra = draw(s, 6)
  const tracks = await youtube.fillYears(extra, 3).catch(() => extra)
  saveSession()
  return { tracks }
}

/** Список артистов для «откуда течёт» — без сетевых запросов. */
export function seeds(): { name: string; weight: number }[] {
  return artistWeights()
    .slice(0, 10)
    .map((a) => ({ name: a.name, weight: a.score }))
}


/** Все треки, которые уже выдал текущий поток. */
export function stream(): Track[] {
  return session ? [...session.stream] : []
}

/** Артисты, которых поток открыл впервые. */
export function discoveries(): { name: string; coverUrl?: string; at: number }[] {
  loadFlowStores()
  return [...discoveriesMap.values()].sort((a, b) => b.at - a.at)
}

/** Постоянный список исключённых артистов. */
export function blocked(): string[] {
  loadFlowStores()
  return [...blockedArtists]
}
