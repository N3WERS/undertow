import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import type { Track } from '../types'
import { IconCheck, IconDisc, IconDownload, IconHeart, IconListPlus, IconNote, IconPlay, IconPlus, IconWave, IconX } from './Icons'
import { removeOffline, saveTrack, useOffline } from '../offline'
import ArtistLine from './ArtistLine'
import { coverAt } from '../covers'

interface Props {
  tracks: Track[]
  currentId: string | null
  playing: boolean
  onPlay: (track: Track, list: Track[]) => void
  onToggle: () => void
  onLocked?: (track: Track) => void
  limit?: number
  showSource?: boolean
  /** показывать плашку official у каталожных и верифицированных треков */
  showOfficial?: boolean
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
  /** выбранные треки для массовых действий */
  selection?: Set<string>
  onSelect?: (track: Track, shiftKey: boolean) => void
}

const ROW_HEIGHT = 54
const ROW_GAP = 2
const VIRTUAL_MIN = 80
const OVERSCAN = 6

/** Окно видимых строк для длинных списков: DOM и обработчики только у экрана. */
function useVirtualRange(count: number, enabled: boolean): {
  listRef: React.RefObject<HTMLDivElement | null>
  start: number
  end: number
} {
  const listRef = useRef<HTMLDivElement | null>(null)
  const [range, setRange] = useState({ start: 0, end: enabled ? Math.min(count, 24) : count })

  useLayoutEffect(() => {
    if (!enabled) {
      setRange((prev) => (prev.start === 0 && prev.end === count ? prev : { start: 0, end: count }))
      return
    }
    const list = listRef.current
    if (!list) return
    const scroll = list.closest('.scroll') as HTMLElement | null
    if (!scroll) {
      setRange((prev) => (prev.start === 0 && prev.end === count ? prev : { start: 0, end: count }))
      return
    }

    let frame = 0
    const step = ROW_HEIGHT + ROW_GAP
    const measure = (): void => {
      frame = 0
      const listTop =
        list.getBoundingClientRect().top - scroll.getBoundingClientRect().top + scroll.scrollTop
      const viewTop = scroll.scrollTop - listTop
      const start = Math.max(0, Math.floor(viewTop / step) - OVERSCAN)
      const visible = Math.ceil(scroll.clientHeight / step) + OVERSCAN * 2 + 2
      const end = Math.min(count, start + visible)
      setRange((prev) => (prev.start === start && prev.end === end ? prev : { start, end }))
    }
    const onScroll = (): void => {
      if (!frame) frame = requestAnimationFrame(measure)
    }

    measure()
    scroll.addEventListener('scroll', onScroll, { passive: true })
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(onScroll)
    ro?.observe(scroll)
    ro?.observe(list)
    return () => {
      if (frame) cancelAnimationFrame(frame)
      scroll.removeEventListener('scroll', onScroll)
      ro?.disconnect()
    }
  }, [count, enabled])

  return { listRef, start: range.start, end: range.end }
}

function sourcePill(track: Track): { cls: string; label: string; title: string } {
  if (track.provider === 'yandex') {
    return { cls: 'yandex', label: 'YM', title: 'Источник: Яндекс.Музыка' }
  }
  if (track.provider === 'soundcloud') {
    return { cls: 'soundcloud', label: 'SC', title: 'Источник: SoundCloud' }
  }
  if (track.catalog) {
    return { cls: 'ytmusic', label: 'YTM', title: 'Источник: YouTube Music' }
  }
  return { cls: 'youtube', label: 'YT', title: 'Источник: YouTube' }
}

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
  showOfficial,
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
  ranked,
  selection,
  onSelect
}: Props) {
  const list = limit ? tracks.slice(0, limit) : tracks
  const [dragging, setDragging] = useState<number | null>(null)
  const offline = useOffline()
  // Перетаскивание и маленькие списки оставляем обычными: виртуализация
  // нужна только там, где строк действительно много.
  const virtual = list.length >= VIRTUAL_MIN && !limit && !onReorder
  const { listRef, start, end } = useVirtualRange(list.length, virtual)
  const visible = virtual ? list.slice(start, end) : list
  const step = ROW_HEIGHT + ROW_GAP
  return (
    <div
      ref={listRef}
      className={`tracks${ranked ? ' ranked' : ''}${onSelect ? ' selectable' : ''}${virtual ? ' virtual' : ''}`}
      style={virtual ? { height: list.length * step - ROW_GAP } : undefined}
    >
      {visible.map((t, vi) => {
        const i = virtual ? start + vi : vi
        const isCurrent = t.id === currentId
        const liked = likedIds?.has(t.id) ?? false
        const source = sourcePill(t)
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
            }${dragging === i ? ' dragging' : ''}${selection?.has(t.id) ? ' selected' : ''}`}
            style={virtual ? { top: i * step, height: ROW_HEIGHT } : undefined}
            aria-posinset={virtual ? i + 1 : undefined}
            aria-setsize={virtual ? list.length : undefined}
            onClick={(e) => {
              if (onSelect) onSelect(t, e.shiftKey)
              else activate()
            }}
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
                if (onSelect) onSelect(t, e.shiftKey)
                else activate()
              }
            }}
          >
            {onSelect ? (
              <button
                className={`track-check${selection?.has(t.id) ? ' on' : ''}`}
                aria-label={selection?.has(t.id) ? 'Убрать из выбранных' : 'Выбрать трек'}
                aria-pressed={selection?.has(t.id) ?? false}
                onClick={(e) => {
                  e.stopPropagation()
                  onSelect(t, e.shiftKey)
                }}
              >
                {selection?.has(t.id) ? <IconCheck width={11} height={11} /> : null}
              </button>
            ) : null}

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
              <img className="track-cover" src={coverAt(t.coverUrl, 80)} alt="" loading="lazy" decoding="async" />
            ) : (
              <span className="track-cover" />
            )}

            <span className="track-text">
              <span className="track-title-row">
                <span className="track-title">{t.title}</span>
                {showOfficial && t.official ? (
                  <span className="official-pill" title="Официальная версия исполнителя">
                    official
                  </span>
                ) : null}
                {showSource && (
                  <span className={`src-pill ${source.cls}`} title={source.title}>
                    {source.label}
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
