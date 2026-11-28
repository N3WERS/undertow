import { useState } from 'react'
import type { JSX } from 'react'
import {
  IconCheck,
  IconClose,
  IconDownload,
  IconExpand,
  IconHeart,
  IconMute,
  IconNext,
  IconPause,
  IconPlay,
  IconPrev,
  IconQueue,
  IconRepeat,
  IconShuffle,
  IconVolume,
  IconWave
} from './Icons'
import { fmtTime } from './TrackList'
import { useProgressSlow } from '../audio/progress'
import { coverAt } from '../covers'
import { removeOffline, saveTrack, useOffline } from '../offline'
import type { RepeatMode } from '../audio/engine'
import type { FlowRoute, Track } from '../types'

interface Props {
  track: Track | null
  playing: boolean
  resolving: boolean
  duration: number
  volume: number
  source: 'yandex' | 'youtube' | 'local' | 'soundcloud' | null
  quality: string | null
  queue: Track[]
  queueIndex: number
  shuffled: boolean
  repeat: RepeatMode
  flowActive: boolean
  flowRoute: FlowRoute | null
  liked: boolean
  onLike: () => void
  onToggle: () => void
  onNext: () => void
  onPrev: () => void
  onSeek: (sec: number) => void
  onVolume: (value: number) => void
  onPlayAt: (index: number) => void
  onShuffle: (on: boolean) => void
  onCycleRepeat: () => void
  onRestore: () => void
}

const sourceLabel = (source: Props['source']): string =>
  source === 'yandex' ? 'YM' : source === 'local' ? 'LOCAL' : source === 'soundcloud' ? 'SC' : 'YT'

export default function MiniPlayer({
  track,
  playing,
  resolving,
  duration,
  volume,
  source,
  quality,
  queue,
  queueIndex,
  shuffled,
  repeat,
  flowActive,
  flowRoute,
  liked,
  onLike,
  onToggle,
  onNext,
  onPrev,
  onSeek,
  onVolume,
  onPlayAt,
  onShuffle,
  onCycleRepeat,
  onRestore
}: Props): JSX.Element {
  const live = useProgressSlow(220)
  const offline = useOffline()
  const [queueOpen, setQueueOpen] = useState(false)
  const savedLocal = track ? offline.ids.has(track.id) : false
  const saveProgress = track ? offline.progress[track.id] : undefined
  const progress = track && live.trackId === track.id ? live.time : 0
  const total = live.trackId === track?.id && live.duration > 0 ? live.duration : duration
  const percent = total > 0 ? Math.min(100, Math.max(0, (progress / total) * 100)) : 0
  const queueStart = Math.max(0, queueIndex + 1)
  const upcoming = queue.slice(queueStart, queueStart + 2)
  const panelStart = Math.max(0, queueIndex - 1)
  const panelQueue = queue.slice(panelStart, panelStart + 40)
  const queueTail = Math.max(0, queue.length - panelStart - panelQueue.length)

  const flowReason = flowActive
    ? flowRoute?.library
      ? 'из вашей библиотеки'
      : flowRoute?.anchor
        ? `похоже на «${flowRoute.anchor}»`
        : flowRoute?.seed
          ? `от ${flowRoute.seed}`
          : 'продолжение потока'
    : ''
  const flowTier = flowActive
    ? flowRoute?.hop === 2
      ? 'второй шаг'
      : flowRoute?.tier === 'hit'
        ? 'хит'
        : flowRoute?.tier === 'recent'
          ? 'новинка'
          : flowRoute?.tier === 'deep'
            ? 'глубина'
            : ''
    : ''

  const setVolume = (clientX: number, el: HTMLElement): void => {
    const rect = el.getBoundingClientRect()
    onVolume(Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)))
  }

  return (
    <div className="mini-player">
      <div className="mini-drag">
        <span className="mini-brand">
          <span className={`mini-dot${playing ? ' live' : ''}`} />
          Undertow
        </span>
        <button className="mini-drag-open" onClick={onRestore} title="Открыть полный вид">
          <IconExpand width={12} height={12} />
          полный вид
        </button>
      </div>

      {queueOpen ? (
        <div className="mini-queue-panel">
          <div className="mini-queue-top">
            <div className="mini-queue-title">
              <b>Очередь</b>
              <span>{queue.length} треков</span>
            </div>
            <button className="mini-queue-close" onClick={() => setQueueOpen(false)} title="Закрыть очередь">
              <IconClose width={14} height={14} />
            </button>
          </div>

          <div className="mini-queue-list">
            {panelQueue.length ? (
              panelQueue.map((item, i) => {
                const at = panelStart + i
                const current = at === queueIndex
                return (
                  <button
                    key={`${item.id}-${at}`}
                    className={`mini-queue-row${current ? ' on' : ''}`}
                    onClick={() => onPlayAt(at)}
                    title={`${item.title} — ${item.artist}`}
                  >
                    <span className="mini-queue-num">{current && playing ? '›' : String(at + 1).padStart(2, '0')}</span>
                    {item.coverUrl ? (
                      <img src={item.coverUrl} alt="" loading="lazy" />
                    ) : (
                      <span className="mini-queue-art" />
                    )}
                    <span className="mini-queue-text">
                      <b>{item.title}</b>
                      <i>{item.artist}</i>
                    </span>
                  </button>
                )
              })
            ) : (
              <div className="mini-queue-empty">Очередь пуста</div>
            )}
            {queueTail > 0 ? <div className="mini-queue-more">и ещё {queueTail}</div> : null}
          </div>
        </div>
      ) : (
        <>
          <div className="mini-main">
            <button
              className="mini-cover"
              onClick={onRestore}
              title="Открыть полный вид"
              aria-label="Открыть полный вид"
            >
              {track?.coverUrl ? (
                <img src={coverAt(track.coverUrl, 240)} alt="" draggable={false} />
              ) : (
                <span className="mini-cover-empty">
                  <IconWave width={24} height={24} />
                </span>
              )}
            </button>

            <div className="mini-info">
              <div className="mini-meta">
                {flowActive ? (
                  <span className="mini-flow-badge" title="Трек играет из Течения">
                    <IconWave width={9} height={9} />
                    Течение
                  </span>
                ) : null}
                {source ? <span className="mini-source">{sourceLabel(source)}</span> : null}
                {quality ? <span className="mini-quality">{quality}</span> : null}
                <span className="mini-times">
                  {fmtTime(progress)} / {fmtTime(total)}
                </span>
                <div className="mini-actions">
                  <button
                    className={`mini-action like${liked ? ' on' : ''}`}
                    onClick={onLike}
                    disabled={!track}
                    title={liked ? 'Убрать из «Мне нравится»' : 'Мне нравится'}
                    aria-label={liked ? 'Убрать из «Мне нравится»' : 'Мне нравится'}
                    aria-pressed={liked}
                  >
                    <IconHeart width={12} height={12} filled={liked} />
                  </button>
                  <button
                    className={`mini-action save${savedLocal ? ' on' : ''}${saveProgress ? ' saving' : ''}`}
                    onClick={() => {
                      if (!track || saveProgress) return
                      if (savedLocal) void removeOffline(track.id).catch(() => undefined)
                      else void saveTrack(track).catch(() => undefined)
                    }}
                    disabled={!track || Boolean(saveProgress)}
                    title={
                      saveProgress
                        ? `Сохраняю… ${saveProgress.percent ?? 0}%`
                        : savedLocal
                          ? 'Удалить локальную копию'
                          : 'Сохранить трек локально'
                    }
                    aria-label={savedLocal ? 'Удалить локальную копию' : 'Сохранить трек локально'}
                    aria-pressed={savedLocal}
                  >
                    {savedLocal ? <IconCheck width={12} height={12} /> : <IconDownload width={12} height={12} />}
                  </button>
                </div>
              </div>

              <div className={`mini-title${track ? '' : ' empty'}`} title={track?.title}>
                {resolving ? 'Подключаю звук…' : (track?.title ?? 'Ничего не играет')}
              </div>
              <div className="mini-artist" title={track?.artist}>
                {track?.artist ?? 'Выбери трек в основном окне'}
              </div>
              {flowActive ? (
                <div className="mini-flow-why" title={flowReason}>
                  <span className="mini-flow-why-label">почему</span>
                  <span className="mini-flow-why-text">{flowReason}</span>
                  {flowTier ? <span className="mini-flow-tier">{flowTier}</span> : null}
                </div>
              ) : null}
            </div>
          </div>

          <div className="mini-controls">
            <div className="mini-modes">
              <button
                className={`mini-mode${shuffled ? ' on' : ''}`}
                onClick={() => onShuffle(!shuffled)}
                disabled={!queue.length}
                title={shuffled ? 'Выключить перемешивание' : 'Перемешать очередь'}
                aria-pressed={shuffled}
              >
                <IconShuffle width={14} height={14} />
              </button>
              <button
                className={`mini-mode${repeat !== 'off' ? ' on' : ''}`}
                onClick={onCycleRepeat}
                disabled={!track}
                title={
                  repeat === 'all'
                    ? 'Повтор всей очереди'
                    : repeat === 'one'
                      ? 'Повтор одного трека'
                      : 'Повтор выключен'
                }
                aria-pressed={repeat !== 'off'}
              >
                <IconRepeat width={14} height={14} />
                {repeat === 'one' ? <span className="repeat-one">1</span> : null}
              </button>
            </div>

            <div className="mini-transport">
              <button className="mini-step" onClick={onPrev} disabled={!track} aria-label="Предыдущий трек">
                <IconPrev width={15} height={15} />
              </button>
              <button
                className="mini-play"
                onClick={onToggle}
                disabled={!track || resolving}
                aria-label={playing ? 'Пауза' : 'Играть'}
              >
                {playing ? <IconPause width={16} height={16} /> : <IconPlay width={16} height={16} />}
              </button>
              <button className="mini-step" onClick={onNext} disabled={!track} aria-label="Следующий трек">
                <IconNext width={15} height={15} />
              </button>
            </div>

            <div className="mini-volume">
              <button
                className="mini-vol-icon"
                onClick={() => onVolume(volume > 0 ? 0 : 0.85)}
                title={volume > 0 ? 'Выключить звук' : 'Включить звук'}
              >
                {volume > 0 ? <IconVolume width={15} height={15} /> : <IconMute width={15} height={15} />}
              </button>
              <div
                className="mini-vol-bar"
                title="Громкость"
                onMouseDown={(e) => {
                  const el = e.currentTarget
                  setVolume(e.clientX, el)
                  const move = (ev: MouseEvent) => setVolume(ev.clientX, el)
                  const up = () => {
                    window.removeEventListener('mousemove', move)
                    window.removeEventListener('mouseup', up)
                  }
                  window.addEventListener('mousemove', move)
                  window.addEventListener('mouseup', up)
                }}
              >
                <div className="mini-vol-track">
                  <div className="mini-vol-fill" style={{ transform: `scaleX(${volume})` }} />
                </div>
                <span className="mini-vol-knob" style={{ left: `${volume * 100}%` }} />
              </div>
            </div>
          </div>

          <div className="mini-queue-strip">
            <div className="mini-queue-head">
              <span className="mini-queue-kicker">дальше</span>
              <span className="mini-queue-len">
                {queue.length ? `${Math.max(0, queue.length - queueIndex - 1)} в очереди` : 'пусто'}
              </span>
              <button
                className="mini-queue-open"
                onClick={() => setQueueOpen(true)}
                disabled={!queue.length}
                title="Открыть очередь"
              >
                <IconQueue width={13} height={13} />
                вся очередь
              </button>
            </div>

            {upcoming.length ? (
              <div className="mini-next-grid">
                {upcoming.map((item, i) => (
                  <button
                    key={`${item.id}-${i}`}
                    className="mini-next"
                    onClick={() => onPlayAt(queueStart + i)}
                    title={`${item.title} — ${item.artist}`}
                  >
                    {item.coverUrl ? <img src={item.coverUrl} alt="" loading="lazy" /> : <span className="mini-next-art" />}
                    <span className="mini-next-text">
                      <b>{item.title}</b>
                      <i>{item.artist}</i>
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <div className="mini-next-empty">Дальше пока ничего нет</div>
            )}
          </div>
        </>
      )}

      <button
        className="mini-progress"
        onClick={(e) => {
          if (total <= 0) return
          const rect = e.currentTarget.getBoundingClientRect()
          onSeek(((e.clientX - rect.left) / rect.width) * total)
        }}
        title="Перейти по треку"
        aria-label="Перемотка"
      >
        <span className="mini-progress-track">
          <span className="mini-progress-fill" style={{ transform: `scaleX(${percent / 100})` }} />
        </span>
      </button>
    </div>
  )
}
