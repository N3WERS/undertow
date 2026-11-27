import { useEffect, useMemo, useRef, useState } from 'react'
import {
  IconDownload,
  IconLibrary,
  IconList,
  IconNext,
  IconPause,
  IconPlay,
  IconPrev,
  IconSearch,
  IconSettings,
  IconSpark,
  IconWave,
  IconX
} from './Icons'
import type { PlaylistSummary, Section, Track } from '../types'
import type { View } from './Sidebar'

type Kind = 'track' | 'artist' | 'album' | 'playlist' | 'action'

interface Item {
  id: string
  kind: Kind
  title: string
  sub?: string
  meta?: string
  icon: typeof IconSearch
  run: () => void
}

interface Props {
  open: boolean
  mode: 'all' | 'library'
  onClose: () => void
  onNavigate: (view: View) => void
  onPlay: (track: Track, list: Track[]) => void
  onArtist: (name: string) => void
  onAlbum: (album: { title: string; artist?: string }) => void
  onPlaylist: (id: string, title: string) => void
  onToggle: () => void
  onNext: () => void
  onPrev: () => void
  onMini: () => void
}

const norm = (value: string): string =>
  value
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/\s+/g, ' ')
    .trim()

function score(text: string, query: string): number {
  if (!query) return 1
  const hay = norm(text)
  if (hay === query) return 4
  if (hay.startsWith(query)) return 3
  if (hay.includes(` ${query}`)) return 2
  if (hay.includes(query)) return 1
  return 0
}

function uniqueTracks(list: Track[]): Track[] {
  const seen = new Set<string>()
  const out: Track[] = []
  for (const track of list) {
    if (!track?.id || seen.has(track.id)) continue
    seen.add(track.id)
    out.push(track)
  }
  return out
}

export default function CommandPalette({
  open,
  mode,
  onClose,
  onNavigate,
  onPlay,
  onArtist,
  onAlbum,
  onPlaylist,
  onToggle,
  onNext,
  onPrev,
  onMini
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const [tracks, setTracks] = useState<Track[]>([])
  const [playlists, setPlaylists] = useState<PlaylistSummary[]>([])
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    if (!open) return
    setQuery('')
    setActive(0)
    const timer = setTimeout(() => inputRef.current?.focus(), 30)
    return () => clearTimeout(timer)
  }, [open, mode])

  useEffect(() => {
    if (!open || loaded) return
    let alive = true
    void Promise.allSettled([
      window.undertow.library(),
      window.undertow.playlists(),
      window.undertow.offlineList(),
      window.undertow.queueGet(),
      window.undertow.home()
    ]).then((results) => {
      if (!alive) return
      const lib = results[0].status === 'fulfilled' ? results[0].value : null
      const lists = results[1].status === 'fulfilled' ? results[1].value : []
      const offline = results[2].status === 'fulfilled' ? results[2].value : null
      const queue = results[3].status === 'fulfilled' ? results[3].value : null
      const home = results[4].status === 'fulfilled' ? results[4].value : []
      const homeTracks = (home as Section[]).flatMap((section) => section.items ?? [])
      setTracks(
        uniqueTracks([
          ...(lib?.likes ?? []),
          ...(lib?.history ?? []),
          ...(offline?.items.map((entry) => entry.track) ?? []),
          ...(queue?.tracks ?? []),
          ...homeTracks
        ])
      )
      setPlaylists(lists)
      setLoaded(true)
    })
    return () => {
      alive = false
    }
  }, [open, loaded])

  const q = norm(query)

  const items = useMemo<Item[]>(() => {
    const actions: Item[] = [
      {
        id: 'view:flow',
        kind: 'action',
        title: 'Открыть Течение',
        sub: 'Бесконечный поток по библиотеке',
        meta: 'раздел',
        icon: IconWave,
        run: () => onNavigate('flow')
      },
      {
        id: 'view:search',
        kind: 'action',
        title: 'Поиск по каталогу',
        sub: 'YouTube Music и SoundCloud',
        meta: 'раздел',
        icon: IconSearch,
        run: () => onNavigate('search')
      },
      {
        id: 'view:library',
        kind: 'action',
        title: 'Открыть библиотеку',
        sub: 'Лайки, история и сохранённые альбомы',
        meta: 'раздел',
        icon: IconLibrary,
        run: () => onNavigate('library')
      },
      {
        id: 'view:playlists',
        kind: 'action',
        title: 'Открыть плейлисты',
        sub: 'Свои коллекции',
        meta: 'раздел',
        icon: IconList,
        run: () => onNavigate('playlists')
      },
      {
        id: 'view:releases',
        kind: 'action',
        title: 'Открыть новинки',
        sub: 'Релизы любимых артистов',
        meta: 'раздел',
        icon: IconSpark,
        run: () => onNavigate('releases')
      },
      {
        id: 'view:saved',
        kind: 'action',
        title: 'Открыть сохранённые',
        sub: 'Скачанные треки и офлайн',
        meta: 'раздел',
        icon: IconDownload,
        run: () => onNavigate('saved')
      },
      {
        id: 'view:settings',
        kind: 'action',
        title: 'Настройки',
        sub: 'Источники, звук, обновления и система',
        meta: 'раздел',
        icon: IconSettings,
        run: () => onNavigate('settings')
      },
      {
        id: 'player:toggle',
        kind: 'action',
        title: 'Пауза / продолжить',
        sub: 'Пробел',
        meta: 'плеер',
        icon: IconPause,
        run: onToggle
      },
      {
        id: 'player:next',
        kind: 'action',
        title: 'Следующий трек',
        sub: 'Alt + →',
        meta: 'плеер',
        icon: IconNext,
        run: onNext
      },
      {
        id: 'player:prev',
        kind: 'action',
        title: 'Предыдущий трек',
        sub: 'Alt + ←',
        meta: 'плеер',
        icon: IconPrev,
        run: onPrev
      },
      {
        id: 'view:mini',
        kind: 'action',
        title: 'Мини-плеер',
        sub: 'Компактное окно поверх других',
        meta: 'система',
        icon: IconPlay,
        run: onMini
      }
    ]

    const actionItems =
      mode === 'library'
        ? actions.filter((action) => ['view:library', 'view:playlists', 'view:saved'].includes(action.id))
        : actions
    const actionHits = q
      ? actionItems.filter((item) => score(`${item.title} ${item.sub ?? ''}`, q) > 0)
      : mode === 'library'
        ? []
        : actionItems.slice(0, 5)

    const trackHits = tracks
      .map((track) => ({ track, s: score(`${track.title} ${track.artist} ${track.album ?? ''}`, q) }))
      .filter((entry) => entry.s > 0)
      .sort((a, b) => b.s - a.s || a.track.title.localeCompare(b.track.title))
      .slice(0, q ? 8 : 5)
      .map<Item>(({ track }) => ({
        id: `track:${track.id}`,
        kind: 'track',
        title: track.title,
        sub: [track.artist, track.album].filter(Boolean).join(' · '),
        meta: track.durationSec
          ? `${Math.floor(track.durationSec / 60)}:${String(track.durationSec % 60).padStart(2, '0')}`
          : 'трек',
        icon: IconPlay,
        run: () => onPlay(track, tracks)
      }))

    const artists = new Map<string, string>()
    for (const track of tracks) {
      const name = track.artist?.trim()
      if (name) artists.set(norm(name), name)
    }
    const artistHits = [...artists.entries()]
      .map(([key, name]) => ({ name, s: score(key, q) }))
      .filter((entry) => entry.s > 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, q ? 5 : 0)
      .map<Item>(({ name }) => ({
        id: `artist:${name}`,
        kind: 'artist',
        title: name,
        sub: 'Исполнитель',
        meta: 'артист',
        icon: IconWave,
        run: () => onArtist(name)
      }))

    const albums = new Map<string, { title: string; artist?: string }>()
    for (const track of tracks) {
      if (!track.album) continue
      albums.set(norm(`${track.album}|${track.artist}`), { title: track.album, artist: track.artist })
    }
    const albumHits = [...albums.entries()]
      .map(([key, album]) => ({ album, s: score(key.replace('|', ' '), q) }))
      .filter((entry) => entry.s > 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, q ? 4 : 0)
      .map<Item>(({ album }) => ({
        id: `album:${album.title}:${album.artist ?? ''}`,
        kind: 'album',
        title: album.title,
        sub: album.artist,
        meta: 'альбом',
        icon: IconLibrary,
        run: () => onAlbum(album)
      }))

    const playlistHits = playlists
      .map((playlist) => ({
        playlist,
        s: score(`${playlist.title} ${playlist.count ?? ''}`, q)
      }))
      .filter((entry) => entry.s > 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, q ? 5 : 0)
      .map<Item>(({ playlist }) => ({
        id: `playlist:${playlist.id}`,
        kind: 'playlist',
        title: playlist.title,
        sub: `${playlist.count} ${playlist.count === 1 ? 'трек' : 'треков'}`,
        meta: 'плейлист',
        icon: IconList,
        run: () => onPlaylist(playlist.id, playlist.title)
      }))

    if (mode === 'library') return [...trackHits, ...artistHits, ...albumHits, ...actionHits]
    return [...actionHits, ...trackHits, ...artistHits, ...albumHits, ...playlistHits]
  }, [q, tracks, playlists, mode, onNavigate, onPlay, onArtist, onAlbum, onPlaylist, onToggle, onNext, onPrev, onMini])

  useEffect(() => setActive(0), [q, mode])

  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)
    el?.scrollIntoView({ block: 'nearest' })
  }, [active])

  if (!open) return null

  const groups: { label: string; kind: Kind }[] =
    mode === 'library'
      ? [
          { label: 'Треки', kind: 'track' },
          { label: 'Артисты', kind: 'artist' },
          { label: 'Альбомы', kind: 'album' },
          { label: 'Действия', kind: 'action' }
        ]
      : [
          { label: 'Действия и разделы', kind: 'action' },
          { label: 'Треки', kind: 'track' },
          { label: 'Артисты', kind: 'artist' },
          { label: 'Альбомы', kind: 'album' },
          { label: 'Плейлисты', kind: 'playlist' }
        ]

  const run = (item: Item) => {
    onClose()
    // даём окну закрыться, чтобы действие не спорило с фокусом
    setTimeout(item.run, 0)
  }

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActive((value) => (items.length ? (value + 1) % items.length : 0))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActive((value) => (items.length ? (value - 1 + items.length) % items.length : 0))
    } else if (event.key === 'Enter') {
      event.preventDefault()
      const item = items[active]
      if (item) run(item)
    } else if (event.key === 'Escape') {
      event.preventDefault()
      onClose()
    }
  }

  let flatIndex = -1

  return (
    <div className="palette-backdrop" onMouseDown={onClose}>
      <div
        className="palette"
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="palette-search">
          <IconSearch width={17} height={17} />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onKeyDown}
            placeholder={mode === 'library' ? 'Поиск в библиотеке…' : 'Трек, артист, альбом или действие…'}
            aria-label="Поиск"
          />
          <kbd>Esc</kbd>
        </div>

        <div className="palette-list" ref={listRef}>
          {items.length === 0 && (
            <div className="palette-empty">
              {loaded ? 'Ничего не нашлось. Попробуйте другое название.' : 'Загружаю библиотеку…'}
            </div>
          )}
          {groups.map((group) => {
            const groupItems = items.filter((item) => item.kind === group.kind)
            if (!groupItems.length) return null
            return (
              <div className="palette-group" key={group.kind}>
                <div className="palette-group-label">{group.label}</div>
                {groupItems.map((item) => {
                  flatIndex += 1
                  const index = flatIndex
                  const Icon = item.icon
                  return (
                    <button
                      key={item.id}
                      data-index={index}
                      className={`palette-item${index === active ? ' active' : ''}`}
                      onMouseEnter={() => setActive(index)}
                      onClick={() => run(item)}
                    >
                      <span className={`palette-icon ${item.kind}`}>
                        <Icon width={15} height={15} />
                      </span>
                      <span className="palette-copy">
                        <b>{item.title}</b>
                        {item.sub ? <em>{item.sub}</em> : null}
                      </span>
                      <span className="palette-meta">{item.meta}</span>
                    </button>
                  )
                })}
              </div>
            )
          })}
        </div>

        <div className="palette-foot">
          <span>
            <kbd>↑</kbd>
            <kbd>↓</kbd> выбор
          </span>
          <span>
            <kbd>Enter</kbd> открыть
          </span>
          <span>
            <kbd>Esc</kbd> закрыть
          </span>
          <span className="palette-foot-right">
            <IconX width={11} height={11} /> {mode === 'library' ? 'библиотека' : 'всё приложение'}
          </span>
        </div>
      </div>
    </div>
  )
}
