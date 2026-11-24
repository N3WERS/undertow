import { useEffect, useRef, useState } from 'react'
import type { AlbumRef, ArtistRef, Track } from '../types'
import TrackList from './TrackList'
import { IconPlay, IconSearch } from './Icons'

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
  onAddToPlaylist?: (track: Track) => void
  onSimilar?: (track: Track) => void
  onAddToQueue?: (track: Track) => void
}

const SUGGESTIONS = ['Molchat Doma', 'Tame Impala', 'новинки 2026', 'phonk', 'Radiohead', 'Кино']

const TYPE_LABEL: Record<string, string> = { single: 'сингл', ep: 'EP', album: 'альбом' }

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
  onAddToPlaylist,
  onSimilar
}: Props) {
  const [query, setQuery] = useState('')
  const [tracks, setTracks] = useState<Track[]>([])
  const [albums, setAlbums] = useState<AlbumRef[]>([])
  const [artists, setArtists] = useState<ArtistRef[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const lastQuery = useRef('')
  const [asked, setAsked] = useState(false)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const run = async (q: string) => {
    const term = q.trim()
    if (!term || busy) return
    setBusy(true)
    setError(null)
    setAsked(true)
    lastQuery.current = term
    try {
      const found = await window.undertow.searchAll(term)
      setTracks(found.tracks)
      setAlbums(found.albums)
      setArtists(found.artists)
      if (!found.tracks.length && !found.albums.length && !found.artists.length) {
        setError('Ничего не нашлось — попробуй сформулировать иначе.')
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setTracks([])
      setAlbums([])
      setArtists([])
    } finally {
      setBusy(false)
    }
  }

  const empty = !tracks.length && !albums.length && !artists.length

  return (
    <div className="scroll search-page">
      <div className="page-head">
        <div>
          <h1>Поиск</h1>
          <p>YouTube Music и Яндекс: треки, альбомы и исполнители</p>
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

      {error && (
        <div className="empty">
          <b>Нет результатов</b>
          {error}
        </div>
      )}

      {!error && artists.length > 0 && (
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

      {!error && albums.length > 0 && (
        <section className="section fade-up search-albums">
          <div className="section-head">
            <h2>Альбомы и синглы</h2>
            <span className="count">{albums.length}</span>
          </div>
          <div className="search-album-grid">
            {albums.map((a) => (
              <button
                key={a.id}
                className="search-album-card"
                onClick={() =>
                  onOpenAlbum?.({ id: `yt-album:${a.id}`, title: a.title, artist: undefined })
                }
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
            ))}
          </div>
        </section>
      )}

      {!error && tracks.length > 0 && (
        <section className="section fade-up">
          <div className="section-head">
            <h2>Треки</h2>
            <span className="count">{tracks.length}</span>
          </div>
          <TrackList
            tracks={tracks}
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
            showSource={new Set(tracks.map((r) => r.provider)).size > 1}
          />
        </section>
      )}
    </div>
  )
}
