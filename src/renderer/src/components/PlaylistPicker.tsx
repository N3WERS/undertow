import { useEffect, useState } from 'react'
import type { PlaylistSummary, Track } from '../types'
import { IconListPlus, IconPlay, IconX } from './Icons'
import { coverAt } from '../covers'

interface Props {
  track: Track | null
  onClose: () => void
  /** чтобы обновить счётчики в «Плейлистах» и показать тост */
  onAdded: (title: string) => void
  onToast: (text: string, kind?: 'info' | 'error') => void
}

/** Небольшой выбор плейлиста из строки трека — с созданием на месте. */
export default function PlaylistPicker({ track, onClose, onAdded, onToast }: Props) {
  const [items, setItems] = useState<PlaylistSummary[] | null>(null)
  const [title, setTitle] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!track) return
    let alive = true
    setItems(null)
    setTitle('')
    void window.undertow
      .playlists()
      .then((list) => alive && setItems(list))
      .catch(() => alive && setItems([]))
    return () => {
      alive = false
    }
  }, [track])

  useEffect(() => {
    if (!track) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [track, onClose])

  if (!track) return null

  const addTo = async (playlist: PlaylistSummary) => {
    if (busy) return
    setBusy(true)
    try {
      const added = await window.undertow.playlistAdd(playlist.id, [track])
      if (added > 0) {
        onAdded(playlist.title)
        onClose()
      } else {
        onToast(`«${track.title}» уже в плейлисте «${playlist.title}»`)
      }
    } catch (e) {
      onToast((e as Error).message, 'error')
    } finally {
      setBusy(false)
    }
  }

  const createAndAdd = async () => {
    const name = title.trim()
    if (!name || busy) return
    setBusy(true)
    try {
      const playlist = await window.undertow.playlistCreate(name)
      await window.undertow.playlistAdd(playlist.id, [track])
      onAdded(playlist.title)
      onClose()
    } catch (e) {
      onToast((e as Error).message, 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="playlist-picker" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Добавить в плейлист">
        <div className="picker-head">
          <div className="picker-title">
            <IconListPlus width={16} height={16} />
            <span>В плейлист</span>
          </div>
          <button className="icon-btn" onClick={onClose} title="Закрыть">
            <IconX width={14} height={14} />
          </button>
        </div>

        <div className="picker-track">
          {track.coverUrl ? <img src={coverAt(track.coverUrl, 160)} alt="" /> : <span className="picker-cover" />}
          <div>
            <b>{track.title}</b>
            <span>{track.artist}</span>
          </div>
        </div>

        <div className="picker-list">
          {!items ? (
            <div className="picker-empty">Смотрю плейлисты…</div>
          ) : items.length ? (
            items.map((p) => (
              <button key={p.id} className="picker-row" onClick={() => void addTo(p)} disabled={busy}>
                {p.coverUrl ? <img src={coverAt(p.coverUrl, 160)} alt="" /> : <span className="picker-row-cover" />}
                <span className="picker-row-name">{p.title}</span>
                <span className="picker-row-count">{p.count}</span>
                <IconPlay width={12} height={12} />
              </button>
            ))
          ) : (
            <div className="picker-empty">Плейлистов пока нет — создайте первый ниже.</div>
          )}
        </div>

        <div className="picker-new">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void createAndAdd()
            }}
            placeholder="Новый плейлист…"
            maxLength={80}
          />
          <button className="mini-btn" onClick={() => void createAndAdd()} disabled={!title.trim() || busy}>
            Создать
          </button>
        </div>
      </div>
    </div>
  )
}
