import { snapshot } from './library'
import type { BrowsePage, Track } from './providers/types'
import * as youtube from './providers/youtube'

/**
 * Страницы артиста/альбома и соседи для радио без Яндекса.
 *
 * У YouTube нет ни артистов, ни альбомов, ни «похожих» — поэтому страницы
 * собираются из поиска yt-dlp, а «соседей» для радио даёт сама библиотека:
 * исполнители, которых пользователь чаще всего лайкает и слушает.
 */

function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

/** Упоминается ли артист в заголовке/канале (учитываем списки «A, B»). */
function mentions(text: string, name: string): boolean {
  const haystack = normalize(text)
  const parts = name
    .split(/[,&]/)
    .map((p) => normalize(p))
    .filter((p) => p.length > 1)
  if (!parts.length) return false
  return parts.some((p) => haystack.includes(p))
}

function artistOf(track: Track): string {
  return (track.artist ?? '').split(',')[0]?.replace(/\s*-\s*Topic$/i, '').trim() ?? ''
}

/* ----------------------- статистика из библиотеки ------------------------- */

export interface ArtistWeight {
  name: string
  score: number
}

/**
 * Любимые исполнители по локальным данным: лайк весит больше прослушивания.
 * Работает без сети и без Яндекса.
 */
export function artistWeights(): ArtistWeight[] {
  const lib = snapshot()
  const score = new Map<string, number>()
  const bump = (t: Track, weight: number): void => {
    const name = artistOf(t)
    if (!name || name.toLowerCase() === 'youtube') return
    score.set(name, (score.get(name) ?? 0) + weight)
  }
  for (const t of lib.likes) bump(t, 3)
  for (const t of lib.history) bump(t, 1)

  return [...score.entries()]
    .map(([name, value]) => ({ name, score: value }))
    .sort((a, b) => b.score - a.score)
}

/** Лайкнутые/слушанные треки указанных исполнителей (для локального радио). */
export function tracksByArtists(names: string[]): Track[] {
  const wanted = new Set(names.map((n) => normalize(n)))
  const lib = snapshot()
  const seen = new Set<string>()
  const out: Track[] = []
  for (const t of [...lib.likes, ...lib.history]) {
    if (!t.playable || seen.has(t.id)) continue
    if (!wanted.has(normalize(artistOf(t)))) continue
    seen.add(t.id)
    out.push(t)
  }
  return out
}

/* ------------------------- страницы на YouTube ---------------------------- */

function plural(n: number, one: string, few: string, many: string): string {
  const mod100 = n % 100
  const mod10 = n % 10
  if (mod100 >= 11 && mod100 <= 14) return many
  if (mod10 === 1) return one
  if (mod10 >= 2 && mod10 <= 4) return few
  return many
}

function countTracks(count: number): string {
  return `${count} ${plural(count, 'трек', 'трека', 'треков')}`
}

function listSubtitle(count: number, note: string): string {
  return `${countTracks(count)} · ${note}`
}

/**
 * Ключ названия для дедупа: без «(feat. …)», «[Official Video]», регистра и
 * пунктуации, плюс выбрасываем слова имени артиста — иначе «Consider» и
 * «Consider RJ Pasin, Mathieux Davis» считались разными треками.
 */
function titleKey(title: string, artist?: string): string {
  const clean = title
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/\((?:feat|ft|prod|official|remix|live|cover)[^)]*\)/g, '')
    .replace(/\[[^\]]*\]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')

  const artistWords = new Set(
    (artist ?? '')
      .toLowerCase()
      .replace(/ё/g, 'е')
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .split(' ')
      .filter((w) => w.length >= 2)
  )
  const tokens = [...new Set(clean.split(' ').filter((w) => w && !artistWords.has(w)))]
  return tokens.sort().join(' ')
}

/** Слова, по которым видно перезалив, а не оригинал. */
const JUNK = /(bass ?boost|slowed|reverb|sped ?up|nightcore|8d audio|lyrics|lyric video|reaction|\u0440\u0430\u0437\u0431\u043e\u0440|\u043a\u0430\u0432\u0435\u0440)/i

/**
 * Убирает дубли из поисковой выдачи: один трек живёт в нескольких загрузках
 * («X», «X (Official Audio)», «X — исполнитель»), и в списке это выглядит как
 * повтор с чуть другим названием. Заодно отсекает перезаливы с «bass boosted»
 * и «slowed», если после фильтра остаётся хоть что-то осмысленное.
 */
function dedupeTracks(list: Track[], artist?: string): Track[] {
  const seenIds = new Set<string>()
  const seenTitles = new Set<string>()
  const out: Track[] = []
  for (const t of list) {
    const key = titleKey(t.title, artist)
    if (seenIds.has(t.id) || (key && seenTitles.has(key))) continue
    seenIds.add(t.id)
    if (key) seenTitles.add(key)
    out.push(t)
  }
  const clean = out.filter((t) => !JUNK.test(t.title))
  return clean.length >= 4 ? clean : out
}

/**
 * Страница артиста: YouTube Music отдаёт топ-треки, альбомы и похожих
 * исполнителей — то же, что Яндекс, только без подписки. Если артист не
 * нашёлся (каверы, транслит), остаётся старый путь через поиск yt-dlp.
 */
export async function youtubeArtistPage(ref: { id?: string; name?: string }): Promise<BrowsePage> {
  const clean = (ref.name ?? '').trim()
  try {
    const artist = await youtube.musicArtist({ id: ref.id, name: clean })
    if (artist.tracks.length >= 3 || artist.albums.length) {
      const tracks = dedupeTracks(artist.tracks)
      // годы берутся из альбомов: у песен YouTube Music их нет
      await youtube.fillYears(tracks.slice(0, 20), 6).catch(() => tracks)
      return {
        kind: 'artist',
        id: `yt-artist:${artist.id}`,
        title: artist.name,
        subtitle: listSubtitle(artist.tracks.length, 'YouTube Music'),
        coverUrl: artist.coverUrl,
        tracks,
        albums: artist.albums,
        related: artist.related
      }
    }
  } catch {
    /* ниже — поиск */
  }

  const results = await youtube.search(clean, 30)
  const matched = results.filter((t) => mentions(`${t.title} ${t.artist}`, clean))
  const tracks = dedupeTracks((matched.length >= 4 ? matched : results).filter((t) => t.playable))
  return {
    kind: 'artist',
    id: `yt-name:${clean}`,
    title: clean,
    subtitle: listSubtitle(tracks.length, 'YouTube'),
    coverUrl: tracks[0]?.coverUrl,
    tracks
  }
}

/**
 * Страница альбома: настоящий альбом по id (`MPREb…`), если он пришёл из
 * YouTube Music. Иначе — поиск «артист + название»: альбомов у yt-dlp нет.
 */
function wordsOf(value: string): string[] {
  return normalize(value)
    .split(' ')
    .filter((w) => w.length > 1)
}

/** Трек реально этого артиста? Сравниваем по словам, а не по подстроке. */
function byArtist(trackArtist: string | undefined, wanted: string[]): boolean {
  if (!trackArtist || !wanted.length) return false
  const have = new Set(wordsOf(trackArtist))
  return wanted.every((w) => have.has(w))
}

function primaryArtist(ref: { artist?: string }): string[] {
  return wordsOf((ref.artist ?? '').split(',')[0] ?? '')
}

/**
 * Проверка, что найденный альбом действительно наш: у Arctic Monkeys «AM»
 * поиск отдавал «Damn Look At These Massive Brit Hits» — название похоже, а
 * артист нет. Точное совпадение названия считаем достаточным, иначе требуем
 * упоминание артиста в шапке или в первых строках.
 */
function albumFits(page: BrowsePage, ref: { title?: string; artist?: string }): boolean {
  const wanted = primaryArtist(ref)
  if (!wanted.length) return true

  const sample = page.tracks.slice(0, 8)
  const own = sample.filter((t) => byArtist(t.artist, wanted)).length
  if (byArtist(page.subtitle, wanted)) return true
  if (own >= Math.max(2, Math.ceil(sample.length / 2))) return true

  // название совпало, но про артиста в шапке ничего нет — верим названию
  const subFirst = (page.subtitle ?? '').split('·')[0].trim()
  const hasArtistInfo = Boolean(subFirst) && !/^\d{4}$/.test(subFirst) && subFirst !== 'YouTube'
  if (hasArtistInfo) return false

  const wantedTitle = wordsOf(ref.title ?? '')
  return wantedTitle.length > 0 && wantedTitle.join(' ') === wordsOf(page.title).join(' ')
}

async function albumPageFromId(id: string): Promise<BrowsePage> {
  const album = await youtube.musicAlbum(id)
  const note = [album.artist, album.year].filter(Boolean).join(' · ') || 'YouTube Music'
  return {
    kind: 'album',
    id: `yt-album:${album.id}`,
    title: album.title,
    subtitle: `${note} · ${countTracks(album.tracks.length)}`,
    coverUrl: album.coverUrl,
    tracks: album.tracks
  }
}

/**
 * Страница альбома без Яндекс Плюса.
 *
 * 1. есть настоящий id YouTube Music (`MPREb…`) — открываем его;
 * 2. id чужой (яндексовский номер) или его нет — ищем альбом по названию и
 *    исполнителю в YouTube Music: треки с обложкой, годом и без повторов;
 * 3. ничего не нашли — поиск yt-dlp с дедупом по названию.
 */
export async function youtubeAlbumPage(ref: {
  id?: string
  title?: string
  artist?: string
  /** трек, из которого открыли альбом: по нему ищем альбом и чистим выдачу */
  trackTitle?: string
}): Promise<BrowsePage> {
  const albumId = (ref.id ?? '').replace(/^yt-album:/, '')
  if (/^MPREb/.test(albumId)) {
    try {
      const page = await albumPageFromId(albumId)
      if (albumFits(page, ref)) return page
    } catch {
      /* ниже — поиск по названию */
    }
  }

  const clean = (ref.title ?? '').trim()
  if (clean) {
    const found = await youtube.musicAlbumByTitle({ artist: ref.artist, title: clean }).catch(() => null)
    if (found) {
      try {
        const page = await albumPageFromId(found.id)
        if (albumFits(page, ref)) return page
      } catch {
        /* ниже — поиск по треку */
      }
    }
  }

  // альбом может быть старым и не попадать в первые карточки артиста:
  // тогда его проще найти через сам трек
  const trackTitle = (ref.trackTitle ?? '').trim()
  if (trackTitle) {
    const found = await youtube.musicAlbumOfTrack({ artist: ref.artist, title: trackTitle }).catch(() => null)
    if (found) {
      try {
        const page = await albumPageFromId(found.id)
        if (albumFits(page, ref)) return page
      } catch {
        /* ниже — поиск */
      }
    }
  }

  if (!clean) throw new Error('Нет данных об альбоме')
  const wanted = primaryArtist(ref)

  /*
   * Последний шанс — yt-dlp. Здесь важно не вывалить «солянку»:
   * если знаем трек, оставляем только его версии у этого же артиста;
   * иначе — только треки артиста, и в любом случае не больше восьми.
   */
  const query = ref.artist ? `${ref.artist} ${trackTitle || clean}` : trackTitle || clean
  const found = (await youtube.search(query, 30)).filter((t) => t.playable)
  const own = wanted.length ? found.filter((t) => byArtist(t.artist, wanted)) : []
  let tracks = own.length ? own : found
  if (trackTitle) {
    const key = titleKey(trackTitle, ref.artist)
    const same = tracks.filter((t) => {
      const k = titleKey(t.title, ref.artist)
      return k === key || k.startsWith(key) || key.startsWith(k)
    })
    if (same.length) tracks = same
  }
  tracks = dedupeTracks(tracks, ref.artist).slice(0, 8)
  return {
    kind: 'album',
    id: `yt-album-name:${query}`,
    title: clean,
    subtitle: trackTitle
      ? `${[ref.artist, 'версии трека'].filter(Boolean).join(' · ')} · YouTube · ${countTracks(tracks.length)}`
      : `${[ref.artist, 'YouTube'].filter(Boolean).join(' · ')} · ${countTracks(tracks.length)}`,
    coverUrl: tracks[0]?.coverUrl,
    tracks
  }
}
