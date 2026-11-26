import { useEffect, useRef, useState, type CSSProperties } from 'react'
import type { Track, TrackVersion } from '../types'
import type { RepeatMode } from '../audio/engine'
import { fmtTime } from './TrackList'
import { useProgress } from '../audio/progress'
import ArtistLine from './ArtistLine'
import { usePanelOrigin } from './usePanelOrigin'
import { removeOffline, saveTrack, useOffline } from '../offline'
import {
  IconCheck,
  IconDownload,
  IconExpand,
  IconHeart,
  IconLayers,
  IconListPlus,
  IconMute,
  IconNext,
  IconPause,
  IconPlus,
  IconPlay,
  IconPrev,
  IconQueue,
  IconRadio,
  IconRepeat,
  IconSearch,
  IconShuffle,
  IconText,
  IconVolume,
  IconWave,
  IconX
} from './Icons'

interface Props {
  track: Track | null
  playing: boolean
  resolving: boolean
  progress: number
  duration: number
  volume: number
  quality: string | null
  source: 'yandex' | 'youtube' | 'local' | null
  /** название играющей копии, если она отличается от трека в очереди */
  copyLabel: string | null
  versions: { loading: boolean; list: TrackVersion[] } | null
  onVersions: () => void
  onPickVersion: (v: TrackVersion) => void
  onAddVersion: (v: TrackVersion) => void
  onRestoreOriginal: () => void
  onOpenArtist?: (target: { id?: string; name: string }) => void
  onOpenAlbum?: (target: { id?: string; title: string; artist?: string; trackTitle?: string }) => void
  queueCount: number
  queueOpen: boolean
  onToggleQueue: () => void
  shuffled: boolean
  onShuffle: (on: boolean) => void
  repeat: RepeatMode
  onCycleRepeat: () => void
  lyricsOpen: boolean
  onToggleLyrics: () => void
  /** слова реально нашлись — иначе кнопку не показываем */
  hasLyrics: boolean
  onRadio: () => void
  radioLoading?: boolean
  onAddToPlaylist: () => void
  /** RMS текущего трека 0…1 — «дыхание» подсветки */
  level?: number
  normalize: boolean
  onNormalize: (v: boolean) => void
  liked: boolean
  onLike: () => void
  onToggle: () => void
  onNext: () => void
  onPrev: () => void
  onSeek: (sec: number) => void
  onVolume: (v: number) => void
  /** открыть полноэкранный плеер */
  onExpand: () => void
  /** перейти в поиск, когда очередь пуста */
  onFindMusic: () => void
}

export default function PlayerBar(p: Props) {
  const progressRef = useRef<HTMLDivElement>(null)
  const versionsRef = useRef<HTMLDivElement>(null)
  const [filter, setFilter] = useState<string | null>(null)
  const [hover, setHover] = useState<{ x: number; sec: number } | null>(null)
  const offline = useOffline()
  const saveProgress = p.track ? offline.progress[p.track.id] : undefined
  const savedLocal = p.track ? offline.ids.has(p.track.id) : false
  usePanelOrigin(versionsRef, '.alt-btn', Boolean(p.versions))

  // список версий сменился (другой трек или новая загрузка) — фильтр сбрасываем
  useEffect(() => setFilter(null), [p.versions, p.track?.id])

  const counts = new Map<string, number>()
  for (const v of p.versions?.list ?? []) counts.set(v.label, (counts.get(v.label) ?? 0) + 1)
  const chips = [...counts.entries()].sort((a, b) => b[1] - a[1])
  const shown = (p.versions?.list ?? []).filter((v) => !filter || v.label === filter)
  // время приходит из отдельного стора: App не перерисовывается на каждом тике
  const live = useProgress()
  const progress = p.track ? live.time : p.progress
  const duration = live.duration || p.duration
  const pct = duration > 0 ? Math.min(100, (progress / duration) * 100) : 0

  const seekAt = (clientX: number) => {
    const el = progressRef.current
    if (!el || duration <= 0) return
    const r = el.getBoundingClientRect()
    const ratio = Math.min(1, Math.max(0, (clientX - r.left) / r.width))
    p.onSeek(ratio * duration)
  }

  const hoverAt = (clientX: number) => {
    const el = progressRef.current
    if (!el || duration <= 0) return
    const r = el.getBoundingClientRect()
    const ratio = Math.min(1, Math.max(0, (clientX - r.left) / r.width))
    // подсказку не даём уезжать за края панели
    setHover({ x: Math.min(Math.max(ratio * r.width, 38), r.width - 38), sec: ratio * duration })
  }

  if (!p.track) {
    return (
      <footer className="player idle player-empty">
        <div className="empty-player">
          <span className="empty-player-mark" aria-hidden="true">
            <span className="idle-bars">
              <i />
              <i />
              <i />
              <i />
              <i />
              <i />
              <i />
            </span>
          </span>
          <div className="empty-player-copy">
            <b>Ничего не играет</b>
            <span>Выбери трек на главной или найди его в поиске</span>
          </div>
          <span className="empty-player-state">очередь пуста</span>
          <button className="empty-player-find" onClick={p.onFindMusic}>
            <IconSearch width={15} height={15} />
            Найти трек
          </button>
        </div>
      </footer>
    )
  }

  return (
    <footer
      className={`player${p.track && p.playing ? ' playing' : ''}${!p.track ? ' idle' : ''}${
        p.track && !p.playing ? ' paused' : ''
      }`}
      style={{ '--rms': Math.min(1, Math.max(0, p.level ?? live.rms)).toFixed(3) } as CSSProperties}
      onClick={(e) => {
        if (!p.track) return
        const el = e.target as HTMLElement
        if (el.closest('button, a, input, .bar, .player-progress, .vol-bar, .player-tools, .alt-menu')) return
        p.onExpand()
      }}
    >
      <div
        className={`player-progress${!p.track ? ' idle' : ''}${p.resolving ? ' loading' : ''}`}
        ref={progressRef}
        role="slider"
        aria-label="Прогресс трека"
        aria-valuemin={0}
        aria-valuemax={Math.round(duration)}
        aria-valuenow={Math.round(progress)}
        tabIndex={p.track ? 0 : -1}
        onKeyDown={(e) => {
          if (!p.track || duration <= 0) return
          if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
            e.preventDefault()
            const delta = e.key === 'ArrowLeft' ? -5 : 5
            p.onSeek(Math.min(duration, Math.max(0, progress + delta)))
          }
        }}
        onMouseMove={(e) => hoverAt(e.clientX)}
        onMouseLeave={() => setHover(null)}
        onMouseDown={(e) => {
          if (!p.track || duration <= 0) return
          seekAt(e.clientX)
          const move = (ev: MouseEvent) => {
            seekAt(ev.clientX)
            hoverAt(ev.clientX)
          }
          const up = () => {
            window.removeEventListener('mousemove', move)
            window.removeEventListener('mouseup', up)
          }
          window.addEventListener('mousemove', move)
          window.addEventListener('mouseup', up)
        }}
      >
        <div className="player-progress-track">
          <div className="player-progress-fill" style={{ width: `${pct}%` }} />
        </div>
        {hover && p.track ? (
          <span className="player-progress-tip" style={{ left: `${hover.x}px` }}>
            {fmtTime(hover.sec)} <i>/</i> {fmtTime(duration)}
          </span>
        ) : null}
      </div>

      <div className={`now${p.track ? '' : ' now-empty'}`}>
        <button
          className="now-media"
          onClick={() => p.track && p.onExpand()}
          disabled={!p.track}
          title={p.track ? 'Открыть плеер' : undefined}
          aria-label="Открыть плеер"
          aria-haspopup="dialog"
        >
          {p.track?.coverUrl ? (
            <img className="now-cover" src={p.track.coverUrl} alt="" />
          ) : (
            <span className="now-cover idle-cover" aria-hidden="true">
              <IconWave width={24} height={24} />
            </span>
          )}
          <span className={`now-eq${p.track && p.playing ? ' on' : ''}`} aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          {p.track ? (
            <span className="now-expand" aria-hidden="true">
              <IconExpand width={17} height={17} />
            </span>
          ) : null}
        </button>
        <div className="now-text">
          <div className="now-title-row">
            <span className="now-title-wrap" data-full={p.track?.title ?? 'Ничего не играет'}>
              <span className="now-title">{p.track?.title ?? 'Ничего не играет'}</span>
            </span>
            {p.track ? (
              <>
                {p.source && (
                  <span
                    className={`src-pill ${p.source}`}
                    title={
                      p.source === 'yandex'
                        ? 'Играет с Яндекс.Музыки'
                        : p.source === 'local'
                          ? 'Играет локальная копия'
                          : 'Играет с YouTube'
                    }
                  >
                    {p.source === 'yandex' ? 'YM' : p.source === 'local' ? 'LOCAL' : 'YT'}
                  </span>
                )}
                {p.quality && (
                  <span className="quality" title="Формат и битрейт текущего потока">
                    {p.quality}
                  </span>
                )}
                {p.track.year ? (
                  <span className="year-pill" title="Год выпуска">
                    {p.track.year}
                  </span>
                ) : null}
              </>
            ) : null}
          </div>
          <div className="now-artist">
            {p.track ? (
              <>
                <ArtistLine track={p.track} onOpenArtist={p.onOpenArtist} />
                {p.track.album && p.onOpenAlbum ? (
                  <>
                    <span className="now-sep"> · </span>
                    <button
                      className="artist-link"
                      title={`Открыть альбом: ${p.track.album}`}
                      onClick={() =>
                        p.onOpenAlbum?.({
                          id: p.track?.albumId,
                          title: p.track?.album as string,
                          artist: p.track?.artist,
                          trackTitle: p.track?.title
                        })
                      }
                    >
                      {p.track.album}
                    </button>
                  </>
                ) : null}
              </>
            ) : (
              'Выбери трек на главной или найди его в поиске'
            )}
          </div>
          {p.track && p.copyLabel ? (
            <div className="now-copy" title={p.copyLabel}>
              {p.copyLabel}
            </div>
          ) : null}
        </div>
        <span className="player-divider now-divider" aria-hidden="true" />
        <div className="now-actions">
          <button
            className={`tbtn like-tbtn${p.liked ? ' on' : ''}`}
            onClick={p.onLike}
            disabled={!p.track}
            title={p.liked ? 'Убрать из «Мне нравится»' : 'Мне нравится'}
            aria-pressed={p.liked}
          >
            <IconHeart width={15} height={15} filled={p.liked} />
          </button>
          {p.track ? (
            <button
              className={`tbtn save-tbtn${savedLocal ? ' on' : ''}${saveProgress ? ' saving' : ''}`}
              onClick={() => {
                if (!p.track || saveProgress) return
                if (savedLocal) void removeOffline(p.track.id).catch(() => undefined)
                else void saveTrack(p.track).catch(() => undefined)
              }}
              disabled={!p.track || Boolean(saveProgress)}
              title={
                saveProgress
                  ? `Сохраняю… ${saveProgress.percent ?? 0}%`
                  : savedLocal
                    ? 'Удалить локальную копию'
                    : 'Сохранить трек локально'
              }
              aria-pressed={savedLocal}
            >
              {savedLocal ? <IconCheck width={15} height={15} /> : <IconDownload width={15} height={15} />}
              {saveProgress?.percent != null ? (
                <span className="save-percent">{saveProgress.percent}%</span>
              ) : null}
            </button>
          ) : null}
        </div>
      </div>

      <div className="transport">
        <div className="transport-row">
          <button
            className={`tbtn edge${p.shuffled ? ' on' : ''}`}
            onClick={() => p.onShuffle(!p.shuffled)}
            disabled={p.queueCount < 2}
            title={p.shuffled ? 'Перемешивание включено' : 'Перемешать очередь'}
            aria-pressed={p.shuffled}
          >
            <IconShuffle width={15} height={15} />
          </button>
          <button className="tbtn" onClick={p.onPrev} disabled={!p.track} title="Предыдущий">
            <IconPrev />
          </button>
          <button
            className="tbtn main"
            onClick={p.onToggle}
            disabled={!p.track || p.resolving}
            title={p.playing ? 'Пауза (Space)' : 'Играть (Space)'}
          >
            {p.resolving ? <span className="spinner" /> : p.playing ? <IconPause /> : <IconPlay />}
          </button>
          <button className="tbtn" onClick={p.onNext} disabled={!p.track} title="Следующий">
            <IconNext />
          </button>
          <button
            className={`tbtn edge repeat-btn${p.repeat !== 'off' ? ' on' : ''}`}
            onClick={p.onCycleRepeat}
            disabled={!p.track}
            title={
              p.repeat === 'all'
                ? 'Повтор всей очереди — включить повтор текущего трека'
                : p.repeat === 'one'
                  ? 'Повтор текущего трека — выключить'
                  : 'Повтор выключен — включить повтор всей очереди'
            }
            aria-label="Повтор"
            aria-pressed={p.repeat !== 'off'}
          >
            <IconRepeat width={17} height={17} />
            {p.repeat === 'one' ? <span className="repeat-one">1</span> : null}
          </button>
        </div>

        {!p.track ? (
          <div className="idle-strip" aria-hidden="true">
            <span className="idle-bars">
              <i />
              <i />
              <i />
              <i />
              <i />
              <i />
              <i />
            </span>
            <span>выбери трек — и волна подхватит</span>
          </div>
        ) : null}
      </div>
      <div className="player-right">
        {p.track ? (
          <div className="player-tools">
          {p.track && p.hasLyrics ? (
            <button
              className={`tool-btn${p.lyricsOpen ? ' open' : ''}`}
              onClick={p.onToggleLyrics}
              title="Текст песни (LRCLIB)"
              aria-label="Текст песни"
              aria-pressed={p.lyricsOpen}
            >
              <IconText width={14} height={14} />
            </button>
          ) : null}
          {p.track ? (
            <div className="alt-wrap">
              <button
                className={`tool-btn alt-btn${p.versions ? ' open' : ''}`}
                onClick={p.onVersions}
                title="Другие версии: ремиксы, каверы, оркестр…"
                aria-label="Другие версии"
                aria-expanded={Boolean(p.versions)}
              >
                <IconLayers width={14} height={14} />
                {p.versions?.list.length ? (
                  <span className="tool-count">{p.versions.list.length}</span>
                ) : null}
              </button>
            {p.versions ? (
              <div className="alt-menu versions-menu" ref={versionsRef}>
                <div className="alt-head">
                  <span className={`panel-art${p.track.coverUrl ? '' : ' empty'}`}>
                    {p.track.coverUrl ? (
                      <img src={p.track.coverUrl} alt="" />
                    ) : (
                      <IconLayers width={18} height={18} />
                    )}
                  </span>
                  <div className="panel-head-text">
                    <span className="panel-kicker">
                      Версии трека
                      <span className="panel-bars" aria-hidden="true">
                        <i />
                        <i />
                        <i />
                      </span>
                    </span>
                    <b>{p.track.title}</b>
                    <span>
                      {p.track.artist} ·{' '}
                      {p.versions.loading ? 'ищу варианты…' : `всего ${p.versions.list.length}`}
                    </span>
                  </div>
                  <button className="icon-btn" onClick={p.onVersions} title="Закрыть версии">
                    <IconX width={14} height={14} />
                  </button>
                </div>
                <div className="alt-body">
                {p.copyLabel ? (
                  <button className="alt-item alt-restore" onClick={p.onRestoreOriginal}>
                    <span className="alt-title">↩ вернуть исходную запись</span>
                    <span className="alt-meta">играть оригинал из источника, а не копию</span>
                  </button>
                ) : null}
                {p.versions.loading ? (
                  <div className="alt-empty">
                    <span className="spinner" /> ищу ремиксы и каверы…
                  </div>
                ) : p.versions.list.length === 0 ? (
                  <div className="alt-empty">Других версий не нашлось</div>
                ) : (
                  <>
                    <div className="alt-chips">
                      <button
                        className={`alt-chip${filter ? '' : ' on'}`}
                        onClick={() => setFilter(null)}
                      >
                        все <i>{p.versions.list.length}</i>
                      </button>
                      {chips.map(([label, n]) => (
                        <button
                          key={label}
                          className={`alt-chip${filter === label ? ' on' : ''}`}
                          onClick={() => setFilter(filter === label ? null : label)}
                        >
                          {label} <i>{n}</i>
                        </button>
                      ))}
                    </div>
                    {shown.length === 0 ? (
                      <div className="alt-empty">
                        В этой категории пусто —{' '}
                        <button className="alt-link" onClick={() => setFilter(null)}>
                          показать все
                        </button>
                      </div>
                    ) : (
                      shown.map((v) => (
                        <div key={v.videoId} className="alt-version-row">
                          <button className="alt-main" onClick={() => p.onPickVersion(v)}>
                            <span className="alt-title">{v.title}</span>
                            <span className="alt-meta">
                              <span className="version-tag">{v.label}</span>
                              {v.channel} · {fmtTime(v.durationSec ?? 0)}
                            </span>
                          </button>
                          <button
                            className="alt-add"
                            onClick={() => p.onAddVersion(v)}
                            title="Добавить версию в очередь"
                          >
                            <IconPlus width={13} height={13} />
                          </button>
                        </div>
                      ))
                    )}
                  </>
                )}
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
          <button
            className={`tool-btn radio-btn${p.radioLoading ? ' busy' : ''}`}
            onClick={p.onRadio}
            disabled={p.radioLoading || !p.track}
            title={p.radioLoading ? 'Ищу похожие треки…' : 'Радио по этому треку'}
            aria-label="Радио по этому треку"
          >
            {p.radioLoading ? <span className="spinner" /> : <IconRadio width={14} height={14} />}
          </button>
          <button
            className="tool-btn"
            onClick={p.onAddToPlaylist}
            title="Добавить трек в плейлист"
            aria-label="Добавить в плейлист"
          >
            <IconListPlus width={14} height={14} />
          </button>
          <span className="tool-sep" aria-hidden="true" />
          <button
            className={`tool-btn norm-btn${p.normalize ? ' on' : ''}`}
            onClick={() => p.onNormalize(!p.normalize)}
            title={
              p.normalize
                ? 'HQ: выравнивание громкости включено — нажми, чтобы выключить'
                : 'HQ: выравнивание громкости выключено — нажми, чтобы включить'
            }
            aria-pressed={p.normalize}
          >
            HQ
          </button>
          <button
            className={`tool-btn queue-btn${p.queueOpen ? ' open' : ''}`}
            onClick={p.onToggleQueue}
            title="Очередь воспроизведения"
            aria-pressed={p.queueOpen}
          >
            <IconQueue width={15} height={15} />
            {p.queueCount > 0 ? <span className="queue-btn-count">{p.queueCount}</span> : null}
          </button>
          </div>
        ) : null}
        {p.track ? <span className="player-divider" /> : null}
        <div className="volume">
          <button className="icon-btn" onClick={() => p.onVolume(p.volume > 0 ? 0 : 0.85)} title="Звук">
            {p.volume > 0 ? <IconVolume /> : <IconMute />}
          </button>
          <div
            className="bar vol-bar"
            onMouseDown={(e) => {
              const el = e.currentTarget
              const set = (clientX: number) => {
                const r = el.getBoundingClientRect()
                p.onVolume(Math.min(1, Math.max(0, (clientX - r.left) / r.width)))
              }
              set(e.clientX)
              const move = (ev: MouseEvent) => set(ev.clientX)
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
    </footer>
  )
}
