import { useEffect, useState } from 'react'
import type { Track } from '../types'
import TrackList from './TrackList'
import { clearOffline, fmtBytes, refreshOffline, useOffline } from '../offline'
import { IconFolder } from './Icons'

interface Props {
  currentId: string | null
  playing: boolean
  likedIds: Set<string>
  onPlay: (track: Track, list: Track[]) => void
  onToggle: () => void
  onLike: (track: Track) => void
  onHover?: (track: Track) => void
  onAddToQueue?: (track: Track) => void
  onOpenArtist?: (target: { id?: string; name: string }) => void
  onOpenAlbum?: (target: { id?: string; title: string; artist?: string; trackTitle?: string }) => void
  onAddToPlaylist?: (track: Track) => void
  onSimilar?: (track: Track) => void
}

export default function SavedView(p: Props) {
  const offline = useOffline()
  const [confirmClear, setConfirmClear] = useState(false)

  useEffect(() => {
    void refreshOffline()
  }, [])

  useEffect(() => {
    if (!confirmClear) return
    const timer = setTimeout(() => setConfirmClear(false), 4000)
    return () => clearTimeout(timer)
  }, [confirmClear])

  const tracks = offline.items.map((e) => e.track)

  return (
    <div className="scroll">
      <div className="page-head">
        <div>
          <h1>Сохранённые</h1>
          <p>
            {offline.items.length} {offline.items.length === 1 ? 'трек' : offline.items.length > 1 && offline.items.length < 5 ? 'трека' : 'треков'} ·{' '}
            {fmtBytes(offline.bytes)}
          </p>
        </div>
        <div className="head-actions">
          <button className="link-btn" onClick={() => void window.undertow.offlineReveal()}>
            <IconFolder width={15} height={15} />
            Папка
          </button>
          {offline.items.length > 0 && (
            <button
              className={`link-btn${confirmClear ? ' danger' : ''}`}
              onClick={() => {
                if (confirmClear) {
                  setConfirmClear(false)
                  void clearOffline().catch(() => undefined)
                } else {
                  setConfirmClear(true)
                }
              }}
            >
              {confirmClear ? 'Точно удалить всё?' : 'Очистить'}
            </button>
          )}
          {tracks.length > 0 && (
            <button className="play-btn" onClick={() => tracks[0] && p.onPlay(tracks[0], tracks)}>
              Слушать всё
            </button>
          )}
        </div>
      </div>

      <div className="notice saved-note">
        Копии лежат на диске и играют первыми — даже без сети и без Плюса. Кнопка со стрелкой в строке трека сохраняет
        его сюда, галочка означает, что копия уже есть.
      </div>

      {offline.error && <div className="notice error">{offline.error}</div>}

      {!offline.ready ? (
        <div className="empty">
          <span className="spinner" /> Читаю сохранённые треки…
        </div>
      ) : tracks.length === 0 ? (
        <div className="empty">
          <b>Пока ничего не сохранено</b>
          Нажми стрелку вниз в строке любого трека — файл скачается в папку Undertow и появится здесь. Локальная копия
          всегда играет вместо стрима.
        </div>
      ) : (
        <TrackList
          tracks={tracks}
          currentId={p.currentId}
          playing={p.playing}
          onPlay={p.onPlay}
          onToggle={p.onToggle}
          likedIds={p.likedIds}
          onLike={p.onLike}
          onHover={p.onHover}
          onAddToQueue={p.onAddToQueue}
          onOpenArtist={p.onOpenArtist}
          onOpenAlbum={p.onOpenAlbum}
          onAddToPlaylist={p.onAddToPlaylist}
          onSimilar={p.onSimilar}
          showSource
        />
      )}
    </div>
  )
}
