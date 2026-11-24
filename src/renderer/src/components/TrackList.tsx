import { useState } from 'react'
import type { Track } from '../types'
import { IconDisc, IconHeart, IconListPlus, IconNote, IconPlay, IconPlus, IconWave, IconX } from './Icons'
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
  onSimilar
}: Props) {
  const list = limit ? tracks.slice(0, limit) : tracks
  const [dragging, setDragging] = useState<number | null>(null)
  return (
    <div className="tracks">
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
            className={`track${isCurrent ? ' playing' : ''}${t.playable ? '' : ' locked'}${
              dragging === i ? ' dragging' : ''
            }`}
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
                  <span className={`track-src${t.provider === 'yandex' ? ' ym' : ''}`}>
                    {t.provider === 'yandex' ? 'Я' : 'YT'}
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
