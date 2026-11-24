import type { Track } from './providers/types'
import * as youtube from './providers/youtube'
import * as yandex from './providers/yandex'

/**
 * «Радио артиста» с дозаправкой, в двух режимах.
 *
 * С Яндексом: топ артиста + похожие из `/artists/{id}/similar`.
 * Без Яндекса: YouTube Music отдаёт ту же структуру — топ-треки артиста
 * (50–100 штук), «Похожие исполнители» и их треки. Соседи берутся из этой
 * же сети, а не из библиотеки, поэтому радио звучит как яндексовское:
 * свои хиты → соседи по кругу → второй круг соседей.
 */

const SEED_TRACKS = 14
const NEIGHBOURS = 7
const PAGE_SIZE = 24
const FIRST_FILL = 90
const REFILL = 30
/** сколько страниц у одного похожего артиста готовы листать (Яндекс) */
const MAX_PAGES = 8
/** второй круг: сколько соседей соседей подключаем */
const RING2_PICKS = 4

interface Pool {
  id: string
  name: string
  tracks: Track[]
}

interface Session {
  mode: 'yandex' | 'local'
  title: string
  /** с какого пула начинать очередной круг: чтобы треки не шли всегда по порядку */
  turn: number
  used: Set<string>
  /** скачанные, но ещё не отданные треки: чтобы не терять остаток страницы */
  pending: Track[]
  /* Яндекс */
  similar: { id: string; name: string }[]
  cursor: Map<string, number>
  /* YouTube Music */
  pools: Pool[]
  /** id артистов, чьи треки уже в пулах, и опорные для второго круга */
  known: Set<string>
  ring: number
}

const sessions = new Map<string, Session>()

const normalizeId = (id?: string): string =>
  (id ?? '').replace(/^yt-artist:/, '').replace(/^ym-artist:/, '').trim()

const yandexKey = (id: string): string => `yandex:${normalizeId(id)}`
const localKey = (idOrName: string): string => `local:${idOrName.trim().toLowerCase()}`

function emptySession(mode: Session['mode'], title: string): Session {
  return {
    mode,
    title,
    turn: 0,
    used: new Set(),
    pending: [],
    similar: [],
    cursor: new Map(),
    pools: [],
    known: new Set(),
    ring: 0
  }
}

/** Случайный порядок: радио не должно каждый раз начинаться с одного трека. */
function shuffle<T>(list: T[]): T[] {
  const out = [...list]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

/**
 * Первые треки каждого запуска радио. Берём не только топ-14, а более широкий
 * верх списка (24), перемешиваем и следим, чтобы первый трек не совпал
 * с прошлым запуском этого же артиста.
 */
const lastFirst = new Map<string, string>()

function variedSeed(tracks: Track[], key: string, count: number): Track[] {
  const pool = tracks.filter((t) => t.playable)
  if (!pool.length) return []
  const top = pool.slice(0, Math.max(count, 24))
  const seed = shuffle(top).slice(0, count)
  const prev = lastFirst.get(key)
  if (prev && seed.length > 1 && seed[0].id === prev) {
    const idx = seed.findIndex((t) => t.id !== prev)
    if (idx > 0) [seed[0], seed[idx]] = [seed[idx], seed[0]]
  }
  lastFirst.set(key, seed[0]?.id ?? '')
  return seed
}

function interleave(pools: Track[][], limit: number, used: Set<string>, start = 0): Track[] {
  const out: Track[] = []
  const order =
    pools.length > 1 && start % pools.length
      ? [...pools.slice(start % pools.length), ...pools.slice(0, start % pools.length)]
      : pools
  let added = true
  while (added && out.length < limit) {
    added = false
    for (const pool of order) {
      while (pool.length) {
        const next = pool.shift() as Track
        if (used.has(next.id) || !next.playable) continue
        used.add(next.id)
        out.push(next)
        added = true
        break
      }
      if (out.length >= limit) break
    }
  }
  return out
}

/**
 * Берёт готовые треки из буфера. В `pending` всё уже помечено в `used`
 * (иначе повторный отбор из пулов выкидывал бы те же треки), поэтому
 * здесь только выдача — без повторных проверок.
 */
function takeFromPending(session: Session, limit: number): Track[] {
  const out: Track[] = []
  while (out.length < limit && session.pending.length) {
    const next = session.pending.shift() as Track
    if (!next.playable) continue
    out.push(next)
  }
  return out
}

/* ------------------------- радио от конкретного трека -------------------- */

/**
 * «Похожее» на трек. Сначала спрашиваем точечные похожие треки у источника
 * (Яндекс `/tracks/{id}/similar`, YouTube Music «Up next»), а если их мало —
 * добиваем радио артиста, чтобы очередь не оказалась из трёх песен.
 */
export async function similar(
  token: string | null,
  track: Track
): Promise<{ title: string; tracks: Track[] }> {
  const out: Track[] = []
  const seen = new Set<string>([track.id])
  const add = (list: Track[]): void => {
    for (const t of list) {
      if (!t?.playable || seen.has(t.id)) continue
      seen.add(t.id)
      out.push(t)
    }
  }

  if (track.provider === 'yandex' && token) {
    const numeric = track.id.replace(/^ym:/, '')
    add(await yandex.similarTracks(token, numeric, 30).catch(() => [] as Track[]))
  } else if (track.id.startsWith('yt:')) {
    add(await youtube.relatedTracks(track.id.slice(3), 45).catch(() => [] as Track[]))
  }

  if (out.length < 18) {
    const ref = { id: track.artistId, name: track.artist }
    try {
      const artistRadio =
        track.provider === 'yandex' && token && track.artistId
          ? await start(token, track.artistId)
          : await startLocal(ref)
      add(artistRadio.tracks.slice(0, 40))
    } catch {
      /* без радио артиста останутся только точечные похожие */
    }
  }

  return { title: `Похожее на «${track.title}»`, tracks: out.slice(0, 60) }
}

/* --------------------------------- Яндекс -------------------------------- */

export async function start(token: string, artistId: string): Promise<{ title: string; tracks: Track[] }> {
  const id = String(artistId)
  const [info, own] = await Promise.all([
    yandex.artistPage(token, id).catch(() => null),
    yandex.artistTracks(token, id, 50, 0).catch(() => [] as Track[])
  ])
  const name = info?.title ?? 'Артист'
  const seed = variedSeed(own, yandexKey(id), SEED_TRACKS)

  const similar = shuffle(
    (await yandex.similarArtists(token, id, NEIGHBOURS + 3).catch(() => [])).slice(0, NEIGHBOURS + 3)
  ).slice(0, NEIGHBOURS)
  const pages = await Promise.all(
    similar.map((a) => yandex.artistTracks(token, a.id, PAGE_SIZE, 0).catch(() => [] as Track[]))
  )

  const session = emptySession('yandex', name)
  for (const t of seed) session.used.add(t.id)
  session.similar = similar
  session.cursor = new Map(similar.map((a) => [a.id, 1]))
  const mixed = interleave(
    pages.map((list) => [...list]),
    FIRST_FILL - seed.length,
    session.used,
    Math.floor(Math.random() * Math.max(1, pages.length))
  )
  sessions.set(yandexKey(id), session)

  return { title: `Радио ${name}`, tracks: [...seed, ...mixed] }
}

async function fillYandex(token: string, session: Session): Promise<void> {
  while (session.pending.length < REFILL * 2) {
    const active = session.similar.filter((a) => (session.cursor.get(a.id) ?? 0) < MAX_PAGES)
    if (!active.length) return

    const pages = await Promise.all(
      active.map((a) => {
        const page = session.cursor.get(a.id) ?? 0
        session.cursor.set(a.id, page + 1)
        return yandex.artistTracks(token, a.id, PAGE_SIZE, page).catch(() => [] as Track[])
      })
    )

    const fresh: Track[] = []
    for (const list of pages) {
      for (const t of list) {
        if (session.used.has(t.id) || !t.playable) continue
        if (fresh.some((x) => x.id === t.id)) continue
        fresh.push(t)
      }
    }
    for (const t of fresh) session.used.add(t.id)
    session.pending.push(...fresh)
  }
}

/* ------------------------------ Youtube Music ---------------------------- */

/** Треки нескольких артистов одним заходом: по пулу на каждого. */
async function poolsFor(
  artists: { id: string; name: string }[],
  used: Set<string>
): Promise<Pool[]> {
  const profiles = await Promise.all(
    artists.map((a) =>
      youtube
        .musicArtist({ id: a.id, name: a.name })
        .then((p) => ({ id: p.id, name: p.name, tracks: p.tracks }))
        .catch(() => null)
    )
  )
  const pools: Pool[] = []
  for (const p of profiles) {
    if (!p) continue
    const tracks = p.tracks.filter((t) => t.playable && !used.has(t.id))
    if (tracks.length) pools.push(p)
  }
  return pools
}

/** Догоняет пул до нужного размера, чередуя артистов. */
function draw(session: Session, want: number): number {
  const before = session.pending.length
  let start = session.turn++
  while (session.pending.length < want) {
    const lists = session.pools.map((p) => p.tracks)
    if (!lists.some((l) => l.length)) break
    session.pending.push(...interleave(lists, want - session.pending.length, session.used, start))
    start = 0
    if (!session.pools.some((p) => p.tracks.length)) break
  }
  return session.pending.length - before
}

/**
 * Второй круг: соседи соседей. Профили первых соседей уже в кэше, поэтому
 * это стоит столько же, сколько подключение новых четырёх артистов.
 */
async function expand(session: Session): Promise<boolean> {
  const anchors = [...session.known].slice(0, 4)
  if (!anchors.length) return false
  const profiles = await Promise.all(
    anchors.map((id) => youtube.musicArtist({ id }).catch(() => null))
  )
  const seen = new Set<string>()
  const candidates = profiles
    .flatMap((p) => p?.related ?? [])
    .filter((r) => !session.known.has(r.id) && !seen.has(r.id) && (seen.add(r.id), true))
    .slice(0, RING2_PICKS)
  if (!candidates.length) return false
  for (const c of candidates) session.known.add(c.id)
  const pools = await poolsFor(candidates, session.used)
  session.pools.push(...pools)
  session.ring = 2
  return pools.length > 0
}

export async function startLocal(ref: { id?: string; name?: string }): Promise<{ title: string; tracks: Track[] }> {
  const profile = await youtube.musicArtist({ id: ref.id, name: ref.name })
  const seed = variedSeed(profile.tracks, localKey(profile.id), SEED_TRACKS)

  const session = emptySession('local', profile.name)
  for (const t of seed) session.used.add(t.id)
  session.known.add(profile.id)

  const neighbours = shuffle(profile.related.filter((a) => a.id !== profile.id).slice(0, NEIGHBOURS * 2)).slice(
    0,
    NEIGHBOURS
  )
  session.pools = await poolsFor(neighbours, session.used)
  for (const n of neighbours) session.known.add(n.id)
  session.ring = 1

  sessions.set(localKey(profile.id), session)
  if (ref.name) sessions.set(localKey(ref.name), session)

  draw(session, FIRST_FILL - seed.length)
  const rest = takeFromPending(session, FIRST_FILL - seed.length)
  return { title: `Радио ${profile.name}`, tracks: [...seed, ...rest] }
}

async function fillLocal(session: Session): Promise<void> {
  while (session.pending.length < REFILL) {
    if (draw(session, REFILL) > 0) continue
    if (session.ring >= 2) return
    const expanded = await expand(session).catch(() => false)
    if (!expanded) return
  }
}

/* --------------------------------- общее --------------------------------- */

interface Ref {
  id?: string
  name?: string
}

/** Следующая порция. Пустой массив — радио исчерпано. */
export async function more(token: string | null, ref: Ref): Promise<Track[]> {
  const id = normalizeId(ref.id)
  const name = (ref.name ?? '').trim()

  const session = (id ? sessions.get(yandexKey(id)) : undefined) ?? (id ? sessions.get(localKey(id)) : undefined) ?? (name ? sessions.get(localKey(name)) : undefined)

  if (!session) {
    // сессию потеряли (перезапуск): начинаем заново, лишнее отфильтрует очередь
    if (token && id) return (await start(token, id)).tracks
    if (name || id) return (await startLocal(ref)).tracks
    return []
  }

  if (session.mode === 'yandex') {
    if (!token) return []
    await fillYandex(token, session)
  } else {
    await fillLocal(session)
  }
  return takeFromPending(session, REFILL)
}

export function stop(ref: Ref): void {
  const id = normalizeId(ref.id)
  if (id) {
    sessions.delete(yandexKey(id))
    sessions.delete(localKey(id))
  }
  if (ref.name) sessions.delete(localKey(ref.name))
}

export function isActive(ref: Ref): boolean {
  const id = normalizeId(ref.id)
  if (id && (sessions.has(yandexKey(id)) || sessions.has(localKey(id)))) return true
  if (ref.name && sessions.has(localKey(ref.name))) return true
  return false
}
