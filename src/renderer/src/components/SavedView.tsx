import { useEffect, useState } from 'react'
import type { DownloadItem, Track } from '../types'
import TrackList from './TrackList'
import { clearOffline, fmtBytes, refreshOffline, useOffline } from '../offline'
import {
  clearFinishedDownloads,
  pauseDownloads,
  refreshDownloads,
  removeDownload,
  resumeDownloads,
  retryDownload,
  useDownloads
} from '../downloads'
import { IconFolder, IconX } from './Icons'

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

function downloadSub(item: DownloadItem): string {
  if (item.status === 'done' && item.bytes) return ` · ${fmtBytes(item.bytes)}`
  if (item.status === 'error') return ` · ${item.error ?? 'не удалось скачать'}`
  if (item.status === 'queued') return ' · в очереди'
  if (item.percent != null) return ` · ${item.percent}%`
  return ' · качается'
}

export default function SavedView(p: Props) {
  const offline = useOffline()
  const downloads = useDownloads()
  const [confirmClear, setConfirmClear] = useState(false)

  useEffect(() => {
    void refreshOffline()
    void refreshDownloads()
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

      {offline.error && <div className="notice error">{offline.error}</div>}

      {downloads.items.length > 0 ? (
        <section className="download-queue">
          <div className="download-head">
            <div>
              <b>Очередь загрузок</b>
              <span>
                {downloads.active > 0 ? `${downloads.active} качается` : 'ничего не качается'}
                {downloads.queued > 0 ? ` · ${downloads.queued} в очереди` : ''}
                {downloads.errors > 0 ? ` · ${downloads.errors} с ошибкой` : ''}
              </span>
            </div>
            <div className="download-head-actions">
              <button
                className="link-btn"
                onClick={() => void (downloads.paused ? resumeDownloads() : pauseDownloads())}
              >
                {downloads.paused ? 'Продолжить' : 'Пауза'}
              </button>
              <button className="link-btn" onClick={() => void clearFinishedDownloads()}>
                Убрать завершённые
              </button>
            </div>
          </div>
          <div className="download-list">
            {downloads.items.map((item) => (
              <div className={`download-row ${item.status}`} key={item.id}>
                {item.track.coverUrl ? (
                  <img src={item.track.coverUrl} alt="" loading="lazy" />
                ) : (
                  <span className="download-cover" />
                )}
                <span className="download-copy">
                  <b>{item.track.title}</b>
                  <em>{item.track.artist}{downloadSub(item)}</em>
                  {item.status === 'downloading' ? (
                    <span className="download-progress">
                      <i style={{ width: `${item.percent ?? 30}%` }} className={item.percent == null ? 'unknown' : ''} />
                    </span>
                  ) : null}
                </span>
                {item.status === 'error' ? (
                  <button className="download-action" onClick={() => void retryDownload(item.id)}>
                    Повторить
                  </button>
                ) : null}
                {item.status !== 'downloading' ? (
                  <button
                    className="download-action remove"
                    title="Убрать из очереди"
                    onClick={() => void removeDownload(item.id)}
                  >
                    <IconX width={12} height={12} />
                  </button>
                ) : null}
              </div>
            ))}
          </div>
        </section>
      ) : null}

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
