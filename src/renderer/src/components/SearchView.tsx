import { useEffect, useRef, useState } from 'react'
import type { Track } from '../types'
import TrackList from './TrackList'
import { IconSearch } from './Icons'

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
  onAddToQueue?: (track: Track) => void
}

const SUGGESTIONS = ['Molchat Doma', 'Tame Impala', 'новинки 2026', 'phonk', 'Radiohead', 'Кино']

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
  onOpenAlbum
}: Props) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Track[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const lastQuery = useRef('')

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const run = async (q: string) => {
    const term = q.trim()
    if (!term || busy) return
    setBusy(true)
    setError(null)
    lastQuery.current = term
    try {
      const found = await window.undertow.search(term)
      setResults(found)
      if (!found.length) setError('Ничего не нашлось — попробуй сформулировать иначе.')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setResults([])
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="scroll">
      <div className="page-head">
        <div>
          <h1>Поиск</h1>
          <p>Ищет по всему YouTube — включая то, чего нет в подписках</p>
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

      {!results.length && !busy && !error && (
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

      {results.length > 0 && (
        <section className="section fade-up">
          <div className="section-head">
            <h2>{lastQuery.current}</h2>
            <span className="count">{results.length} треков</span>
          </div>
          <TrackList
            tracks={results}
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
            showSource={new Set(results.map((r) => r.provider)).size > 1}
          />
        </section>
      )}
    </div>
  )
}
