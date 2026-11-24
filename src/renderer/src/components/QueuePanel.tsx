import { useState } from 'react'
import type { Track } from '../types'
import { fmtTime } from './TrackList'
import { IconClose, IconShuffle, IconTrash } from './Icons'

interface Props {
  queue: Track[]
  index: number
  shuffled: boolean
  playing: boolean
  onClose: () => void
  onPlay: (at: number) => void
  onMove: (from: number, to: number) => void
  onRemove: (at: number) => void
  onShuffle: (on: boolean) => void
  onClear: () => void
}

/**
 * Очередь воспроизведения: можно переставлять перетаскиванием, убирать
 * треки и включать перемешивание. Сыгранное показываем приглушённо,
 * чтобы не терять контекст, но не даём его двигать.
 */
export default function QueuePanel({
  queue,
  index,
  shuffled,
  playing,
  onClose,
  onPlay,
  onMove,
  onRemove,
  onShuffle,
  onClear
}: Props) {
  const [dragFrom, setDragFrom] = useState<number | null>(null)
  const [overAt, setOverAt] = useState<number | null>(null)

  const remaining = Math.max(0, queue.length - index - 1)

  return (
    <div className="queue-panel">
      <div className="queue-head">
        <div className="queue-title">
          Очередь
          <span className="queue-count">
            {index >= 0 ? `${remaining} дальше · ${queue.length} всего` : `${queue.length} треков`}
          </span>
        </div>
        <div className="queue-actions">
          <button
            className={`queue-shuffle${shuffled ? ' on' : ''}`}
            onClick={() => onShuffle(!shuffled)}
            title={shuffled ? 'Перемешивание включено' : 'Перемешать очередь'}
            aria-pressed={shuffled}
          >
            <IconShuffle width={14} height={14} />
            <span>перемешать</span>
          </button>
          <button
            className="icon-btn queue-clear"
            onClick={onClear}
            disabled={!queue.length}
            title="Очистить очередь"
          >
            <IconTrash width={14} height={14} />
          </button>
          <button className="icon-btn" onClick={onClose} title="Закрыть очередь">
            <IconClose width={15} height={15} />
          </button>
        </div>
      </div>

      {queue.length === 0 ? (
        <div className="queue-empty">Очередь пуста — запусти трек из библиотеки или поиска</div>
      ) : (
        <div className="queue-list">
          {queue.map((t, i) => {
            const current = i === index
            const played = index >= 0 && i < index
            return (
              <div
                key={`${t.id}-${i}`}
                className={`queue-row${current ? ' current' : ''}${played ? ' played' : ''}${
                  overAt === i && dragFrom !== null && dragFrom !== i ? ' drop' : ''
                }`}
                draggable
                onDragStart={(e) => {
                  setDragFrom(i)
                  e.dataTransfer.effectAllowed = 'move'
                }}
                onDragOver={(e) => {
                  e.preventDefault()
                  e.dataTransfer.dropEffect = 'move'
                  if (overAt !== i) setOverAt(i)
                }}
                onDragLeave={() => setOverAt((v) => (v === i ? null : v))}
                onDragEnd={() => {
                  setDragFrom(null)
                  setOverAt(null)
                }}
                onDrop={(e) => {
                  e.preventDefault()
                  if (dragFrom !== null && dragFrom !== i) onMove(dragFrom, i)
                  setDragFrom(null)
                  setOverAt(null)
                }}
                onClick={() => onPlay(i)}
              >
                <span className="queue-grip" title="Перетащи, чтобы переставить">
                  <i />
                  <i />
                  <i />
                </span>
                {t.coverUrl ? <img className="queue-cover" src={t.coverUrl} alt="" loading="lazy" /> : <span className="queue-cover" />}
                <span className="queue-text">
                  <span className="queue-name">
                    {current ? <span className={`eq small${playing ? '' : ' paused'}`}><i /><i /><i /></span> : null}
                    {t.title}
                  </span>
                  <span className="queue-artist">
                    {t.artist}
                    {t.year ? <span className="track-year inline">{t.year}</span> : null}
                  </span>
                </span>
                <span className="queue-time">{fmtTime(t.durationSec)}</span>
                <button
                  className="queue-remove"
                  title="Убрать из очереди"
                  onClick={(e) => {
                    e.stopPropagation()
                    onRemove(i)
                  }}
                >
                  <IconTrash width={13} height={13} />
                </button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
