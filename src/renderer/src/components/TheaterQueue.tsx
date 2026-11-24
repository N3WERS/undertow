import { memo, useState } from 'react'
import type { Track } from '../types'
import { fmtTime } from './TrackList'
import { IconTrash, IconWave } from './Icons'

interface Props {
  queue: Track[]
  index: number
  playing: boolean
  onPlay: (at: number) => void
  onMove: (from: number, to: number) => void
  onRemove: (at: number) => void
}

/** Очередь прямо в боковой панели полноэкранного плеера. */
export default memo(function TheaterQueue({ queue, index, playing, onPlay, onMove, onRemove }: Props) {
  const [dragFrom, setDragFrom] = useState<number | null>(null)
  const [overAt, setOverAt] = useState<number | null>(null)

  if (queue.length === 0) {
    return <div className="tp-note">Очередь пуста — запусти трек из библиотеки или поиска</div>
  }

  return (
    <div className="tp-queue">
      {queue.map((t, i) => {
        const current = i === index
        const played = index >= 0 && i < index
        return (
          <div
            key={`${t.id}-${i}`}
            className={`tp-qrow${current ? ' current' : ''}${played ? ' played' : ''}${
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
            <span className="tp-grip" title="Перетащи, чтобы переставить">
              <i />
              <i />
              <i />
            </span>
            {t.coverUrl ? (
              <img className="tp-qcover" src={t.coverUrl} alt="" loading="lazy" />
            ) : (
              <span className="tp-qcover empty">
                <IconWave width={13} height={13} />
              </span>
            )}
            <span className="tp-qtext">
              <span className="tp-qname">
                {current ? (
                  <span className={`eq small${playing ? '' : ' paused'}`} aria-hidden="true">
                    <i />
                    <i />
                    <i />
                  </span>
                ) : null}
                <span className="tp-qname-text">{t.title}</span>
              </span>
              <span className="tp-qartist">
                {t.artist}
                {t.year ? <span className="track-year inline">{t.year}</span> : null}
              </span>
            </span>
            <span className="tp-qtime">{fmtTime(t.durationSec)}</span>
            <button
              className="tp-qremove"
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
  )
})
