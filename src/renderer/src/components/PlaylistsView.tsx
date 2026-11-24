import { useCallback, useEffect, useState } from 'react'
import type { Playlist, PlaylistSummary, Track } from '../types'
import TrackList from './TrackList'
import { IconPlay, IconX } from './Icons'

interface Props {
  canImport: boolean
  currentId: string | null
  playing: boolean
  likedIds?: Set<string>
  onPlay: (track: Track, list: Track[]) => void
  onToggle: () => void
  onLike?: (track: Track) => void
  onHover?: (track: Track) => void
  onAddToQueue?: (track: Track) => void
  onOpenArtist?: (target: { id?: string; name: string }) => void
  onOpenAlbum?: (target: { id?: string; title: string; artist?: string; trackTitle?: string }) => void
  onAddToPlaylist?: (track: Track) => void
  onSimilar?: (track: Track) => void
  onToast: (text: string, kind?: 'info' | 'error') => void
  /** чтобы App мог обновить счётчики/тосты при изменении списка */
  onChanged?: () => void
}

export default function PlaylistsView({
  canImport,
  currentId,
  playing,
  likedIds,
  onPlay,
  onToggle,
  onLike,
  onHover,
  onAddToQueue,
  onOpenArtist,
  onOpenAlbum,
  onAddToPlaylist,
  onSimilar,
  onToast,
  onChanged
}: Props) {
  const [items, setItems] = useState<PlaylistSummary[] | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [playlist, setPlaylist] = useState<Playlist | null>(null)
  const [title, setTitle] = useState('')
  const [newTitle, setNewTitle] = useState('')
  const [busy, setBusy] = useState(false)

  const reload = useCallback(async () => {
    try {
      setItems(await window.undertow.playlists())
    } catch {
      setItems([])
    }
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  const open = useCallback(async (id: string) => {
    setSelected(id)
    setPlaylist(null)
    try {
      const data = await window.undertow.playlist(id)
      setPlaylist(data)
      setTitle(data?.title ?? '')
    } catch {
      setPlaylist(null)
    }
  }, [])

  const create = async () => {
    const name = newTitle.trim()
    if (!name || busy) return
    setBusy(true)
    try {
      const p = await window.undertow.playlistCreate(name)
      setNewTitle('')
      await reload()
      await open(p.id)
      onToast(`Плейлист «${p.title}» создан`)
      onChanged?.()
    } catch (e) {
      onToast((e as Error).message, 'error')
    } finally {
      setBusy(false)
    }
  }

  const rename = async () => {
    if (!playlist) return
    const name = title.trim()
    if (!name || name === playlist.title) {
      setTitle(playlist.title)
      return
    }
    try {
      const p = await window.undertow.playlistRename(playlist.id, name)
      if (p) setPlaylist(p)
      await reload()
    } catch (e) {
      onToast((e as Error).message, 'error')
    }
  }

  const removePlaylist = async () => {
    if (!playlist) return
    if (!window.confirm(`Удалить плейлист «${playlist.title}»? Треки останутся в библиотеке.`)) return
    await window.undertow.playlistRemove(playlist.id)
    setSelected(null)
    setPlaylist(null)
    await reload()
    onToast('Плейлист удалён')
    onChanged?.()
  }

  const importYandex = async () => {
    if (busy) return
    setBusy(true)
    try {
      const res = await window.undertow.playlistsImport()
      await reload()
      onToast(
        res.created
          ? `Импортировано плейлистов: ${res.created}${res.skipped ? `, пропущено: ${res.skipped}` : ''}`
          : 'Новых плейлистов в Яндексе не нашлось'
      )
      onChanged?.()
    } catch (e) {
      onToast((e as Error).message, 'error')
    } finally {
      setBusy(false)
    }
  }

  const exportPlaylists = async () => {
    try {
      const path = await window.undertow.playlistsExport()
      if (path) onToast(`Экспортировано: ${path}`)
    } catch (e) {
      onToast((e as Error).message, 'error')
    }
  }

  const reorder = async (from: number, to: number) => {
    if (!playlist) return
    const next = [...playlist.tracks]
    const [row] = next.splice(from, 1)
    next.splice(to, 0, row)
    setPlaylist({ ...playlist, tracks: next })
    const saved = await window.undertow.playlistReorder(playlist.id, from, to)
    if (saved) setPlaylist(saved)
  }

  const removeTrack = async (track: Track) => {
    if (!playlist) return
    const saved = await window.undertow.playlistRemoveTrack(playlist.id, track.id)
    if (saved) setPlaylist(saved)
    await reload()
  }

  if (selected && !playlist) {
    return (
      <div className="scroll playlists-page">
        <button className="back-link" onClick={() => setSelected(null)}>
          ← все плейлисты
        </button>
        <div className="empty">Открываю плейлист…</div>
      </div>
    )
  }

  if (selected && playlist) {
    return (
      <div className="scroll playlists-page">
        <button className="back-link" onClick={() => setSelected(null)}>
          ← все плейлисты
        </button>
        <div className="page-head playlist-head">
          <div className="playlist-title-wrap">
            <input
              className="playlist-title-input"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={() => void rename()}
              onKeyDown={(e) => {
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
              }}
              maxLength={80}
              aria-label="Название плейлиста"
            />
            <p>
              {playlist.count} {playlist.count === 1 ? 'трек' : playlist.count < 5 ? 'трека' : 'треков'} ·
              перетаскивайте строки, чтобы менять порядок
            </p>
          </div>
          <div className="playlist-actions">
            <button
              className="play-btn"
              disabled={!playlist.tracks.length}
              onClick={() => playlist.tracks.length && onPlay(playlist.tracks[0], playlist.tracks)}
            >
              <IconPlay width={15} height={15} />
              Слушать
            </button>
            <button className="ghost-btn" onClick={() => void exportPlaylists()}>
              экспорт
            </button>
            <button className="ghost-btn danger" onClick={() => void removePlaylist()}>
              <IconX width={13} height={13} />
              удалить
            </button>
          </div>
        </div>

        {playlist.tracks.length ? (
          <TrackList
            tracks={playlist.tracks}
            currentId={currentId}
            playing={playing}
            onPlay={(t, l) => onPlay(t, l)}
            onToggle={onToggle}
            likedIds={likedIds}
            onLike={onLike}
            onHover={onHover}
            onAddToQueue={onAddToQueue}
            onAddToPlaylist={onAddToPlaylist}
            onSimilar={onSimilar}
            onOpenArtist={onOpenArtist}
            onOpenAlbum={onOpenAlbum}
            onRemoveTrack={(t) => void removeTrack(t)}
            onReorder={(from, to) => void reorder(from, to)}
          />
        ) : (
          <div className="empty">
            <b>Плейлист пуст</b>
            Добавляйте треки из любого списка кнопкой «в плейлист» рядом с очередью.
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="scroll playlists-page">
      <div className="page-head">
        <div>
          <h1>Плейлисты</h1>
          <p>Свои списки: собирайте вручную, импортируйте из Яндекса или экспортируйте в JSON.</p>
        </div>
        <div className="playlist-actions">
          {canImport ? (
            <button className="ghost-btn" onClick={() => void importYandex()} disabled={busy}>
              импорт из Яндекса
            </button>
          ) : null}
          <button className="ghost-btn" onClick={() => void exportPlaylists()}>
            экспорт
          </button>
        </div>
      </div>

      <div className="playlist-new">
        <input
          value={newTitle}
          onChange={(e) => setNewTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void create()
          }}
          placeholder="Название нового плейлиста…"
          maxLength={80}
        />
        <button className="mini-btn" onClick={() => void create()} disabled={!newTitle.trim() || busy}>
          Создать
        </button>
      </div>

      {!items ? (
        <div className="empty">Загружаю…</div>
      ) : items.length ? (
        <div className="playlist-grid">
          {items.map((p) => (
            <button key={p.id} className="playlist-card" onClick={() => void open(p.id)}>
              <div className="playlist-cover">
                {p.coverUrl ? (
                  <img src={p.coverUrl} alt="" loading="lazy" />
                ) : (
                  <span className="playlist-cover-empty">♪</span>
                )}
              </div>
              <div className="playlist-card-title">{p.title}</div>
              <div className="playlist-card-sub">{p.count} треков</div>
            </button>
          ))}
        </div>
      ) : (
        <div className="empty">
          <b>Плейлистов пока нет</b>
          Создайте первый выше или добавьте трек в плейлист из любого списка.
        </div>
      )}
    </div>
  )
}
