import { useEffect, useRef, useState, type CSSProperties } from 'react'
import type { Track, TrackVersion } from '../types'
import { fmtTime } from './TrackList'
import { useProgress } from '../audio/progress'
import ArtistLine from './ArtistLine'
import { usePanelOrigin } from './usePanelOrigin'
import {
  IconHeart,
  IconLayers,
  IconMute,
  IconNext,
  IconPause,
  IconPlus,
  IconPlay,
  IconPrev,
  IconQueue,
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
  source: 'yandex' | 'youtube' | null
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
  lyricsOpen: boolean
  onToggleLyrics: () => void
  /** слова реально нашлись — иначе кнопку не показываем */
  hasLyrics: boolean
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
}

export default function PlayerBar(p: Props) {
  const barRef = useRef<HTMLDivElement>(null)
  const versionsRef = useRef<HTMLDivElement>(null)
  const [filter, setFilter] = useState<string | null>(null)
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
    const el = barRef.current
    if (!el || duration <= 0) return
    const r = el.getBoundingClientRect()
    const ratio = Math.min(1, Math.max(0, (clientX - r.left) / r.width))
    p.onSeek(ratio * duration)
  }

  return (
    <footer
      className={`player${p.track && p.playing ? ' playing' : ''}${!p.track ? ' idle' : ''}${
        p.track && !p.playing ? ' paused' : ''
      }`}
      style={{ '--rms': Math.min(1, Math.max(0, p.level ?? live.rms)).toFixed(3) } as CSSProperties}
    >
      <div className={`now${p.track ? '' : ' now-empty'}`}>
        <div className="now-media">
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
        </div>
        <div className="now-text">
          <div className="now-title-row">
            <span className="now-title">{p.track?.title ?? 'Ничего не играет'}</span>
            {p.track ? (
              <>
                <button
                  className={`like-btn hero-like${p.liked ? ' on' : ''}`}
                  onClick={p.onLike}
                  title={p.liked ? 'Убрать из «Мне нравится»' : 'Мне нравится'}
                  aria-pressed={p.liked}
                >
                  <IconHeart width={15} height={15} filled={p.liked} />
                </button>
                {p.source && (
                  <span
                    className={`src-pill ${p.source}`}
                    title={p.source === 'yandex' ? 'Играет с Яндекс.Музыки' : 'Играет с YouTube'}
                  >
                    {p.source === 'yandex' ? 'YM' : 'YT'}
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
      </div>

      <div className="transport">
        <div className="transport-row">
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
        ) : (
        <div className="scrub">
          <span>{fmtTime(progress)}</span>
          <div
            className={`bar${p.resolving ? ' loading' : ''}`}
            ref={barRef}
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
        )}
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
