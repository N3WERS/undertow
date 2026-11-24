import { useEffect, useState } from 'react'
import type { Track } from '../types'
import { fmtTime } from './TrackList'
import { IconPause, IconPlay, IconWave } from './Icons'
import TopoField from './TopoField'

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
  onHover
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
        // приоритет: выбор в этой сессии → жанр активного потока → сохранённый
        setGenre((prev) => {
          const candidate = prev ?? flow.genre ?? genres.genre
          return candidate && genres.items.some((g) => g.id === candidate) ? candidate : undefined
        })
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
  const current = active && index >= 0 ? queue[index] : undefined
  const upcoming = active && index >= 0 ? queue.slice(index + 1, index + 9) : []

  return (
    <div className={`scroll flow-page${alive ? ' live' : ''}`}>
      <section className={`flow-hero fade-up${alive ? ' live' : ''}`}>
        <TopoField started={active} playing={alive} />
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
          </div>
        </div>
      </section>

      {active && current ? (
        <section className="flow-live-block fade-up">
          <div className="flow-now surface-hero surface-deep">
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

          <div className="flow-next surface-hero surface-deep">
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
