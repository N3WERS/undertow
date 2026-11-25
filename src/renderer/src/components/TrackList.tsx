import { useState, type CSSProperties } from 'react'
import type { Track } from '../types'
import { IconCheck, IconDisc, IconDownload, IconHeart, IconListPlus, IconNote, IconPlay, IconPlus, IconWave, IconX } from './Icons'
import { removeOffline, saveTrack, useOffline } from '../offline'
import ArtistLine from './ArtistLine'

interface Props {
  tracks: Track[]
  currentId: string | null
  playing: boolean
  onPlay: (track: Track, list: Track[]) => void
  onToggle: () => void
  onLocked?: (track: Track) => void
  limit?: number
  showSource?: boolean
  /** id лайкнутых треков — если передано, в строках появляется сердечко */
  likedIds?: Set<string>
  onLike?: (track: Track) => void
  /** прогрев трека при наведении: ссылка (или пара для подмены) готовится заранее */
  onHover?: (track: Track) => void
  /** добавить трек в конец очереди */
  onAddToQueue?: (track: Track) => void
  /** открыть страницу исполнителя (если у трека известен его id) */
  onOpenArtist?: (target: { id?: string; name: string }) => void
  /** открыть страницу альбома, из которого трек */
  onOpenAlbum?: (target: { id?: string; title: string; artist?: string; trackTitle?: string }) => void
  /** что ставить в очередь при клике, если показан только кусок списка */
  playContext?: Track[]
  /** добавить трек в плейлист (открывает выбор плейлиста) */
  onAddToPlaylist?: (track: Track) => void
  /** убрать трек из плейлиста */
  onRemoveTrack?: (track: Track) => void
  /** перетаскивание строк: from/to индексы (для плейлистов) */
  onReorder?: (from: number, to: number) => void
  /** «похожее»: радио от этого трека */
  onSimilar?: (track: Track) => void
  /** нумерованный список: номер всегда виден (чарт) */
  ranked?: boolean
}

const SRC_LABEL: Record<string, string> = { yandex: 'Я', youtube: 'YT' }

export function fmtTime(sec: number | null): string {
  if (sec == null || !Number.isFinite(sec)) return '—'
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  if (m >= 60) return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return `${m}:${String(s).padStart(2, '0')}`
}

export default function TrackList({
  tracks,
  currentId,
  playing,
  onPlay,
  onToggle,
  onLocked,
  limit,
  showSource,
  likedIds,
  onLike,
  onHover,
  onAddToQueue,
  onOpenArtist,
  onOpenAlbum,
  playContext,
  onAddToPlaylist,
  onRemoveTrack,
  onReorder,
  onSimilar,
  ranked
}: Props) {
  const list = limit ? tracks.slice(0, limit) : tracks
  const [dragging, setDragging] = useState<number | null>(null)
  const offline = useOffline()
  return (
    <div className={`tracks${ranked ? ' ranked' : ''}`}>
      {list.map((t, i) => {
        const isCurrent = t.id === currentId
        const liked = likedIds?.has(t.id) ?? false
        const activate = () =>
          t.playable
            ? isCurrent
              ? onToggle()
              : onPlay(t, playContext ?? list)
            : onLocked?.(t)
        return (
          <div
            key={`${t.id}-${i}`}
            role="button"
            tabIndex={0}
            className={`track${ranked ? ' ranked' : ''}${isCurrent ? ' playing' : ''}${
              t.playable ? '' : ' locked'
            }${dragging === i ? ' dragging' : ''}`}
            onClick={activate}
            onMouseEnter={() => onHover?.(t)}
            draggable={Boolean(onReorder)}
            onDragStart={onReorder ? () => setDragging(i) : undefined}
            onDragOver={
              onReorder
                ? (e) => {
                    if (dragging !== null) e.preventDefault()
                  }
                : undefined
            }
            onDrop={
              onReorder
                ? (e) => {
                    e.preventDefault()
                    if (dragging !== null && dragging !== i) onReorder(dragging, i)
                    setDragging(null)
                  }
                : undefined
            }
            onDragEnd={onReorder ? () => setDragging(null) : undefined}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                activate()
              }
            }}
          >
            <span className="track-idx">
              {isCurrent ? (
                <span className={`eq${playing ? '' : ' paused'}`}>
                  <i />
                  <i />
                  <i />
                </span>
              ) : ranked ? (
                <span className="num rank-num">{String(i + 1).padStart(2, '0')}</span>
              ) : (
                <>
                  <span className="num">{i + 1}</span>
                  <span className="glyph">{t.playable ? <IconPlay width={13} height={13} /> : <IconNote width={13} height={13} />}</span>
                </>
              )}
            </span>

            {t.coverUrl ? (
              <img className="track-cover" src={t.coverUrl} alt="" loading="lazy" />
            ) : (
              <span className="track-cover" />
            )}

            <span className="track-text">
              <span className="track-title-row">
                <span className="track-title">{t.title}</span>
                {showSource && (
                  <span
                    className={`src-pill ${t.provider === 'yandex' ? 'yandex' : 'youtube'}`}
                    title={t.provider === 'yandex' ? 'Источник: Яндекс.Музыка' : 'Источник: YouTube'}
                  >
                    {t.provider === 'yandex' ? 'YM' : 'YT'}
                  </span>
                )}
              </span>
              <span className="track-sub-line">
                <ArtistLine track={t} onOpenArtist={onOpenArtist} className="track-sub" />
                {t.year ? <span className="track-year">{t.year}</span> : null}
              </span>
            </span>

            {!t.playable && <span className="track-badge">скоро</span>}
            <span className="track-actions">
              {onSimilar ? (
                <button
                  className="row-action similar-track"
                  title="Похожее: радио от этого трека"
                  onClick={(e) => {
                    e.stopPropagation()
                    onSimilar(t)
                  }}
                >
                  <IconWave width={14} height={14} />
                </button>
              ) : null}
              {onAddToPlaylist ? (
                <button
                  className="row-action add-playlist"
                  title="Добавить в плейлист"
                  onClick={(e) => {
                    e.stopPropagation()
                    onAddToPlaylist(t)
                  }}
                >
                  <IconListPlus width={14} height={14} />
                </button>
              ) : null}
              {onAddToQueue && t.playable ? (
                <button
                  className="row-action add-queue"
                  title="Добавить в очередь"
                  onClick={(e) => {
                    e.stopPropagation()
                    onAddToQueue(t)
                  }}
                >
                  <IconPlus width={14} height={14} />
                </button>
              ) : null}
              {onOpenAlbum ? (
                t.album ? (
                  <button
                    className="row-action open-album"
                    title={`Открыть альбом: ${t.album}`}
                    onClick={(e) => {
                      e.stopPropagation()
                      onOpenAlbum({
                        id: t.albumId,
                        title: t.album as string,
                        artist: t.artist,
                        trackTitle: t.title
                      })
                    }}
                  >
                    <IconDisc width={14} height={14} />
                  </button>
                ) : (
                  // пустой слот: без него у треков без альбома уезжают колонки
                  <span className="row-action placeholder" aria-hidden="true" />
                )
              ) : null}
              {t.playable ? (
                <button
                  className={`row-action save-track${offline.ids.has(t.id) ? ' on' : ''}${
                    offline.progress[t.id] ? ' saving' : ''
                  }`}
                  title={
                    offline.progress[t.id]
                      ? `Сохраняю… ${offline.progress[t.id].percent ?? 0}%`
                      : offline.ids.has(t.id)
                        ? 'Удалить локальную копию'
                        : 'Сохранить локально'
                  }
                  aria-pressed={offline.ids.has(t.id)}
                  style={
                    offline.progress[t.id]?.percent != null
                      ? ({ '--save-progress': `${offline.progress[t.id].percent}%` } as CSSProperties)
                      : undefined
                  }
                  onClick={(e) => {
                    e.stopPropagation()
                    if (offline.progress[t.id]) return
                    if (offline.ids.has(t.id)) void removeOffline(t.id).catch(() => undefined)
                    else void saveTrack(t).catch(() => undefined)
                  }}
                >
                  {offline.ids.has(t.id) ? <IconCheck width={14} height={14} /> : <IconDownload width={14} height={14} />}
                </button>
              ) : null}
              {onLike ? (
                <button
                  className={`like-btn${liked ? ' on' : ''}`}
                  title={liked ? 'Убрать из «Мне нравится»' : 'Мне нравится'}
                  aria-pressed={liked}
                  onClick={(e) => {
                    e.stopPropagation()
                    onLike(t)
                  }}
                >
                  <IconHeart width={15} height={15} filled={liked} />
                </button>
              ) : null}
              {onRemoveTrack ? (
                <button
                  className="row-action remove-track"
                  title="Убрать из плейлиста"
                  onClick={(e) => {
                    e.stopPropagation()
                    onRemoveTrack(t)
                  }}
                >
                  <IconX width={13} height={13} />
                </button>
              ) : null}
            </span>
            <span className="track-time">{fmtTime(t.durationSec)}</span>
          </div>
        )
      })}
    </div>
  )
}
