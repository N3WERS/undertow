import { useEffect, useRef, useState } from 'react'
import type { Lyrics, Track } from '../types'
import { IconX } from './Icons'
import { useProgress } from '../audio/progress'

interface Props {
  track: Track | null
  shifted: boolean
  onSeek: (sec: number) => void
  onClose: () => void
}

/** Текст трека поверх плеера: LRC-строки подсвечиваются по ходу воспроизведения. */
export default function LyricsPanel({ track, shifted, onSeek, onClose }: Props) {
  const { time } = useProgress()
  const [data, setData] = useState<Lyrics | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'empty' | 'error'>('loading')
  const bodyRef = useRef<HTMLDivElement | null>(null)
  const activeRef = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    if (!track) return
    let alive = true
    setStatus('loading')
    setData(null)
    void window.undertow
      .lyrics(track)
      .then((res) => {
        if (!alive) return
        setData(res)
        setStatus(res && (res.lines.length || res.instrumental) ? 'ready' : 'empty')
      })
      .catch(() => alive && setStatus('error'))
    return () => {
      alive = false
    }
  }, [track])

  const synced = Boolean(data?.synced)
  let active = -1
  if (synced && data) {
    for (let i = 0; i < data.lines.length; i++) {
      if (data.lines[i].t <= time + 0.25) active = i
      else break
    }
  }

  useEffect(() => {
    if (active < 0 || !activeRef.current) return
    activeRef.current.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [active])

  if (!track) return null

  return (
    <div className={`lyrics-panel${shifted ? ' shifted' : ''}`}>
      <div className="lyrics-head">
        {track.coverUrl ? (
          <img className="lyrics-cover" src={track.coverUrl} alt="" />
        ) : (
          <span className="lyrics-cover lyrics-cover-empty" aria-hidden="true" />
        )}
        <div className="lyrics-head-text">
          <span className="lyrics-kicker">
            Текст песни
            <span className="lyrics-bars" aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
          </span>
          <b>{track.title}</b>
          <span>{track.artist}</span>
        </div>
        <div className="lyrics-head-right">
          <span className="lyrics-src">
            <i />
            LRCLIB
          </span>
          <button className="icon-btn" onClick={onClose} title="Скрыть текст">
            <IconX width={14} height={14} />
          </button>
        </div>
      </div>

      <div className="lyrics-body" ref={bodyRef}>
        {status === 'loading' ? (
          <div className="lyrics-note">Ищу текст…</div>
        ) : status === 'error' ? (
          <div className="lyrics-note">Не получилось загрузить текст</div>
        ) : data?.instrumental ? (
          <div className="lyrics-note">Это инструментал — петь нечего.</div>
        ) : status === 'empty' || !data ? (
          <div className="lyrics-note">Текста для этого трека в LRCLIB нет.</div>
        ) : synced ? (
          data.lines.map((line, i) => (
            <button
              key={`${line.t}-${i}`}
              ref={i === active ? activeRef : undefined}
              className={`lyrics-line${i === active ? ' on' : ''}${i < active ? ' past' : ''}`}
              onClick={() => onSeek(line.t)}
              title="Перемотать к этой строке"
            >
              {line.text}
            </button>
          ))
        ) : (
          <div className="lyrics-plain">{data.lines.map((l) => l.text).join('\n')}</div>
        )}
      </div>
    </div>
  )
}
