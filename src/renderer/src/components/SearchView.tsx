import { useEffect, useRef, useState } from 'react'
import type { AlbumRef, ArtistRef, PlaylistRef, Track } from '../types'
import TrackList from './TrackList'
import { IconPlay, IconQueue, IconSearch, IconX } from './Icons'

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


function normSearch(value: string): string {
  return value
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

function stripVersion(title: string): string {
  return title.replace(/\([^)]*\)|\[[^]]*]/g, ' ').trim()
}

function queryShape(term: string): { parts: string[]; tokens: string[] } {
  const normalized = normSearch(term)
  const parts = term
    .split(/\s+[-–—]\s+/)
    .map(normSearch)
    .filter(Boolean)
  const tokens = normalized.split(' ').filter((t) => t.length > 1 || /\d/.test(t))
  return { parts, tokens }
}

function trackScore(track: Track, term: string): number {
  const q = queryShape(term)
  const artist = normSearch(track.artist)
  const title = normSearch(stripVersion(track.title))
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
  if (title === normSearch(term)) score += 30
  return score
}

function mergeTracks(base: Track[], extra: Track[], term: string): Track[] {
  const seenIds = new Set<string>()
  const seenTracks = new Set<string>()
  const ranked: { track: Track; score: number; order: number }[] = []
  const q = queryShape(term)
  const isStrong = (track: Track): boolean => {
    const hay = normSearch(`${track.artist} ${stripVersion(track.title)}`)
    if (q.parts.length >= 2) return q.parts.every((part) => hay.includes(part))
    return q.tokens.every((token) => hay.includes(token))
  }
  // Если YouTube Music нашёл только «что-то по слову», доверяем порядку
  // обычного YouTube: там каверы и пользовательские загрузки релевантнее.
  const ordered = base.some(isStrong) ? [...base, ...extra] : [...extra, ...base]
  for (const track of ordered) {
    const key = `${normSearch(stripVersion(track.title))}|${normSearch(track.artist)}`
    if (seenIds.has(track.id) || seenTracks.has(key)) continue
    seenIds.add(track.id)
    seenTracks.add(key)
    ranked.push({ track, score: trackScore(track, term), order: ranked.length })
  }
  ranked.sort((a, b) => b.score - a.score || a.order - b.order)
  return ranked.map((x) => x.track)
}

const SUGGESTIONS = ['Molchat Doma', 'Tame Impala', 'новинки 2026', 'phonk', 'Radiohead', 'Кино']

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
  const [mode, setMode] = useState<'all' | 'tracks' | 'albums' | 'playlists' | 'artists'>('all')
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
    if (!term || busy) return
    const seq = ++searchSeq.current
    setBusy(true)
    setError(null)
    setAsked(true)
    lastQuery.current = term
    setVisibleCount(20)
    setHasMore(true)
    setYtOffset(0)
    setYoutubeBusy(false)
    setMode('all')
    remember(term)
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

  const visibleTracks = tracks.slice(0, visibleCount)
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
    const target = visibleCount + 20
    let all = tracks
    let extraCount = 0
    const fetchNeeded = all.length < target
    try {
      if (fetchNeeded) {
        const extra = await window.undertow.searchMore(lastQuery.current, ytOffset, 20)
        extraCount = extra.length
        if (extra.length) {
          all = mergeTracks(all, extra, lastQuery.current)
          setTracks(all)
          setYtOffset(ytOffset + extra.length)
        }
      }
    } catch {
      /* сеть отвалилась — оставляем уже загруженные треки */
    } finally {
      setLoadingMore(false)
    }
    const nextVisible = Math.min(target, all.length)
    setVisibleCount(nextVisible)
    setHasMore(fetchNeeded ? all.length > nextVisible || extraCount > 0 : true)
  }

  return (
    <div className="scroll search-page">
      <div className="page-head">
        <div>
          <h1>Поиск</h1>
          <p>YouTube Music: треки, альбомы, плейлисты и исполнители</p>
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

      {!asked && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              className="play-btn ghost"
              style={{ height: 32, padding: '0 14px', fontSize: 12.5 }}
              onClick={() => {
                setQuery(s)
                void run(s)
              }}
            >
              {s}
            </button>
          ))}
        </div>
      )}

      {youtubeBusy && !tracks.length && !albums.length && !artists.length && !playlists.length && (
        <div className="search-youtube-loading">
          <span className="spinner" /> Проверяю обычный YouTube…
        </div>
      )}

      {error && (
        <div className="empty">
          <b>Нет результатов</b>
          {error}
        </div>
      )}

      {!error && asked && (tracks.length > 0 || albums.length > 0 || artists.length > 0 || playlists.length > 0) && (
        <div className="tabs search-tabs">
          <button className={`tab${mode === 'all' ? ' on' : ''}`} onClick={() => setMode('all')}>
            Всё
          </button>
          {tracks.length > 0 && (
            <button className={`tab${mode === 'tracks' ? ' on' : ''}`} onClick={() => setMode('tracks')}>
              Треки <span className="tab-count">{tracks.length}</span>
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

      {!error && (mode === 'all' || mode === 'tracks') && tracks.length > 0 && (
        <section className="section fade-up">
          <div className="section-head">
            <h2>Треки</h2>
            {youtubeBusy && (
              <span className="search-youtube-note">
                <span className="spinner" /> ищу ещё на YouTube
              </span>
            )}
            <span className="count">{visibleTracks.length}</span>
          </div>
          <TrackList
            tracks={visibleTracks}
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
            showSource={new Set(visibleTracks.map((r) => r.provider)).size > 1}
          />
          {(hasMore || tracks.length > visibleCount) && (
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
