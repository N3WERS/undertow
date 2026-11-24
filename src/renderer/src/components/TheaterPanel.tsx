import type { Track, TrackVersion } from '../types'
import { IconClose, IconShuffle, IconTrash } from './Icons'
import TheaterLyrics from './TheaterLyrics'
import TheaterVersions from './TheaterVersions'
import TheaterQueue from './TheaterQueue'

export type TheaterTab = 'lyrics' | 'versions' | 'queue'

interface Props {
  mode: TheaterTab
  track: Track
  versions: { loading: boolean; list: TrackVersion[] } | null
  copyLabel: string | null
  queue: Track[]
  queueIndex: number
  queueShuffled: boolean
  playing: boolean
  onClose: () => void
  onSeek: (sec: number) => void
  onPickVersion: (v: TrackVersion) => void
  onAddVersion: (v: TrackVersion) => void
  onRestoreOriginal: () => void
  onQueuePlay: (at: number) => void
  onQueueMove: (from: number, to: number) => void
  onQueueRemove: (at: number) => void
  onQueueShuffle: (on: boolean) => void
  onQueueClear: () => void
}

const KICKER: Record<TheaterTab, string> = {
  lyrics: 'Текст песни',
  versions: 'Версии трека',
  queue: 'Очередь'
}

/** Нижняя панель полного плеера: текст, версии и очередь в одном месте. */
export default function TheaterPanel(p: Props) {
  const current = p.queueIndex >= 0 ? p.queue[p.queueIndex] : null
  const remaining = Math.max(0, p.queue.length - p.queueIndex - 1)

  const subtitle =
    p.mode === 'lyrics'
      ? `${p.track.artist} · LRCLIB`
      : p.mode === 'versions'
        ? p.versions?.loading
          ? `${p.track.artist} · ищу варианты…`
          : `${p.track.artist} · ${p.versions?.list.length ?? 0} вариантов`
        : current
          ? `${remaining} дальше · ${p.queue.length} всего`
          : `${p.queue.length} треков`

  return (
    <aside className="theater-panel" aria-label={KICKER[p.mode]}>
      <header className="tp-head">
        <div className="tp-head-text">
          <span className="tp-kicker">{KICKER[p.mode]}</span>
          <span className="tp-sub">{subtitle}</span>
        </div>
        <div className="tp-actions">
          {p.mode === 'queue' ? (
            <>
              <button
                className={`tp-icon${p.queueShuffled ? ' on' : ''}`}
                onClick={() => p.onQueueShuffle(!p.queueShuffled)}
                title={p.queueShuffled ? 'Перемешивание включено' : 'Перемешать очередь'}
                aria-pressed={p.queueShuffled}
              >
                <IconShuffle width={14} height={14} />
              </button>
              <button
                className="tp-icon"
                onClick={p.onQueueClear}
                disabled={!p.queue.length}
                title="Очистить очередь"
              >
                <IconTrash width={14} height={14} />
              </button>
            </>
          ) : null}
          <button className="tp-icon tp-close" onClick={p.onClose} title="Закрыть панель">
            <IconClose width={15} height={15} />
          </button>
        </div>
      </header>

      <div className={`tp-body tp-body-${p.mode}`}>
        {p.mode === 'lyrics' ? <TheaterLyrics track={p.track} onSeek={p.onSeek} /> : null}
        {p.mode === 'versions' ? (
          <TheaterVersions
            track={p.track}
            versions={p.versions}
            copyLabel={p.copyLabel}
            onPick={p.onPickVersion}
            onAdd={p.onAddVersion}
            onRestoreOriginal={p.onRestoreOriginal}
          />
        ) : null}
        {p.mode === 'queue' ? (
          <TheaterQueue
            queue={p.queue}
            index={p.queueIndex}
            playing={p.playing}
            onPlay={p.onQueuePlay}
            onMove={p.onQueueMove}
            onRemove={p.onQueueRemove}
          />
        ) : null}
      </div>
    </aside>
  )
}
