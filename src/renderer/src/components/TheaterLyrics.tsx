import { useEffect, useRef, useState } from 'react'
import type { Lyrics, Track } from '../types'
import { useProgress } from '../audio/progress'

interface Props {
  track: Track
  onSeek: (sec: number) => void
}

/** Текст прямо в боковой панели полноэкранного плеера. */
export default function TheaterLyrics({ track, onSeek }: Props) {
  const { time } = useProgress()
  const [data, setData] = useState<Lyrics | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'empty' | 'error'>('loading')
  const activeRef = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
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

  if (status === 'loading') return <div className="tp-note">Ищу текст…</div>
  if (status === 'error') return <div className="tp-note">Не получилось загрузить текст</div>
  if (data?.instrumental) return <div className="tp-note">Это инструментал — петь нечего.</div>
  if (status === 'empty' || !data) return <div className="tp-note">Текста для этого трека в LRCLIB нет.</div>

  if (!synced) {
    return <div className="tp-plain">{data.lines.map((l) => l.text).join('\n')}</div>
  }

  return (
    <div className="tp-lyrics">
      {data.lines.map((line, i) => (
        <button
          key={`${line.t}-${i}`}
          ref={i === active ? activeRef : undefined}
          className={`tp-line${i === active ? ' on' : ''}${i < active ? ' past' : ''}`}
          onClick={() => onSeek(line.t)}
          title="Перемотать к этой строке"
        >
          {line.text}
        </button>
      ))}
    </div>
  )
}
