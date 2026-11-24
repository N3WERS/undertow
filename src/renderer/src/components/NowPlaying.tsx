import { useEffect, useRef } from 'react'
import type { Track, TrackVersion } from '../types'
import { fmtTime } from './TrackList'
import { useProgress } from '../audio/progress'
import ArtistLine from './ArtistLine'
import TheaterPanel, { type TheaterTab } from './TheaterPanel'
import { removeOffline, saveTrack, useOffline } from '../offline'
import {
  IconCheck,
  IconDownload,
  IconHeart,
  IconLayers,
  IconListPlus,
  IconMute,
  IconNext,
  IconPause,
  IconPlay,
  IconPrev,
  IconQueue,
  IconRadio,
  IconText,
  IconVolume,
  IconWave,
  IconX
} from './Icons'

interface Props {
  track: Track
  playing: boolean
  resolving: boolean
  progress: number
  duration: number
  volume: number
  quality: string | null
  source: 'yandex' | 'youtube' | 'local' | null
  copyLabel: string | null
  versions: { loading: boolean; list: TrackVersion[] } | null
  onVersions: () => void
  onPickVersion: (v: TrackVersion) => void
  onAddVersion: (v: TrackVersion) => void
  onRestoreOriginal: () => void
  queue: Track[]
  queueIndex: number
  queueShuffled: boolean
  onQueuePlay: (at: number) => void
  onQueueMove: (from: number, to: number) => void
  onQueueRemove: (at: number) => void
  onQueueShuffle: (on: boolean) => void
  onQueueClear: () => void
  queueOpen: boolean
  onToggleQueue: () => void
  lyricsOpen: boolean
  onToggleLyrics: () => void
  hasLyrics: boolean
  normalize: boolean
  onNormalize: (v: boolean) => void
  liked: boolean
  onLike: () => void
  onToggle: () => void
  onNext: () => void
  onPrev: () => void
  onSeek: (sec: number) => void
  onVolume: (v: number) => void
  onOpenArtist?: (target: { id?: string; name: string }) => void
  onOpenAlbum?: (target: { id?: string; title: string; artist?: string; trackTitle?: string }) => void
  onRadio: () => void
  radioLoading?: boolean
  onAddToPlaylist: () => void
  /** пока открыт модальный диалог, Esc не должен закрывать плеер */
  escBlocked?: boolean
  onClose: () => void
}

function sourceShort(source: Props['source']): string {
  if (source === 'yandex') return 'YM'
  if (source === 'local') return 'LOCAL'
  return 'YT'
}

/** Полноэкранный «сейчас играет»: крупный трек, нижняя панель и док действий. */
export default function NowPlaying(p: Props) {
  const live = useProgress()
  const offline = useOffline()
  const progress = live.time
  const duration = live.duration || p.duration
  const pct = duration > 0 ? Math.min(100, (progress / duration) * 100) : 0
  const saveProgress = offline.progress[p.track.id]
  const savedLocal = offline.ids.has(p.track.id)
  const scrubRef = useRef<HTMLDivElement>(null)

  const panel: TheaterTab | null = p.versions
    ? 'versions'
    : p.lyricsOpen
      ? 'lyrics'
      : p.queueOpen
        ? 'queue'
        : null

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || p.escBlocked) return
      if (panel === 'versions') p.onVersions()
      else if (panel === 'lyrics') p.onToggleLyrics()
      else if (panel === 'queue') p.onToggleQueue()
      else p.onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [panel, p.escBlocked, p.onClose, p.onVersions, p.onToggleLyrics, p.onToggleQueue])

  const seekAt = (clientX: number) => {
    const el = scrubRef.current
    if (!el || duration <= 0) return
    const r = el.getBoundingClientRect()
    const ratio = Math.min(1, Math.max(0, (clientX - r.left) / r.width))
    p.onSeek(ratio * duration)
  }

  const volumeAt = (el: HTMLElement, clientX: number) => {
    const r = el.getBoundingClientRect()
    p.onVolume(Math.min(1, Math.max(0, (clientX - r.left) / r.width)))
  }

  const closePanel = () => {
    if (panel === 'versions') p.onVersions()
    else if (panel === 'lyrics') p.onToggleLyrics()
    else if (panel === 'queue') p.onToggleQueue()
  }

  const cover = p.track.coverUrl

  return (
    <section className={`theater${panel ? ' has-panel' : ''}`} role="dialog" aria-modal="true" aria-label="Плеер">
      {cover ? <div className="theater-bg" style={{ backgroundImage: `url(${cover})` }} /> : null}
      <div className="theater-wash" aria-hidden="true" />

      <div className="theater-inner">
        <header className="theater-top">
          <span className="theater-kicker">
            <i />
            сейчас играет
          </span>
          <button className="theater-close" onClick={p.onClose} title="Закрыть плеер (Esc)" aria-label="Закрыть плеер">
            <IconX width={18} height={18} />
          </button>
        </header>

        <div className="theater-main">
          <div className="theater-art-wrap">
            <div className={`theater-art${cover ? '' : ' empty'}`}>
              {cover ? <img src={cover} alt="" /> : <IconWave width={54} height={54} />}
            </div>
            <div className="theater-badges">
              {p.source ? <span className={`src-pill ${p.source}`}>{sourceShort(p.source)}</span> : null}
              {p.quality ? <span className="quality">{p.quality}</span> : null}
              {p.track.year ? <span className="year-pill">{p.track.year}</span> : null}
            </div>
          </div>

          <div className="theater-info">
            <h1 className="theater-title" title={p.track.title}>
              {p.track.title}
            </h1>
            <div className="theater-artist">
              <ArtistLine track={p.track} onOpenArtist={p.onOpenArtist} />
            </div>
            {p.track.album ? (
              <button
                className="theater-album"
                onClick={() =>
                  p.onOpenAlbum?.({
                    id: p.track.albumId,
                    title: p.track.album as string,
                    artist: p.track.artist,
                    trackTitle: p.track.title
                  })
                }
                disabled={!p.onOpenAlbum}
                title="Открыть альбом"
              >
                {p.track.album}
              </button>
            ) : null}
            {p.copyLabel ? <div className="theater-copy">{p.copyLabel}</div> : null}

            <div className="theater-scrub">
              <span>{fmtTime(progress)}</span>
              <div
                className={`bar${p.resolving ? ' loading' : ''}`}
                ref={scrubRef}
                onMouseDown={(e) => {
                  seekAt(e.clientX)
                  const move = (ev: MouseEvent) => seekAt(ev.clientX)
                  const up = () => {
                    window.removeEventListener('mousemove', move)
                    window.removeEventListener('mouseup', up)
                  }
                  window.addEventListener('mousemove', move)
                  window.addEventListener('mouseup', up)
                }}
              >
                <div className="bar-track">
                  <div className="bar-fill" style={{ width: `${pct}%` }} />
                </div>
              </div>
              <span>{fmtTime(duration)}</span>
            </div>

            <div className="theater-transport">
              <button className="theater-step" onClick={p.onPrev} title="Предыдущий">
                <IconPrev width={22} height={22} />
              </button>
              <button
                className="theater-play"
                onClick={p.onToggle}
                disabled={p.resolving}
                title={p.playing ? 'Пауза (Space)' : 'Играть (Space)'}
              >
                {p.resolving ? (
                  <span className="spinner" />
                ) : p.playing ? (
                  <IconPause width={26} height={26} />
                ) : (
                  <IconPlay width={26} height={26} />
                )}
              </button>
              <button className="theater-step" onClick={p.onNext} title="Следующий">
                <IconNext width={22} height={22} />
              </button>
            </div>

            <div className="theater-foot">
              <div className="theater-volume">
                <button
                  className="theater-step small"
                  onClick={() => p.onVolume(p.volume > 0 ? 0 : 0.85)}
                  title="Звук"
                >
                  {p.volume > 0 ? <IconVolume width={18} height={18} /> : <IconMute width={18} height={18} />}
                </button>
                <div
                  className="bar"
                  onMouseDown={(e) => {
                    const el = e.currentTarget
                    volumeAt(el, e.clientX)
                    const move = (ev: MouseEvent) => volumeAt(el, ev.clientX)
                    const up = () => {
                      window.removeEventListener('mousemove', move)
                      window.removeEventListener('mouseup', up)
                    }
                    window.addEventListener('mousemove', move)
                    window.addEventListener('mouseup', up)
                  }}
                >
                  <div className="bar-track">
                    <div className="bar-fill" style={{ width: `${p.volume * 100}%` }} />
                  </div>
                </div>
              </div>
            </div>
          </div>

        </div>

        {panel ? (
          <TheaterPanel
            mode={panel}
            track={p.track}
            versions={p.versions}
            copyLabel={p.copyLabel}
            queue={p.queue}
            queueIndex={p.queueIndex}
            queueShuffled={p.queueShuffled}
            playing={p.playing}
            onClose={closePanel}
            onSeek={p.onSeek}
            onPickVersion={p.onPickVersion}
            onAddVersion={p.onAddVersion}
            onRestoreOriginal={p.onRestoreOriginal}
            onQueuePlay={p.onQueuePlay}
            onQueueMove={p.onQueueMove}
            onQueueRemove={p.onQueueRemove}
            onQueueShuffle={p.onQueueShuffle}
            onQueueClear={p.onQueueClear}
          />
        ) : null}

        <nav className="theater-dock" aria-label="Действия и окна плеера">
          <div className="theater-dock-group">
            <button
              className={`theater-dock-btn${p.liked ? ' on like' : ''}`}
              onClick={p.onLike}
              title={p.liked ? 'Убрать из «Мне нравится»' : 'Мне нравится'}
              aria-pressed={p.liked}
            >
              <IconHeart width={17} height={17} filled={p.liked} />
              <span>{p.liked ? 'в избранном' : 'нравится'}</span>
            </button>
            <button
              className={`theater-dock-btn${savedLocal ? ' on' : ''}${saveProgress ? ' saving' : ''}`}
              onClick={() => {
                if (saveProgress) return
                if (savedLocal) void removeOffline(p.track.id).catch(() => undefined)
                else void saveTrack(p.track).catch(() => undefined)
              }}
              disabled={Boolean(saveProgress)}
              title={
                saveProgress
                  ? `Сохраняю… ${saveProgress.percent ?? 0}%`
                  : savedLocal
                    ? 'Удалить локальную копию'
                    : 'Сохранить трек локально'
              }
              aria-pressed={savedLocal}
            >
              {savedLocal ? <IconCheck width={17} height={17} /> : <IconDownload width={17} height={17} />}
              <span>{saveProgress ? `${saveProgress.percent ?? 0}%` : savedLocal ? 'сохранено' : 'сохранить'}</span>
            </button>
            <button
              className={`theater-dock-btn${p.normalize ? ' on' : ''}`}
              onClick={() => p.onNormalize(!p.normalize)}
              title="Выравнивание громкости"
              aria-pressed={p.normalize}
            >
              <span className="theater-dock-hq">HQ</span>
              <span>звук</span>
            </button>
          </div>

          <span className="theater-dock-sep" aria-hidden="true" />

          <div className="theater-dock-group">
            <button
              className={`theater-dock-btn${p.radioLoading ? ' busy' : ''}`}
              onClick={p.onRadio}
              disabled={p.radioLoading}
              title="Запустить радио по этому треку"
            >
              {p.radioLoading ? <span className="spinner" /> : <IconRadio width={17} height={17} />}
              <span>{p.radioLoading ? 'ищу…' : 'радио'}</span>
            </button>
            <button
              className="theater-dock-btn"
              onClick={p.onAddToPlaylist}
              title="Добавить трек в плейлист"
            >
              <IconListPlus width={17} height={17} />
              <span>в плейлист</span>
            </button>
          </div>

          <span className="theater-dock-sep" aria-hidden="true" />

          <div className="theater-dock-group">
            <button
              className={`theater-dock-btn dock-tab${panel === 'versions' ? ' on' : ''}`}
              onClick={p.onVersions}
              title="Другие версии трека"
              aria-pressed={panel === 'versions'}
            >
              <IconLayers width={17} height={17} />
              <span>версии</span>
            </button>
            {p.hasLyrics ? (
              <button
                className={`theater-dock-btn dock-tab${panel === 'lyrics' ? ' on' : ''}`}
                onClick={p.onToggleLyrics}
                title="Текст песни"
                aria-pressed={panel === 'lyrics'}
              >
                <IconText width={17} height={17} />
                <span>текст</span>
              </button>
            ) : null}
            <button
              className={`theater-dock-btn dock-tab${panel === 'queue' ? ' on' : ''}`}
              onClick={p.onToggleQueue}
              title="Очередь воспроизведения"
              aria-pressed={panel === 'queue'}
            >
              <IconQueue width={17} height={17} />
              <span>очередь</span>
            </button>
          </div>
        </nav>
      </div>
    </section>
  )
}
