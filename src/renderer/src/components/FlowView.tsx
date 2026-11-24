import { useEffect, useRef, useState } from 'react'
import type { Track } from '../types'
import { fmtTime } from './TrackList'
import { IconPause, IconPlay, IconWave } from './Icons'

interface Props {
  queue: Track[]
  index: number
  playing: boolean
  active: boolean
  loading: boolean
  onStart: (genre?: string) => void
  onPlay: (track: Track, list: Track[]) => void
  onToggle: () => void
  onArtistRadio: (name: string) => void
  radioLoading?: boolean
  onHover?: (track: Track) => void
  /** спектр текущего трека и его громкость 0…1 — для живой визуализации */
  getSpectrum?: () => Uint8Array | null
  getEnergy?: () => number
}

/** Аватар-заглушка для артиста без обложки: буква на градиенте по имени. */
function initialGradient(name: string): string {
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360
  return `linear-gradient(140deg, hsl(${h} 62% 32%), hsl(${(h + 48) % 360} 58% 22%))`
}

export default function FlowView({
  queue,
  index,
  playing,
  active,
  loading,
  onStart,
  onPlay,
  onToggle,
  onArtistRadio,
  radioLoading,
  onHover,
  getSpectrum,
  getEnergy
}: Props) {
  const [seeds, setSeeds] = useState<{ name: string; weight: number }[]>([])
  const [seedRefs, setSeedRefs] = useState<{ id?: string; name: string; coverUrl?: string }[]>([])
  const [genreList, setGenreList] = useState<{ id: string; name: string; artists: number }[]>([])
  const [genresLoading, setGenresLoading] = useState(true)
  /** выбранный жанр: только в памяти страницы, между запусками не помним */
  const [genre, setGenre] = useState<string | undefined>()

  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const [list, flow, genres] = await Promise.all([
          window.undertow.flowSeeds(),
          window.undertow.flowInfo(),
          window.undertow.flowGenres()
        ])
        if (!alive) return
        setSeeds(list)
        setSeedRefs(flow.seeds)
        setGenreList(genres.items)
        setGenre((prev) => prev ?? flow.genre)
      } catch {
        /* без библиотеки — пусто */
      } finally {
        if (alive) setGenresLoading(false)
      }
    })()
    return () => {
      alive = false
    }
  }, [active])

  const genreName = genreList.find((g) => g.id === genre)?.name
  const chooseGenre = (id?: string): void => {
    if (loading) return
    setGenre(id)
    onStart(id)
  }

  const alive = active && playing
  const heroRef = useRef<HTMLElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const spectrumRef = useRef(getSpectrum)
  spectrumRef.current = getSpectrum
  const energyRef = useRef(getEnergy)
  energyRef.current = getEnergy

  const current = active && index >= 0 ? queue[index] : undefined
  const upcoming = active && index >= 0 ? queue.slice(index + 1, index + 9) : []

  // Визуализация: пока поток играет, вокруг орбиты пляшут полосы спектра,
  // а --level «дышит» вместе с громкостью. В паузе — статичное кольцо точек.
  useEffect(() => {
    const canvas = canvasRef.current
    const hero = heroRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !hero || !ctx) return
    let raf = 0

    const paint = () => {
      raf = requestAnimationFrame(paint)
      const dpr = window.devicePixelRatio || 1
      const size = canvas.clientWidth || 188
      if (canvas.width !== Math.round(size * dpr)) {
        canvas.width = Math.round(size * dpr)
        canvas.height = Math.round(size * dpr)
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, size, size)
      const c = size / 2
      const level = alive ? Math.min(1, (energyRef.current?.() ?? 0) * 1.7) : 0
      hero.style.setProperty('--level', level.toFixed(3))

      const data = alive ? spectrumRef.current?.() : null
      if (!data) {
        ctx.fillStyle = 'rgba(124, 238, 230, 0.26)'
        for (let i = 0; i < 72; i++) {
          const a = (i / 72) * Math.PI * 2
          ctx.beginPath()
          ctx.arc(c + Math.cos(a) * size * 0.42, c + Math.sin(a) * size * 0.42, 1.3, 0, Math.PI * 2)
          ctx.fill()
        }
        return
      }

      const inner = size * 0.29
      // зеркалим спектр: круг получается симметричным и «цветёт» с обеих сторон
      const total = data.length * 2
      for (let i = 0; i < total; i++) {
        const v = data[i < data.length ? i : total - 1 - i] / 255
        if (v < 0.02) continue
        const a = (i / total) * Math.PI * 2 - Math.PI / 2
        const len = 4 + Math.pow(v, 1.35) * size * 0.2
        ctx.strokeStyle = `hsla(${165 + (i / total) * 110}, 95%, ${58 + v * 18}%, ${0.18 + v * 0.75})`
        ctx.lineWidth = Math.max(1.4, size * 0.0095)
        ctx.lineCap = 'round'
        ctx.beginPath()
        ctx.moveTo(c + Math.cos(a) * inner, c + Math.sin(a) * inner)
        ctx.lineTo(c + Math.cos(a) * (inner + len), c + Math.sin(a) * (inner + len))
        ctx.stroke()
      }

      const glow = ctx.createRadialGradient(c, c, 0, c, c, inner)
      glow.addColorStop(0, `rgba(124, 238, 230, ${0.08 + level * 0.2})`)
      glow.addColorStop(1, 'rgba(124, 238, 230, 0)')
      ctx.fillStyle = glow
      ctx.beginPath()
      ctx.arc(c, c, inner, 0, Math.PI * 2)
      ctx.fill()
    }

    paint()
    return () => cancelAnimationFrame(raf)
  }, [alive])

  return (
    <div className={`scroll flow-page${alive ? ' live' : ''}`}>
      <section className={`flow-hero fade-up${alive ? ' live' : ''}`} ref={heroRef}>
        <div className="flow-glow" aria-hidden="true" />
        <div className="flow-hero-text">
          <span className="flow-kicker">поток без конца</span>
          <h1 className="flow-title">Течение</h1>
          <p className="flow-lead">
            Любимые артисты, их соседи и соседи соседей — по кругу. Течение не заканчивается:
            запас пополняется сам, пока играет музыка, а треки из вашей библиотеки туда почти
            не попадают.
          </p>

          <div className="flow-genres" role="group" aria-label="Жанр течения">
            {genresLoading && !genreList.length ? (
              <>
                <span className="flow-genre skeleton" />
                <span className="flow-genre skeleton" />
                <span className="flow-genre skeleton" />
              </>
            ) : (
              <>
                <button
                  className={`flow-genre${genre ? '' : ' on'}`}
                  onClick={() => chooseGenre(undefined)}
                  disabled={loading}
                >
                  всё
                </button>
                {genreList.map((g) => (
                  <button
                    key={g.id}
                    className={`flow-genre${genre === g.id ? ' on' : ''}`}
                    onClick={() => chooseGenre(g.id)}
                    disabled={loading}
                    title={`${g.artists} артистов в библиотеке`}
                  >
                    {g.name}
                    <i>{g.artists}</i>
                  </button>
                ))}
              </>
            )}
          </div>

          <div className="flow-actions">
            <button className="play-btn" onClick={() => onStart(genre)} disabled={loading}>
              <IconPlay width={15} height={15} />
              {loading ? 'собираю…' : active ? 'Собрать заново' : 'Запустить'}
            </button>
            {active ? (
              <span className="flow-live">
                <span className="flow-dot" />
                {playing ? 'звучит' : 'на паузе'}
              </span>
            ) : null}
            <span className="flow-hint">30 треков сразу — дальше само</span>
          </div>
        </div>
        <div className="flow-orb" aria-hidden="true">
          <canvas className="flow-canvas" ref={canvasRef} />
          <span className="flow-orb-ring" />
          <span className="flow-orb-ring slow" />
          <IconWave width={34} height={34} />
        </div>
      </section>

      {active && current ? (
        <section className="flow-live-block fade-up">
          <div className="flow-now">
            {current.coverUrl ? <img className="flow-now-cover" src={current.coverUrl} alt="" /> : <div className="flow-now-cover" />}
            <div className="flow-now-meta">
              <span className="flow-now-label">
                сейчас играет
                {genreName ? <span className="flow-genre-tag"> · {genreName}</span> : null}
              </span>
              <div className="flow-now-title">{current.title}</div>
              <div className="flow-now-artist">
                {current.artist}
                {current.year ? <span className="track-year inline">{current.year}</span> : null}
              </div>
            </div>
            <button className="flow-now-toggle" onClick={onToggle} title={playing ? 'Пауза' : 'Играть'}>
              {playing ? <IconPause width={16} height={16} /> : <IconPlay width={16} height={16} />}
            </button>
          </div>

          <div className="flow-next">
            <div className="flow-next-head">
              <span>дальше</span>
              <span className="flow-next-count">ещё {Math.max(0, queue.length - index - 1)}</span>
            </div>
            {upcoming.map((t, i) => (
              <button
                key={`${t.id}-${i}`}
                className="flow-next-row"
                onClick={() => onPlay(t, queue)}
                onMouseEnter={() => onHover?.(t)}
              >
                <span className="flow-next-i">{i + 1}</span>
                {t.coverUrl ? <img src={t.coverUrl} alt="" loading="lazy" /> : <span className="flow-next-img" />}
                <span className="flow-next-names">
                  <b>{t.title}</b>
                  <i>
                    {t.artist}
                    {t.year ? ` · ${t.year}` : ''}
                  </i>
                </span>
                <span className="flow-next-time">{t.durationSec ? fmtTime(t.durationSec) : ''}</span>
              </button>
            ))}
            {!upcoming.length ? (
              <div className="flow-next-empty">Подтягиваю ещё…</div>
            ) : null}
          </div>
        </section>
      ) : (
        <section className="flow-idle fade-up">
          <div className="flow-idle-art">
            <IconWave width={26} height={26} />
          </div>
          <div>
            <b>Течение пока стоит</b>
            <p>
              Включите — и пойдёт поток из артистов, которых вы слушаете, и похожих на них.
              Треки, которые уже есть в библиотеке, туда почти не попадают.
            </p>
          </div>
        </section>
      )}

      <section className="section fade-up">
        <div className="section-head">
          <div className="section-title">
            <div>
              <h2>Из чего течёт</h2>
              <div className="section-sub">нажмите на артиста — включится его радио</div>
            </div>
          </div>
          <div className="section-tools">
            <span className="count">{seeds.length ? `${seeds.length} артистов` : 'пусто'}</span>
          </div>
        </div>
        {seeds.length ? (
          <div className="seed-grid">
            {seeds.map((s) => {
              const ref = seedRefs.find((r) => r.name.toLowerCase() === s.name.toLowerCase())
              return (
                <button
                  key={s.name}
                  className="seed-card"
                  onClick={() => onArtistRadio(s.name)}
                  disabled={radioLoading}
                  title={`Радио ${s.name}`}
                >
                  {ref?.coverUrl ? (
                    <img className="seed-avatar" src={ref.coverUrl} alt="" loading="lazy" />
                  ) : (
                    <span className="seed-avatar letter" style={{ background: initialGradient(s.name) }}>
                      {s.name.slice(0, 1).toUpperCase()}
                    </span>
                  )}
                  <span className="seed-name">{s.name}</span>
                  <span className="seed-sub">радио →</span>
                </button>
              )
            })}
          </div>
        ) : (
          <div className="empty">
            <b>Пока не из чего течь</b>
            Поставьте лайки нескольким трекам — и течение соберётся.
          </div>
        )}
      </section>

      <p className="flow-note">
        Свои треки тоже иногда всплывают — примерно один на двадцать, чтобы знакомое не
        вытесняло новое.
      </p>
    </div>
  )
}
