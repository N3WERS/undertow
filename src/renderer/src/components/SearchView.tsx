import { useEffect, useRef, useState } from 'react'
import type { AlbumRef, ArtistRef, PlaylistRef, Track } from '../types'
import TrackList from './TrackList'
import { IconPause, IconPlay, IconQueue, IconSearch, IconX } from './Icons'

interface Props {
  currentId: string | null
  playing: boolean
  onPlay: (track: Track, list: Track[]) => void
  onToggle: () => void
  likedIds?: Set<string>
  onLike?: (track: Track) => void
  onHover?: (track: Track) => void
  onOpenArtist?: (target: { id?: string; name: string }) => void
  onOpenAlbum?: (target: { id?: string; title: string; artist?: string; trackTitle?: string }) => void
  onOpenPlaylist?: (target: { id: string; title: string }) => void
  onAddToPlaylist?: (track: Track) => void
  onSimilar?: (track: Track) => void
  onAddToQueue?: (track: Track) => void
}


function stripVersion(title: string): string {
  return title.replace(/\([^)]*\)|\[[^]]*]/g, ' ').trim()
}

function queryShape(term: string): { parts: string[]; tokens: string[] } {
  const normalized = latinKey(term)
  const parts = term
    .split(/\s+[-–—]\s+/)
    .map(latinKey)
    .filter(Boolean)
  const tokens = normalized.split(' ').filter((t) => t.length > 1 || /\d/.test(t))
  return { parts, tokens }
}

function trackScore(track: Track, term: string): number {
  const q = queryShape(term)
  const artist = latinKey(track.artist)
  const title = latinKey(stripVersion(track.title))
  const hay = `${artist} ${title}`
  let score = 0
  if (q.parts.length >= 2) {
    for (const part of q.parts) score += hay.includes(part) ? 60 : -25
    if (artist.includes(q.parts[0])) score += 50
    if (title.includes(q.parts[q.parts.length - 1])) score += 50
  } else {
    const first = q.tokens[0] ?? ''
    if (first && artist.includes(first)) score += 45
    if (first && title.includes(first)) score += 45
  }
  for (const token of q.tokens) if (hay.includes(token)) score += 10
  if (title === latinKey(term)) score += 30
  return score
}

function mergeTracks(base: Track[], extra: Track[], term: string): Track[] {
  const seenIds = new Set<string>()
  const ranked: { track: Track; score: number; order: number }[] = []
  const keyIndex = new Map<string, number>()
  const q = queryShape(term)
  const isStrong = (track: Track): boolean => {
    const hay = latinKey(`${track.artist} ${stripVersion(track.title)}`)
    if (q.parts.length >= 2) return q.parts.every((part) => hay.includes(part))
    return q.tokens.every((token) => hay.includes(token))
  }
  // Если YouTube Music нашёл только «что-то по слову», доверяем порядку
  // обычного YouTube: там каверы и пользовательские загрузки релевантнее.
  const ordered = base.some(isStrong) ? [...base, ...extra] : [...extra, ...base]
  for (const track of ordered) {
    const key = `${latinKey(stripVersion(track.title))}|${latinKey(track.artist)}`
    const existing = keyIndex.get(key)
    if (existing !== undefined) {
      // та же песня пришла из каталога и из обычного YouTube: оставляем
      // официальные метаданные, даже если первой была пользовательская копия
      if (track.official && !ranked[existing].track.official) {
        ranked[existing].track = { ...track, official: true }
        ranked[existing].score = trackScore(track, term)
      } else {
        const prev = ranked[existing].track
        if (track.catalog && !prev.catalog) prev.catalog = true
        if (track.verified && !prev.verified) prev.verified = true
        if (track.catalogRank != null && prev.catalogRank == null) prev.catalogRank = track.catalogRank
      }
      continue
    }
    if (seenIds.has(track.id)) continue
    seenIds.add(track.id)
    keyIndex.set(key, ranked.length)
    ranked.push({ track, score: trackScore(track, term), order: ranked.length })
  }
  ranked.sort((a, b) => b.score - a.score || a.order - b.order)
  return ranked.map((x) => x.track)
}

const TRANSLIT: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z',
  и: 'i', й: 'i', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r',
  с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'c', ч: 'ch', ш: 'sh',
  щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya'
}

/** Латиница и кириллица приводятся к одной форме: macan = макан. */
function latinKey(value: string): string {
  const transliterated = value
    .toLowerCase()
    .replace(/ё/g, 'е')
    .split('')
    .map((ch) => TRANSLIT[ch] ?? ch)
    .join('')
  return transliterated
    .replace(/ck/g, 'k')
    .replace(/c/g, 'k')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function artistKey(track: Track): string {
  return latinKey(track.artists?.[0]?.name || track.artist)
}

function trackArtists(track: Track): string[] {
  const names = track.artists?.map((a) => a.name) ?? [track.artist]
  return [...new Set(names.map(latinKey).filter(Boolean))]
}

function hasArtist(track: Track, key: string): boolean {
  return Boolean(key) && trackArtists(track).includes(key)
}

/** Слова запроса должны быть в названии, а не только в имени артиста. */
function titleMatchesQuery(track: Track, query: string): boolean {
  const stop = new Set(['the', 'and', 'feat', 'ft', 'with'])
  const names = [track.artist, ...(track.artists ?? []).map((a) => a.name)]
  const artistWords = new Set(
    names.flatMap((name) => latinKey(name).split(' ')).filter((word) => word.length > 1)
  )
  const allTokens = latinKey(query)
    .split(' ')
    .filter((t) => t.length > 1)
  const tokens = allTokens.filter((t) => !artistWords.has(t) && !stop.has(t))
  const effective = tokens.length ? tokens : allTokens
  if (!effective.length) return true
  let hay = latinKey(track.title)
  for (const name of names) {
    const full = latinKey(name)
    if (full) hay = hay.replace(full, ' ')
    for (const part of full.split(' ')) {
      if (part.length >= 3 && !stop.has(part)) hay = hay.replace(part, ' ')
    }
  }
  hay = hay.replace(/\s+/g, ' ').trim()
  return effective.every((token) => hay.includes(token))
}

const TYPE_LABEL: Record<string, string> = { single: 'сингл', ep: 'EP', album: 'альбом' }
const HISTORY_KEY = 'undertow.searchHistory'

function readHistory(): string[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    return Array.isArray(parsed)
      ? parsed.filter((x): x is string => typeof x === 'string' && x.trim().length > 0).slice(0, 5)
      : []
  } catch {
    return []
  }
}

export default function SearchView({
  currentId,
  playing,
  onPlay,
  onToggle,
  likedIds,
  onLike,
  onHover,
  onAddToQueue,
  onOpenArtist,
  onOpenAlbum,
  onOpenPlaylist,
  onAddToPlaylist,
  onSimilar
}: Props) {
  const [query, setQuery] = useState('')
  const [tracks, setTracks] = useState<Track[]>([])
  const [albums, setAlbums] = useState<AlbumRef[]>([])
  const [artists, setArtists] = useState<ArtistRef[]>([])
  const [playlists, setPlaylists] = useState<PlaylistRef[]>([])
  const [history, setHistory] = useState<string[]>(readHistory)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [visibleCount, setVisibleCount] = useState(20)
  const [hasMore, setHasMore] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [youtubeBusy, setYoutubeBusy] = useState(false)
  const [ytOffset, setYtOffset] = useState(0)
  const [mode, setMode] = useState<'all' | 'tracks' | 'albums' | 'playlists' | 'artists' | 'soundcloud'>('all')
  const [scTracks, setScTracks] = useState<Track[]>([])
  const [scBusy, setScBusy] = useState(false)
  const [scHasMore, setScHasMore] = useState(true)
  const [scMoreBusy, setScMoreBusy] = useState(false)
  const searchSeq = useRef(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const lastQuery = useRef('')
  const [asked, setAsked] = useState(false)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const remember = (term: string): void => {
    setHistory((prev) => {
      const next = [term, ...prev.filter((x) => x.toLowerCase() !== term.toLowerCase())].slice(0, 5)
      try {
        localStorage.setItem(HISTORY_KEY, JSON.stringify(next))
      } catch {
        /* приватный режим — история просто не сохранится */
      }
      return next
    })
  }

  const run = async (q: string) => {
    const term = q.trim()
    if (!term) return
    const seq = ++searchSeq.current
    setBusy(true)
    setError(null)
    setAsked(true)
    lastQuery.current = term
    setVisibleCount(20)
    setHasMore(true)
    setYtOffset(0)
    setYoutubeBusy(false)
    setScTracks([])
    setScBusy(true)
    setScHasMore(true)
    setScMoreBusy(false)
    setMode('all')
    remember(term)
    void window.undertow
      .soundcloudSearch(term, 20)
      .then((list) => {
        if (seq !== searchSeq.current) return
        setScTracks(list)
        setScHasMore(list.length >= 20)
        if (list.length) setError(null)
      })
      .catch(() => undefined)
      .finally(() => {
        if (seq === searchSeq.current) setScBusy(false)
      })
    try {
      const found = await window.undertow.searchAll(term)
      if (seq !== searchSeq.current) return
      setTracks(found.tracks)
      setAlbums(found.albums)
      setArtists(found.artists)
      setPlaylists(found.playlists ?? [])

      void enrichFromYoutube(term, found.tracks, seq)
    } catch (e) {
      if (seq !== searchSeq.current) return
      setError(e instanceof Error ? e.message : String(e))
      setTracks([])
      setAlbums([])
      setArtists([])
      setPlaylists([])
    } finally {
      if (seq === searchSeq.current) setBusy(false)
    }
  }

  /**
   * YouTube Music не содержит каверов и пользовательских загрузок.
   * Второй этап — обычный YouTube; результаты аккуратно вливаем и сортируем.
   */
  const enrichFromYoutube = async (term: string, base: Track[], seq: number) => {
    setYoutubeBusy(true)
    try {
      const extra = await window.undertow.searchYoutube(term, 20)
      if (seq !== searchSeq.current) return
      setYtOffset(extra.length)
      if (extra.length) {
        setTracks((prev) => mergeTracks(prev, extra, term))
        setError(null)
        setHasMore(true)
      } else if (!base.length) {
        setError('Ничего не нашлось — попробуй сформулировать иначе.')
      }
    } catch {
      if (seq === searchSeq.current && !base.length) {
        setError('Ничего не нашлось — попробуй сформулировать иначе.')
      }
    } finally {
      if (seq === searchSeq.current) setYoutubeBusy(false)
    }
  }

  /** Следующая страница SoundCloud: API отдаёт её по offset. */
  const loadMoreSoundcloud = async (): Promise<void> => {
    const term = lastQuery.current
    if (!term || scMoreBusy || !scHasMore) return
    const seq = searchSeq.current
    setScMoreBusy(true)
    try {
      const list = await window.undertow.soundcloudSearch(term, 20, scTracks.length)
      if (seq !== searchSeq.current) return
      const seen = new Set(scTracks.map((t) => t.id))
      const fresh = list.filter((t) => !seen.has(t.id))
      if (fresh.length) setScTracks((prev) => [...prev, ...fresh])
      setScHasMore(list.length >= 20 && fresh.length > 0)
    } catch {
      if (seq === searchSeq.current) setScHasMore(false)
    } finally {
      if (seq === searchSeq.current) setScMoreBusy(false)
    }
  }

  const queryText = lastQuery.current
  const catalogTop = tracks
    .filter((t) => t.catalog)
    .sort((a, b) => (a.catalogRank ?? 9999) - (b.catalogRank ?? 9999))[0]
  const catalogPrimary = catalogTop ? artistKey(catalogTop) : ''
  const queryKey = latinKey(queryText)
  const firstArtistKey = artists[0] ? latinKey(artists[0].name) : ''
  // «кино» и «macan» — запросы артиста, «династия» и «numb» — названия.
  // Первый результат каталога может быть чужой песней с таким названием,
  // поэтому дополнительно смотрим на верхнего артиста из поиска артистов.
  const artistIntent =
    Boolean(catalogPrimary) &&
    (catalogPrimary === queryKey ||
      (firstArtistKey === queryKey && firstArtistKey !== catalogPrimary))
  const intentPrimary = artistIntent
    ? firstArtistKey === queryKey
      ? firstArtistKey
      : catalogPrimary
    : catalogPrimary
  const isRelevant = (t: Track): boolean =>
    artistIntent
      ? hasArtist(t, intentPrimary) || titleMatchesQuery(t, queryText)
      : titleMatchesQuery(t, queryText)
  const relevantTracks = tracks.filter(isRelevant)

  const verifiedCounts = new Map<string, number>()
  for (const t of relevantTracks) {
    if (!t.official || !t.verified) continue
    const key = artistKey(t)
    verifiedCounts.set(key, (verifiedCounts.get(key) ?? 0) + 1)
  }
  const bestVerified = [...verifiedCounts.entries()].sort((a, b) => b[1] - a[1])[0]
  const firstVerified = relevantTracks.find((t) => t.official && t.verified)
  const primaryKey = artistIntent
    ? intentPrimary
    : bestVerified && bestVerified[1] >= 2
      ? bestVerified[0]
      : firstVerified
        ? artistKey(firstVerified)
        : catalogPrimary || bestVerified?.[0] || ''
  const orderedRelevant = [...relevantTracks].sort((a, b) => {
    const rank = (t: Track): number =>
      hasArtist(t, primaryKey) ? 2 : t.official ? 1 : 0
    return rank(b) - rank(a)
  })
  const visibleTracks = orderedRelevant.slice(0, visibleCount)
  const officialTracks = visibleTracks
    .filter((t) => t.official)
    .sort((a, b) => Number(hasArtist(b, primaryKey)) - Number(hasArtist(a, primaryKey)))
  const uploadTracks = visibleTracks.filter((t) => !t.official)
  const scShown = mode === 'soundcloud' ? scTracks : scTracks.slice(0, 6)
  const playlistCards = playlists.map((pl) => (
    <button
      key={pl.id}
      className="search-album-card search-playlist-card"
      onClick={() => onOpenPlaylist?.({ id: pl.id, title: pl.title })}
      title={`Открыть плейлист: ${pl.title}`}
    >
      <span className="search-album-cover">
        {pl.coverUrl ? <img src={pl.coverUrl} alt="" loading="lazy" /> : <i>♫</i>}
        <span className="search-album-play">
          <IconQueue width={14} height={14} />
        </span>
      </span>
      <span className="search-album-title">{pl.title}</span>
      <span className="search-album-sub">{pl.subtitle || 'плейлист'}</span>
    </button>
  ))
  const albumCards = albums.map((a) => (
    <button
      key={a.id}
      className="search-album-card"
      onClick={() => onOpenAlbum?.({ id: `yt-album:${a.id}`, title: a.title, artist: undefined })}
    >
      <span className="search-album-cover">
        {a.coverUrl ? <img src={a.coverUrl} alt="" loading="lazy" /> : <i>♪</i>}
        <span className="search-album-play">
          <IconPlay width={14} height={14} />
        </span>
      </span>
      <span className="search-album-title">{a.title}</span>
      <span className="search-album-sub">
        {[TYPE_LABEL[a.type ?? ''] ?? null, a.year].filter(Boolean).join(' · ') || 'альбом'}
      </span>
    </button>
  ))

  const loadMore = async () => {
    if (loadingMore || youtubeBusy) return
    setLoadingMore(true)
    let all = tracks
    try {
      // Даже если локальная выдача уже длинная, следующая страница YouTube
      // может содержать ещё треки. Поэтому не пропускаем запрос молча.
      if (hasMore) {
        const extra = await window.undertow.searchMore(lastQuery.current, ytOffset, 20)
        if (extra.length) {
          all = mergeTracks(all, extra, lastQuery.current)
          setTracks(all)
          setYtOffset(ytOffset + extra.length)
        }
        if (extra.length < 20) setHasMore(false)
      }
    } catch {
      /* сеть отвалилась — оставляем уже загруженные треки */
    } finally {
      setLoadingMore(false)
    }
    setVisibleCount((count) => count + 20)
  }

  return (
    <div className="scroll search-page">
      <div className="page-head">
        <div>
          <h1>Поиск</h1>
          <p>YouTube Music и SoundCloud: треки, альбомы, плейлисты и исполнители</p>
        </div>
        {busy && <span className="spinner" />}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault()
          void run(query)
        }}
        style={{ marginBottom: 22 }}
      >
        <label className="search-field">
          <IconSearch />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Трек, исполнитель, альбом…"
            spellCheck={false}
          />
          <span className="kbd">Enter</span>
        </label>
      </form>

      {history.length > 0 && (
        <div className="search-history">
          <div className="search-history-head">
            <span>Недавние запросы</span>
            <button
              className="search-history-clear"
              onClick={() => {
                setHistory([])
                localStorage.removeItem(HISTORY_KEY)
              }}
              title="Очистить историю поиска"
            >
              <IconX width={12} height={12} />
              Очистить
            </button>
          </div>
          <div className="search-history-row">
            {history.map((h) => (
              <button
                key={h}
                className="search-history-chip"
                onClick={() => {
                  setQuery(h)
                  void run(h)
                }}
              >
                {h}
              </button>
            ))}
          </div>
        </div>
      )}

      {youtubeBusy && !tracks.length && !albums.length && !artists.length && !playlists.length && (
        <div className="search-youtube-loading">
          <span className="spinner" /> Проверяю обычный YouTube…
        </div>
      )}

      {error && !scTracks.length && (
        <div className="empty">
          <b>Нет результатов</b>
          {error}
        </div>
      )}

      {!error && asked && (relevantTracks.length > 0 || albums.length > 0 || artists.length > 0 || playlists.length > 0 || scTracks.length > 0) && (
        <div className="tabs search-tabs">
          <button className={`tab${mode === 'all' ? ' on' : ''}`} onClick={() => setMode('all')}>
            Всё
          </button>
          {relevantTracks.length > 0 && (
            <button className={`tab${mode === 'tracks' ? ' on' : ''}`} onClick={() => setMode('tracks')}>
              Треки <span className="tab-count">{relevantTracks.length}</span>
            </button>
          )}
          {albums.length > 0 && (
            <button className={`tab${mode === 'albums' ? ' on' : ''}`} onClick={() => setMode('albums')}>
              Альбомы <span className="tab-count">{albums.length}</span>
            </button>
          )}
          {playlists.length > 0 && (
            <button
              className={`tab${mode === 'playlists' ? ' on' : ''}`}
              onClick={() => setMode('playlists')}
            >
              Плейлисты <span className="tab-count">{playlists.length}</span>
            </button>
          )}
          {artists.length > 0 && (
            <button className={`tab${mode === 'artists' ? ' on' : ''}`} onClick={() => setMode('artists')}>
              Исполнители <span className="tab-count">{artists.length}</span>
            </button>
          )}
          {scTracks.length > 0 && (
            <button
              className={`tab${mode === 'soundcloud' ? ' on' : ''}`}
              onClick={() => setMode('soundcloud')}
            >
              SoundCloud <span className="tab-count">{scTracks.length}</span>
            </button>
          )}
        </div>
      )}

      {!error && (mode === 'all' || mode === 'artists') && artists.length > 0 && (
        <section className="section fade-up search-artists">
          <div className="section-head">
            <h2>Исполнители</h2>
            <span className="count">{artists.length}</span>
          </div>
          <div className="search-artist-row">
            {artists.map((a) => (
              <button
                key={a.id}
                className="search-artist-card"
                onClick={() => onOpenArtist?.({ id: a.id, name: a.name })}
                title={`Открыть ${a.name}`}
              >
                <span className="search-artist-avatar">
                  {a.coverUrl ? <img src={a.coverUrl} alt="" loading="lazy" /> : <i>{a.name.slice(0, 1)}</i>}
                </span>
                <span className="search-artist-name">{a.name}</span>
              </button>
            ))}
          </div>
        </section>
      )}

      {!error && (mode === 'all' || mode === 'tracks') && relevantTracks.length > 0 && (
        <>
          {officialTracks.length > 0 && (
            <section className="section fade-up">
              <div className="section-head">
                <h2>Официальные</h2>
                {youtubeBusy && (
                  <span className="search-youtube-note">
                    <span className="spinner" /> ищу ещё на YouTube
                  </span>
                )}
                <span className="count">{officialTracks.length}</span>
              </div>
              <TrackList
                tracks={officialTracks}
                currentId={currentId}
                playing={playing}
                onPlay={onPlay}
                onToggle={onToggle}
                onLocked={() => undefined}
                likedIds={likedIds}
                onLike={onLike}
                onHover={onHover}
                onAddToQueue={onAddToQueue}
                onOpenArtist={onOpenArtist}
                onOpenAlbum={onOpenAlbum}
                onAddToPlaylist={onAddToPlaylist}
                onSimilar={onSimilar}
                playContext={visibleTracks}
                showSource
                showOfficial
              />
            </section>
          )}

          {uploadTracks.length > 0 && (
            <section className="section fade-up">
              <div className="section-head">
                <h2>{officialTracks.length > 0 ? 'Ремиксы и загрузки' : 'Треки'}</h2>
                {youtubeBusy && officialTracks.length === 0 && (
                  <span className="search-youtube-note">
                    <span className="spinner" /> ищу ещё на YouTube
                  </span>
                )}
                <span className="count">{uploadTracks.length}</span>
              </div>
              <TrackList
                tracks={uploadTracks}
                currentId={currentId}
                playing={playing}
                onPlay={onPlay}
                onToggle={onToggle}
                onLocked={() => undefined}
                likedIds={likedIds}
                onLike={onLike}
                onHover={onHover}
                onAddToQueue={onAddToQueue}
                onOpenArtist={onOpenArtist}
                onOpenAlbum={onOpenAlbum}
                onAddToPlaylist={onAddToPlaylist}
                onSimilar={onSimilar}
                playContext={visibleTracks}
                showSource
                showOfficial
              />
            </section>
          )}

          {(hasMore || relevantTracks.length > visibleCount) && (
            <button
              className="search-more"
              type="button"
              disabled={loadingMore || youtubeBusy}
              onClick={() => void loadMore()}
            >
              {loadingMore || youtubeBusy ? <span className="spinner" /> : null}
              {loadingMore ? 'Загружаю…' : youtubeBusy ? 'Ищу на YouTube…' : 'Показать ещё 20'}
            </button>
          )}
        </>
      )}

      {!error && (mode === 'all' || mode === 'soundcloud') && scTracks.length > 0 && (
        <section className="section fade-up sc-section">
          <div className="section-head">
            <h2>SoundCloud</h2>
            {scBusy ? (
              <span className="search-youtube-note">
                <span className="spinner" /> ищу на SoundCloud
              </span>
            ) : null}
            <span className="count">{scTracks.length}</span>
            {mode === 'all' && scTracks.length > scShown.length ? (
              <button className="link-btn" onClick={() => setMode('soundcloud')}>
                Все {scTracks.length}
              </button>
            ) : null}
          </div>
          <div className="sc-list">
            {scShown.map((t) => {
              const on = currentId === t.id
              return (
                <button
                  key={t.id}
                  className={`sc-row${on ? ' on' : ''}`}
                  onClick={() => (on ? onToggle() : onPlay(t, scTracks))}
                  onMouseEnter={() => onHover?.(t)}
                  title={`${t.artist} — ${t.title}`}
                >
                  {t.coverUrl ? (
                    <img className="sc-cover" src={t.coverUrl} alt="" loading="lazy" />
                  ) : (
                    <span className="sc-cover sc-cover-empty">SC</span>
                  )}
                  <span className="sc-names">
                    <b>{t.title}</b>
                    <i>{t.artist}</i>
                  </span>
                  <span className="sc-badge">SC</span>
                  <span className="sc-duration">
                    {t.durationSec ? `${Math.floor(t.durationSec / 60)}:${String(t.durationSec % 60).padStart(2, '0')}` : ''}
                  </span>
                  <span className="sc-play">
                    {on && playing ? <IconPause width={13} height={13} /> : <IconPlay width={13} height={13} />}
                  </span>
                </button>
              )
            })}
          </div>
          {mode === 'soundcloud' && scHasMore && (
            <button
              className="search-more sc-more"
              type="button"
              disabled={scMoreBusy}
              onClick={() => void loadMoreSoundcloud()}
            >
              {scMoreBusy ? <span className="spinner" /> : null}
              {scMoreBusy ? 'Загружаю…' : 'Показать ещё 20'}
            </button>
          )}
        </section>
      )}

      {!error && (mode === 'all' || mode === 'albums') && albums.length > 0 && (
        <section className="section fade-up search-albums">
          <div className="section-head">
            <h2>Альбомы и синглы</h2>
            {mode === 'all' && albums.length > 6 && (
              <button className="search-section-all" onClick={() => setMode('albums')}>
                Все {albums.length}
              </button>
            )}
            <span className="count">{albums.length}</span>
          </div>
          <div className={mode === 'all' ? 'search-shelf-row' : 'search-album-grid'}>
            {mode === 'all' ? albumCards.slice(0, 6) : albumCards}
          </div>
        </section>
      )}

      {!error && (mode === 'all' || mode === 'playlists') && playlists.length > 0 && (
        <section className="section fade-up search-playlists">
          <div className="section-head">
            <h2>Плейлисты</h2>
            {mode === 'all' && playlists.length > 6 && (
              <button className="search-section-all" onClick={() => setMode('playlists')}>
                Все {playlists.length}
              </button>
            )}
            <span className="count">{playlists.length}</span>
          </div>
          <div className={mode === 'all' ? 'search-shelf-row' : 'search-album-grid'}>
            {mode === 'all' ? playlistCards.slice(0, 6) : playlistCards}
          </div>
        </section>
      )}
    </div>
  )
}
