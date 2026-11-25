/**
 * Замена яндексовских треков на YouTube.
 *
 * Зачем: библиотека живёт дольше подписки. Если Яндекс отключён (нет токена или
 * кончился Плюс), треки `ym:` больше не отдают звук — но их можно найти на YouTube
 * по «исполнитель + название» и играть оттуда.
 *
 * Найденная пара запоминается в `%APPDATA%/Undertow/yt-map.json`, чтобы второй
 * запуск того же трека не тратил 2–3 секунды на поиск.
 */
import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import * as youtube from './providers/youtube'
import { ytSearchResolve } from './ytdlp'
import type { ResolvedStream, Track } from './providers/types'

interface Mapping {
  videoId: string
  title: string
  artist: string
  durationSec: number | null
  coverUrl?: string
  /** насколько длительность разошлась с оригиналом, в секундах */
  delta: number
  /** совпадение не точное: играем просто близкий вариант */
  approximate?: boolean
  /** вариант выбран вручную кнопкой «другой вариант» */
  forced?: boolean
  at: number
}

type MapFile = Record<string, Mapping>

let cache: MapFile | null = null

function filePath(): string {
  return join(app.getPath('userData'), 'yt-map.json')
}

function load(): MapFile {
  if (cache) return cache
  try {
    cache = JSON.parse(readFileSync(filePath(), 'utf8')) as MapFile
  } catch {
    cache = {}
  }
  return cache
}

function save(): void {
  const data = load()
  const file = filePath()
  try {
    const dir = dirname(file)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    const tmp = `${file}.tmp`
    writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8')
    renameSync(tmp, file)
  } catch (e) {
    console.error('[fallback] не сохранил карту:', e instanceof Error ? e.message : e)
  }
}

/** Нормализация для сравнения названий: без регистра, скобок и пунктуации. */
function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/\([^)]*\)|\[[^\]]*\]/g, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function overlap(a: string, b: string): number {
  const ta = new Set(normalize(a).split(' ').filter((w) => w.length > 1))
  const tb = new Set(normalize(b).split(' ').filter((w) => w.length > 1))
  if (!ta.size || !tb.size) return 0
  let hit = 0
  for (const w of ta) if (tb.has(w)) hit += 1
  return hit / Math.max(ta.size, tb.size)
}

/** Убирает из названия хвосты вроде «(Remastered 2011)», чтобы поиск не промахнулся. */
function searchQuery(track: Track): string {
  const clean = (s: string) => s.replace(/\((?:feat|ft|prod|remaster|live|version)[^)]*\)/gi, ' ').trim()
  return `${clean(track.artist)} ${clean(track.title)}`.replace(/\s+/g, ' ').trim()
}

function toTrack(trackId: string, m: Mapping): Track {
  return {
    id: trackId,
    provider: 'youtube',
    title: m.title,
    artist: m.artist,
    durationSec: m.durationSec,
    coverUrl: m.coverUrl,
    kind: 'song',
    playable: true
  }
}

const STORE_LIMIT = 5000

/** Видео, которые уже не отдали поток: не выбираем их повторно при redo. */
const badVideos = new Set<string>()

interface Candidate {
  track: Track
  delta: number
  titleScore: number
  score: number
  artistHit: boolean
  official: boolean
  badVersion: boolean
}

/** Версии, которых обычно НЕ хотят, если в оригинале их нет. */
const BAD_VERSION =
  /(remix|slowed|sped ?up|nightcore|8d|reverb|cover|acoustic|piano|guitar|instrumental|karaoke|tribute|минус|\balt\.? ?version|\balternate|\blive\b|\bextended\b|\bedit\b|rework|bootleg|mashup)/i
/** Признаки официальной загрузки. */
const OFFICIAL = /(official|topic|records|ost|label)/i

function rate(track: Track, results: Track[]): Candidate[] {
  const want = track.durationSec
  const artistTokens = normalize(track.artist).split(' ').filter((w) => w.length > 1)
  const originalHasBad = BAD_VERSION.test(track.title)

  return results
    .filter(
      (r) =>
        r.playable &&
        r.durationSec != null &&
        r.durationSec > 20 &&
        !badVideos.has(r.id.replace(/^yt:/, ''))
    )
    .map((r) => {
      const delta = want != null && r.durationSec != null ? Math.abs(r.durationSec - want) : 0
      let titleScore = Math.max(overlap(track.title, r.title), overlap(track.artist, r.title) * 0.7)

      const haystack = normalize(`${r.title} ${r.artist}`)
      const artistHit = artistTokens.some((w) => haystack.includes(w))
      if (artistHit) titleScore = Math.min(1, titleScore + 0.15)
      // чужой канал без упоминания исполнителя — обычно не тот трек
      else titleScore *= 0.8

      const uploader = `${r.artist}`.toLowerCase()
      const topic = /- ?topic$/i.test(r.artist)
      const official = OFFICIAL.test(uploader) || /official (audio|video)/i.test(r.title)
      if (topic) titleScore = Math.min(1, titleScore + 0.18)
      else if (official) titleScore = Math.min(1, titleScore + 0.12)

      // чужая версия (ремикс, замедленная, концерт) — сильный минус,
      // иначе на «Sweet Dreams» подхватывается Alt. Version вместо оригинала
      const badVersion = !originalHasBad && BAD_VERSION.test(r.title)
      if (badVersion) titleScore *= 0.55

      // трек с «лишними» словами в названии обычно менее точен
      const wantWords = normalize(track.title).split(' ').length
      const gotWords = normalize(r.title).split(' ').length
      if (gotWords > wantWords + 3) titleScore *= 0.92

      const score = titleScore - delta / 120
      return { track: r, delta, titleScore, score, artistHit, official, badVersion }
    })
    .sort((a, b) => b.score - a.score)
}

function accept(c: Candidate): boolean {
  if (c.badVersion) return false
  if (c.titleScore >= 0.34) return true
  return c.delta <= 5 && c.titleScore >= 0.2
}

/** Приблизительный вариант: исполнитель совпал и длительность близка. */
function acceptApprox(c: Candidate): boolean {
  // чужую версию (ремикс, 8-bit, концерт) не берём даже как «похожее»
  if (c.badVersion) return false
  return c.artistHit && c.delta <= 25 && c.titleScore >= 0.3
}

/** Один поиск с повтором: пустой ответ yt-dlp чаще всего временный. */
async function searchOnce(query: string, limit = 8): Promise<Track[]> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await youtube.search(query, limit)
      if (res.length) return res
    } catch {
      // сеть/yt-dlp икнули — пробуем ещё раз
    }
    await new Promise((r) => setTimeout(r, 300))
  }
  return []
}

/**
 * Формулировки запроса.
 *
 * Одной мало: yt-dlp отдаёт пусто на смеси латиницы с кириллицей
 * («Whole Lotta Swag 68 парень» → 0, «68 парень» → находит сразу).
 * Запускаем их ПАРАЛЛЕЛЬНО: последовательный перебор стоил ~5 с на трек,
 * параллельный упирается в самый медленный запрос (~2.8 с).
 */
function queriesFor(track: Track): string[] {
  const firstArtist = track.artist.split(',')[0].trim()
  const titleCore = track.title.replace(/\([^)]*\)|\[[^\]]*\]/g, ' ').replace(/\s+/g, ' ').trim() || track.title
  return [
    searchQuery(track),
    `${track.title} ${firstArtist}`,
    `${firstArtist} ${titleCore}`,
    titleCore
  ]
    .map((q) => q.replace(/\s+/g, ' ').trim())
    .filter((q, i, arr) => q.length > 1 && arr.indexOf(q) === i)
}

/**
 * Один круг поиска: все запросы параллельно, результаты схлопываются по id.
 */
async function rankBatch(track: Track, list: string[], seen: Map<string, Track>): Promise<Candidate[]> {
  const batches = await Promise.all(list.map((q) => searchOnce(q, 5)))
  for (const batch of batches) for (const r of batch) if (!seen.has(r.id)) seen.set(r.id, r)
  return rate(track, [...seen.values()])
}

/** Полный перебор формулировок (используется кнопкой «другой вариант»). */
async function collect(track: Track): Promise<Candidate[]> {
  const queries = queriesFor(track)
  const seen = new Map<string, Track>()
  let rated = await rankBatch(track, queries.slice(0, 2), seen)
  if (!rated.some((c) => accept(c)) && queries.length > 2) {
    rated = await rankBatch(track, queries.slice(2), seen)
  }
  return rated
}

function toMapping(c: Candidate, approximate: boolean): Mapping {
  return {
    videoId: c.track.id.replace(/^yt:/, ''),
    title: c.track.title,
    artist: c.track.artist,
    durationSec: c.track.durationSec,
    coverUrl: c.track.coverUrl,
    delta: Math.round(c.delta),
    approximate,
    at: Date.now()
  }
}

/**
 * Выбирает лучшего кандидата: сначала точное совпадение, потом приблизительное.
 * Список уже отсортирован по score, поэтому find() даёт самый уверенный вариант.
 */
function pickBest(rated: Candidate[]): Mapping | null {
  if (!rated.length) return null
  const exact = rated.find((c) => accept(c))
  if (exact) return toMapping(exact, false)
  const approx = rated.find((c) => acceptApprox(c))
  return approx ? toMapping(approx, true) : null
}

/** Варианты для ручного выбора в интерфейсе (кнопка «другой вариант»). */
export interface FallbackCandidateView {
  videoId: string
  title: string
  channel: string
  durationSec: number | null
  delta: number
  official: boolean
  badVersion: boolean
}

export async function candidates(track: Track, limit = 8): Promise<FallbackCandidateView[]> {
  const rated = await collect(track)
  return rated.slice(0, limit).map((c) => ({
    videoId: c.track.id.replace(/^yt:/, ''),
    title: c.track.title,
    channel: c.track.artist,
    durationSec: c.track.durationSec,
    delta: Math.round(c.delta),
    official: c.official,
    badVersion: c.badVersion
  }))
}

/** Запоминает выбранный пользователем вариант и сбрасывает кэш ссылки. */
/** Полная запись закреплённого варианта (нужна для подписи в плеере). */
export async function mappingFor(trackId: string): Promise<Mapping | null> {
  return load()[trackId] ?? null
}

/** Какой вариант закреплён за треком (для YouTube-треков тоже работает). */
export function pinnedVideo(trackId: string): string | null {
  // только ручной выбор: автоматически найденная пара — не «закреплённый вариант»
  const m = load()[trackId]
  return m?.forced ? m.videoId : null
}

/** Забыть закреплённый вариант: трек снова играет из своего источника. */
export function unpin(trackId: string): void {
  const data = load()
  if (!data[trackId]) return
  const videoId = data[trackId].videoId
  delete data[trackId]
  save()
  youtube.dropStreamCache(`yt:${videoId}`)
}

export async function pin(track: Track, candidate: FallbackCandidateView): Promise<void> {
  const data = load()
  badVideos.delete(candidate.videoId)
  data[track.id] = {
    videoId: candidate.videoId,
    title: candidate.title,
    artist: candidate.channel,
    durationSec: candidate.durationSec,
    delta: candidate.delta,
    approximate: candidate.badVersion,
    forced: true,
    at: Date.now()
  }
  save()
  // ссылка на поток могла быть закэширована для прошлого варианта
  youtube.dropStreamCache(`yt:${candidate.videoId}`)
}

/**
 * Быстрый путь: один запуск yt-dlp отдаёт и результат поиска, и ссылку.
 * Принимаем его только если название и длительность убедительно совпали,
 * иначе уходим в полный поиск с ранжированием.
 */
async function fastTry(track: Track): Promise<{ mapping: Mapping; stream: ResolvedStream } | null> {
  const firstArtist = track.artist.split(',')[0].trim()
  const titleCore =
    track.title
      .replace(/\([^)]*\)|\[[^\]]*\]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim() || track.title
  const query = `${firstArtist} ${titleCore}`.replace(/\s+/g, ' ').trim()
  if (query.length < 3) return null

  try {
    const one = await ytSearchResolve(query)
    if (!one || badVideos.has(one.videoId)) return null

    const found: Track = {
      id: `yt:${one.videoId}`,
      provider: 'youtube',
      title: one.title,
      artist: one.uploader,
      durationSec: one.duration,
      kind: 'song',
      playable: true
    }
    const rated = rate(track, [found])[0]
    if (!rated) return null

    // на быстром пути нет альтернатив для сравнения — требуем больше уверенности
    const strict = !rated.badVersion && rated.titleScore >= 0.5 && (rated.delta <= 12 || track.durationSec == null)
    if (!strict) {
      console.log(`[fallback] быстрый путь не подошёл: ${one.title} (score ${rated.titleScore.toFixed(2)}, Δ${Math.round(rated.delta)})`)
      return null
    }
    console.log(`[fallback] быстрый путь: ${one.title}`)

    const mime = one.ext === 'webm' ? 'audio/webm' : one.ext === 'm4a' || one.ext === 'mp4' ? 'audio/mp4' : 'audio/mpeg'
    return {
      mapping: toMapping(rated, false),
      stream: {
        url: one.url,
        mime,
        bitrateKbps: one.abr ? Math.round(one.abr) : undefined,
        ttlMs: 45_000,
        fallback: true,
        source: 'youtube',
        videoId: one.videoId
      }
    }
  } catch {
    return null
  }
}

export interface FallbackResult {
  stream: ResolvedStream
  /** что именно нашли на YouTube — для подписи в интерфейсе */
  matched: Track
  fromCache: boolean
  approximate: boolean
}

/** Ищет трек на YouTube (или берёт из карты) и разрешает звук. */
/**
 * Дублирующиеся запросы схлопываются: если поиск по этому треку уже идёт
 * (прогрев по наведению или предзагрузка следующего), клик просто ждёт его
 * результат, а не запускает второй yt-dlp.
 */
const inflight = new Map<string, Promise<FallbackResult>>()

export function toYoutube(track: Track, redo = false): Promise<FallbackResult> {
  if (!redo) {
    const running = inflight.get(track.id)
    if (running) return running
  }
  const job = toYoutubeInner(track, redo).finally(() => {
    if (inflight.get(track.id) === job) inflight.delete(track.id)
  })
  inflight.set(track.id, job)
  return job
}

async function toYoutubeInner(track: Track, redo: boolean): Promise<FallbackResult> {
  const data = load()
  let mapping = redo ? undefined : data[track.id]
  const wasCached = Boolean(mapping)

  if (!mapping) {
    // Метаданные ищу ОДНОВРЕМЕННО с быстрым путём: если быстрый промахнётся,
    // кандидаты уже собраны и второй круг (или повторный поиск) почти не нужен.
    const queries = queriesFor(track)
    const seen = new Map<string, Track>()
    const pool = rankBatch(track, queries.slice(0, 2), seen)
    const fast = await fastTry(track)

    if (fast) {
      // ссылка уже в руках — второй запуск yt-dlp не нужен
      data[track.id] = fast.mapping
      save()
      youtube.rememberStream(`yt:${fast.mapping.videoId}`, fast.stream)
      return {
        stream: {
          ...fast.stream,
          fallbackTitle: `${fast.mapping.artist} — ${fast.mapping.title}`,
          fallbackMatched: { title: fast.mapping.title, artist: fast.mapping.artist }
        },
        matched: toTrack(track.id, fast.mapping),
        fromCache: false,
        approximate: false
      }
    }

    let rated = await pool
    if (!rated.some((c) => accept(c)) && queries.length > 2) {
      rated = await rankBatch(track, queries.slice(2), seen)
    }
    const found = pickBest(rated)
    if (!found) throw new Error(`Не нашёл «${track.artist} — ${track.title}» на YouTube`)
    mapping = found
    data[track.id] = mapping
    const keys = Object.keys(data)
    if (keys.length > STORE_LIMIT) {
      // чистим самые старые записи
      keys
        .sort((a, b) => (data[a]?.at ?? 0) - (data[b]?.at ?? 0))
        .slice(0, keys.length - STORE_LIMIT)
        .forEach((k) => delete data[k])
    }
    save()
  }

  const matched = toTrack(track.id, mapping)
  try {
    const stream = await youtube.resolveStream(`yt:${mapping.videoId}`)
    return {
      stream: {
        ...stream,
        fallback: true,
        fallbackApprox: Boolean(mapping.approximate),
        fallbackTitle: `${mapping.artist} — ${mapping.title}`,
        fallbackMatched: { title: mapping.title, artist: mapping.artist },
        variant: Boolean(mapping.forced),
        variantVideoId: mapping.forced ? mapping.videoId : undefined
      },
      matched,
      fromCache: wasCached,
      approximate: Boolean(mapping.approximate)
    }
  } catch (e) {
    if (!redo) {
      // видео могло исчезнуть — запоминаем его и ищем заново один раз
      badVideos.add(mapping.videoId)
      delete data[track.id]
      save()
      return toYoutube(track, true)
    }
    throw e
  }
}

/** Что уже сопоставлено (для диагностики). */
export function knownMappings(): { ymId: string; videoId: string; delta: number }[] {
  const data = load()
  return Object.entries(data).map(([ymId, m]) => ({ ymId, videoId: m.videoId, delta: m.delta }))
}
