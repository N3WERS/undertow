import { useEffect, useMemo, useState } from 'react'
import type { SavedAlbum, Track } from '../types'
import TrackList from './TrackList'
import { enqueueDownloads } from '../downloads'
import { IconPlay, IconSearch, IconX } from './Icons'

interface Props {
  likes: Track[]
  history: Track[]
  albums: SavedAlbum[]
  likedIds: Set<string>
  currentId: string | null
  playing: boolean
  canImport: boolean
  importing: boolean
  yandexActive: boolean
  onPlay: (track: Track, list: Track[]) => void
  onToggle: () => void
  onLike: (track: Track) => void
  onLocked: (track: Track) => void
  onImport: () => void
  onClearHistory: () => void
  onHover?: (track: Track) => void
  onOpenArtist?: (target: { id?: string; name: string }) => void
  onOpenAlbum?: (target: { id?: string; title: string; artist?: string; trackTitle?: string }) => void
  onAddToPlaylist?: (track: Track) => void
  onSimilar?: (track: Track) => void
  onAddToQueue?: (track: Track) => void
  onPlayAlbum: (album: SavedAlbum) => void
  onRemoveAlbum: (album: SavedAlbum) => void
  onToast: (text: string, kind?: 'info' | 'error') => void
}

type Tab = 'likes' | 'albums' | 'history'
type Sort = 'default' | 'title' | 'artist' | 'album' | 'duration'

const norm = (value: string): string => value.toLowerCase().replace(/ё/g, 'е').trim()

function sortTracks(list: Track[], sort: Sort): Track[] {
  if (sort === 'default') return list
  const collator = new Intl.Collator('ru', { sensitivity: 'base' })
  const value = (track: Track): string | number => {
    if (sort === 'duration') return track.durationSec ?? 0
    if (sort === 'title') return track.title
    if (sort === 'artist') return track.artist
    return track.album ?? ''
  }
  return [...list].sort((a, b) => {
    const av = value(a)
    const bv = value(b)
    if (typeof av === 'number' && typeof bv === 'number') return av - bv
    return collator.compare(String(av), String(bv))
  })
}

const albumWord = (n: number): string => {
  const mod100 = n % 100
  const mod10 = n % 10
  if (mod100 >= 11 && mod100 <= 14) return 'альбомов'
  if (mod10 === 1) return 'альбом'
  if (mod10 >= 2 && mod10 <= 4) return 'альбома'
  return 'альбомов'
}

export default function LibraryView(p: Props) {
  const [tab, setTab] = useState<Tab>('likes')
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<Sort>('default')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [selecting, setSelecting] = useState(false)
  const [anchor, setAnchor] = useState<string | null>(null)
  const [confirmDupes, setConfirmDupes] = useState(false)

  const source = tab === 'likes' ? p.likes : p.history
  const filtered = useMemo(() => {
    const q = norm(query)
    const result = q
      ? source.filter((track) => norm(`${track.title} ${track.artist} ${track.album ?? ''}`).includes(q))
      : source
    return sortTracks(result, sort)
  }, [source, query, sort])

  useEffect(() => {
    setSelected(new Set())
    setAnchor(null)
    setConfirmDupes(false)
    if (tab === 'albums') setSelecting(false)
  }, [tab, query, sort])

  useEffect(() => {
    if (!selecting) setSelected(new Set())
  }, [selecting])

  const selectedTracks = useMemo(
    () => source.filter((track) => selected.has(track.id)),
    [source, selected]
  )

  const duplicates = useMemo(() => {
    if (tab !== 'likes') return []
    const groups = new Map<string, Track[]>()
    for (const track of p.likes) {
      const key = `${norm(track.title)}|${norm(track.artist)}`
      const group = groups.get(key)
      if (group) group.push(track)
      else groups.set(key, [track])
    }
    return [...groups.values()].flatMap((group) => group.slice(1))
  }, [p.likes, tab])

  const albums = useMemo(() => {
    const q = norm(query)
    if (!q) return p.albums
    return p.albums.filter((album) => norm(`${album.title} ${album.artist}`).includes(q))
  }, [p.albums, query])

  const select = (track: Track, shiftKey: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (shiftKey && anchor) {
        const from = filtered.findIndex((item) => item.id === anchor)
        const to = filtered.findIndex((item) => item.id === track.id)
        if (from >= 0 && to >= 0) {
          for (let i = Math.min(from, to); i <= Math.max(from, to); i += 1) next.add(filtered[i].id)
          return next
        }
      }
      if (next.has(track.id)) next.delete(track.id)
      else next.add(track.id)
      return next
    })
    setAnchor(track.id)
  }

  return (
    <div className="scroll">
      <div className="page-head">
        <div>
          <h1>Библиотека</h1>
          <p>
            {p.likes.length} в «Мне нравится» · {p.albums.length} {albumWord(p.albums.length)} · {p.history.length} в
            истории
          </p>
        </div>
        <div className="head-actions">
          {p.canImport && (
            <button className="play-btn ghost" onClick={p.onImport} disabled={p.importing}>
              {p.importing ? <span className="spinner" /> : null}
              {p.importing ? 'Импортирую…' : 'Импортировать лайки из Яндекса'}
            </button>
          )}
          {tab === 'likes' && p.likes.length > 0 && (
            <button className="play-btn" onClick={() => filtered[0] && p.onPlay(filtered[0], filtered)}>
              Слушать всё
            </button>
          )}
          {tab === 'history' && p.history.length > 0 && (
            <button className="link-btn" onClick={p.onClearHistory}>
              Очистить историю
            </button>
          )}
        </div>
      </div>

      {!p.yandexActive && p.likes.some((t) => t.provider === 'yandex') && (
        <div className="notice">
          Яндекс отключён — его треки в библиотеке будут играть найденными копиями с YouTube (первый запуск трека ищет
          пару 2–3 секунды, дальше запоминается).
        </div>
      )}

      <div className="tabs">
        <button className={`tab${tab === 'likes' ? ' on' : ''}`} onClick={() => setTab('likes')}>
          Мне нравится
          <span className="tab-count">{p.likes.length}</span>
        </button>
        <button className={`tab${tab === 'albums' ? ' on' : ''}`} onClick={() => setTab('albums')}>
          Альбомы
          <span className="tab-count">{p.albums.length}</span>
        </button>
        <button className={`tab${tab === 'history' ? ' on' : ''}`} onClick={() => setTab('history')}>
          История
          <span className="tab-count">{p.history.length}</span>
        </button>
      </div>

      <div className="library-tools">
        <label className="library-search">
          <IconSearch width={14} height={14} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Поиск по библиотеке…"
            aria-label="Поиск по библиотеке"
          />
          {query ? (
            <button className="library-search-clear" onClick={() => setQuery('')} aria-label="Очистить поиск">
              <IconX width={12} height={12} />
            </button>
          ) : null}
        </label>

        {tab !== 'albums' ? (
          <select
            className="library-sort"
            value={sort}
            onChange={(event) => setSort(event.target.value as Sort)}
            aria-label="Сортировка"
          >
            <option value="default">Как добавлено</option>
            <option value="title">По названию</option>
            <option value="artist">По артисту</option>
            <option value="album">По альбому</option>
            <option value="duration">По длительности</option>
          </select>
        ) : null}

        {tab !== 'albums' ? (
          <button
            className={`library-select${selecting ? ' on' : ''}`}
            onClick={() => setSelecting((value) => !value)}
            aria-pressed={selecting}
          >
            {selecting ? 'Готово' : 'Выбрать'}
          </button>
        ) : null}

        {tab === 'likes' && duplicates.length > 0 ? (
          <button
            className={`library-dupes${confirmDupes ? ' confirm' : ''}`}
            onClick={() => {
              if (!confirmDupes) {
                setConfirmDupes(true)
                return
              }
              for (const track of duplicates) p.onLike(track)
              p.onToast(`Убрал дублей: ${duplicates.length}`)
              setConfirmDupes(false)
            }}
            onBlur={() => setConfirmDupes(false)}
            title="Убрать повторяющиеся треки, оставив первый"
          >
            {confirmDupes ? `Подтвердить: убрать ${duplicates.length}` : `Дубли: ${duplicates.length}`}
          </button>
        ) : null}

        {selected.size > 0 ? (
          <div className="library-selection">
            <b>{selected.size} выбрано</b>
            <button
              onClick={() => {
                const allLiked = selectedTracks.every((track) => p.likedIds.has(track.id))
                for (const track of selectedTracks) {
                  if (allLiked || !p.likedIds.has(track.id)) p.onLike(track)
                }
                p.onToast(allLiked ? 'Убрал из «Мне нравится»' : 'Добавил в «Мне нравится»')
              }}
            >
              {selectedTracks.every((track) => p.likedIds.has(track.id)) ? 'Убрать лайки' : 'В лайки'}
            </button>
            <button
              onClick={() => {
                for (const track of selectedTracks) p.onAddToQueue?.(track)
                p.onToast(`В очередь: ${selectedTracks.length}`)
              }}
            >
              В очередь
            </button>
            <button
              onClick={() => {
                void enqueueDownloads(selectedTracks.filter((track) => track.playable))
                p.onToast(`Сохраняю локально: ${selectedTracks.length}`)
              }}
            >
              Скачать
            </button>
            <button className="library-selection-clear" onClick={() => setSelected(new Set())}>
              Снять
            </button>
          </div>
        ) : null}
      </div>

      {selecting && selected.size === 0 ? (
        <div className="library-select-hint">Нажмите на треки, чтобы выбрать их. Повторное нажатие снимает выбор.</div>
      ) : null}

      {tab === 'albums' ? (
        albums.length === 0 ? (
          <div className="empty">
            <b>Пока нет сохранённых альбомов</b>
            Открой страницу альбома и нажми «Сохранить альбом» — он появится здесь для быстрого доступа.
          </div>
        ) : (
          <div className="saved-albums">
            {albums.map((a) => (
              <div className="saved-album-card" key={a.id}>
                <button
                  className="saved-album-open"
                  onClick={() => p.onOpenAlbum?.({ id: a.id, title: a.title, artist: a.artist })}
                  title={`Открыть альбом: ${a.title}`}
                >
                  <span className="saved-album-cover">
                    {a.coverUrl ? <img src={a.coverUrl} alt="" loading="lazy" /> : null}
                  </span>
                  <span className="saved-album-title">{a.title}</span>
                  <span className="saved-album-sub">
                    {a.artist}
                    {a.year ? ` · ${a.year}` : ''}
                  </span>
                </button>
                <div className="saved-album-actions">
                  <button
                    className="saved-album-action play"
                    title="Слушать альбом"
                    onClick={() => p.onPlayAlbum(a)}
                  >
                    <IconPlay width={14} height={14} />
                  </button>
                  <button
                    className="saved-album-action remove"
                    title="Убрать альбом из библиотеки"
                    onClick={() => p.onRemoveAlbum(a)}
                  >
                    <IconX width={13} height={13} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )
      ) : filtered.length === 0 ? (
        <div className="empty">
          <b>{tab === 'likes' ? 'Пока пусто' : 'Ещё ничего не слушал'}</b>
          {tab === 'likes'
            ? p.canImport
              ? 'Нажми «Импортировать лайки из Яндекса» — подтянется всё, что ты лайкал там, или ставь сердечки прямо в списках.'
              : 'Ставь сердечки на треках — они появятся здесь. При подключённом Яндексе лайки уходят и в его библиотеку.'
            : 'История собирается сама: всё, что играло, попадает сюда.'}
        </div>
      ) : (
        <TrackList
          tracks={filtered}
          currentId={p.currentId}
          playing={p.playing}
          onPlay={p.onPlay}
          onToggle={p.onToggle}
          onLocked={p.onLocked}
          likedIds={p.likedIds}
          onLike={p.onLike}
          onHover={p.onHover}
          onAddToQueue={p.onAddToQueue}
          onOpenArtist={p.onOpenArtist}
          onOpenAlbum={p.onOpenAlbum}
          onAddToPlaylist={p.onAddToPlaylist}
          onSimilar={p.onSimilar}
          selection={selecting ? selected : undefined}
          onSelect={selecting ? select : undefined}
          showSource
        />
      )}
    </div>
  )
}
