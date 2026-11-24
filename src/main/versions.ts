/**
 * Версии трека: ремиксы, каверы, оркестровки, хардтек, phonk и прочие переделки.
 *
 * Раньше «другой вариант» искал просто другую загрузку того же исходника (копию
 * на YouTube). Теперь это подборка *версий*: несколько целевых поисков по
 * YouTube, фильтр по словам названия, метка жанра и дедупликация.
 *
 * Кэш на 15 минут: панель можно открывать-закрывать без повторных запусков
 * yt-dlp, но новые загрузки всё же подхватываются.
 */
import type { Track } from './providers/types'
import * as youtube from './providers/youtube'

export interface TrackVersion {
  /** готовый трек для очереди (`yt:<videoId>`) */
  track: Track
  videoId: string
  title: string
  channel: string
  durationSec: number | null
  coverUrl?: string
  /** «ремикс», «кавер», «оркестр», «hardtekk»… */
  label: string
}

const CACHE_TTL = 15 * 60 * 1000
const MAX_RESULTS = 24

const cache = new Map<string, { at: number; value: TrackVersion[] }>()

interface LabelRule {
  re: RegExp
  label: string
  /** чем выше, тем интереснее версия и тем она выше в списке */
  rank: number
}

const LABELS: LabelRule[] = [
  { re: /hard ?tekk|хардтек/i, label: 'hardtekk', rank: 6 },
  { re: /orchestr|symphon|оркестр|симфони/i, label: 'оркестр', rank: 6 },
  { re: /phonk|фонк/i, label: 'phonk', rank: 5 },
  { re: /\brock\b|рок[- ]?верси|metal|метал/i, label: 'рок', rank: 5 },
  { re: /remix|ремикс|rmx/i, label: 'ремикс', rank: 5 },
  { re: /cover|кавер/i, label: 'кавер', rank: 4 },
  { re: /acoustic|акустик|piano|пианино/i, label: 'акустика', rank: 4 },
  { re: /instrumental|инструментал|без слов/i, label: 'инструментал', rank: 4 },
  { re: /slowed|reverb/i, label: 'замедлено', rank: 3 },
  { re: /speed ?up|sped ?up/i, label: 'ускорено', rank: 3 },
  { re: /nightcore|night core/i, label: 'nightcore', rank: 3 },
  { re: /8 ?d\b/i, label: '8D', rank: 2 },
  { re: /\blive\b|concert|концерт/i, label: 'live', rank: 2 },
  { re: /bass ?boost/i, label: 'bass boost', rank: 2 },
  { re: /mashup|edit|переделк|version|версия|\bmix\b/i, label: 'версия', rank: 1 }
]

/** Слова, по которым видно, что это переделка, а не просто перезалив. */
const VERSIONISH =
  /remix|ремикс|cover|кавер|orchestr|оркестр|symphon|acoustic|акустик|instrumental|инструментал|slowed|reverb|speed ?up|sped ?up|nightcore|8 ?d\b|bass ?boost|\blive\b|concert|концерт|hard ?tekk|хардтек|phonk|фонк|\brock\b|metal|\bversion\b|версия|mashup|\bedit\b|\bmix\b/i

const NOISE = /\(?(official video|official audio|official music video|lyrics? video|visualizer|audio)\)?/gi

function flat(s: string): string {
  return s
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/\([^)]*\)|\[[^\]]*\]/g, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

function words(s: string): string[] {
  return [...new Set(flat(s).split(' ').filter(Boolean))]
}

/** «Название (feat. X) [Official Video]» → «Название». */
function baseTitle(title: string): string {
  return title
    .replace(/\((?:feat|ft|prod)[^)]*\)/gi, '')
    .replace(/\[[^\]]*\]/g, '')
    .replace(NOISE, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

function labelOf(text: string): LabelRule | null {
  for (const rule of LABELS) if (rule.re.test(text)) return rule
  return null
}

/** Название без «official audio» и лишней пунктуации — ключ для дедупликации. */
function dedupeKey(title: string): string {
  return flat(title.replace(NOISE, ''))
}

function videoIdOf(track: Track): string {
  return track.id.startsWith('yt:') ? track.id.slice(3) : ''
}

function cached(key: string): TrackVersion[] | null {
  const hit = cache.get(key)
  if (!hit) return null
  if (Date.now() - hit.at > CACHE_TTL) {
    cache.delete(key)
    return null
  }
  return hit.value
}

/** Параллельные поиски с ограничением: yt-dlp — отдельный процесс на запрос. */
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = []
  let next = 0
  const workers = Array.from({ length: Math.min(limit, items.length) || 1 }, async () => {
    while (next < items.length) {
      const i = next++
      try {
        out[i] = await fn(items[i])
      } catch {
        out[i] = undefined as R
      }
    }
  })
  await Promise.all(workers)
  return out.filter((x) => x !== undefined)
}

export async function listVersions(track: Track): Promise<TrackVersion[]> {
  const title = baseTitle(track.title)
  const artist = (track.artists?.[0]?.name ?? track.artist ?? '').split(',')[0].trim()
  if (!title) return []

  const key = `${title.toLowerCase()}|${artist.toLowerCase()}`
  const hit = cached(key)
  if (hit) return hit

  // артист есть в каждом запросе: без него на распространённые названия
  // («Witch Doctor») прилетают чужие песни с тем же словом
  const tag = artist ? ` ${artist}` : ''
  const queries = [
    `${artist} ${title}`.trim(),
    `${title}${tag} remix`,
    `${title}${tag} cover`,
    `${title}${tag} orchestral`,
    `${title}${tag} rock version`,
    `${title}${tag} hardtekk`,
    `${title}${tag} phonk`
  ]

  const found = await mapLimit(queries, 7, (q) => youtube.search(q, 10))
  const originalId = videoIdOf(track)
  const wanted = words(title).filter((w) => w.length >= 3)
  const artistWords = words(artist).filter((w) => w.length >= 3)

  const seenIds = new Set<string>()
  const seenTitles = new Set<string>()
  const scored: { v: TrackVersion; score: number }[] = []

  for (const t of found.flat()) {
    if (!t.playable) continue
    const videoId = videoIdOf(t)
    if (!videoId || videoId === originalId || seenIds.has(videoId)) continue

    const text = `${t.title} ${t.artist}`
    const rule = labelOf(text)
    // без «версионного» слова это просто другой перезалив — не наша задача
    if (!rule && !VERSIONISH.test(text)) continue

    const flatText = flat(text)
    const hits = wanted.filter((w) => flatText.includes(w)).length
    const need = Math.max(1, Math.ceil(wanted.length / 2))
    if (wanted.length && hits < need) continue

    // слишком короткие/долгие ролики — обычно обрезки или часовые лупы
    if (track.durationSec && t.durationSec) {
      const ratio = t.durationSec / track.durationSec
      if (ratio < 0.3 || ratio > 3) continue
    }

    const titleKey = dedupeKey(t.title)
    if (seenTitles.has(titleKey)) continue
    seenIds.add(videoId)
    seenTitles.add(titleKey)

    const artistHit = artistWords.some((w) => flatText.includes(w))
    // версия должна быть именно этого исполнителя: иначе в подборку попадают
    // одноимённые песни других групп
    if (artistWords.length && !artistHit) continue
    scored.push({
      score: (rule?.rank ?? 1) * 10 + hits * 5 + 3,
      v: {
        track: t,
        videoId,
        title: t.title,
        channel: t.artist,
        durationSec: t.durationSec,
        coverUrl: t.coverUrl,
        label: rule?.label ?? 'версия'
      }
    })
  }

  // не даём одному жанру занять весь список: сначала по несколько на метку,
  // потом добираем остальное по счёту
  const sorted = scored.sort((a, b) => b.score - a.score)
  const perLabel = new Map<string, number>()
  const primary: typeof sorted = []
  const rest: typeof sorted = []
  // «замедлено/ускорено/8D» — дешёвые перезаливы, их не больше двух
  const cheap = new Set(['замедлено', 'ускорено', '8D', 'bass boost', 'версия'])
  for (const item of sorted) {
    const n = perLabel.get(item.v.label) ?? 0
    const cap = cheap.has(item.v.label) ? 2 : 5
    if (n < cap && primary.length < MAX_RESULTS) {
      perLabel.set(item.v.label, n + 1)
      primary.push(item)
    } else rest.push(item)
  }
  const value = [...primary, ...rest].slice(0, MAX_RESULTS).map((x) => x.v)

  cache.set(key, { at: Date.now(), value })
  return value
}
