import { useEffect, useState, type CSSProperties } from 'react'
import type { FlowInfo, FlowOptions, FlowRoute, FlowStats, Track } from '../types'
import { fmtTime } from './TrackList'
import { IconCheck, IconPause, IconPlay, IconPlus, IconRefresh, IconWave, IconX } from './Icons'
import TopoField from './TopoField'

interface Props {
  queue: Track[]
  index: number
  playing: boolean
  active: boolean
  loading: boolean
  onStart: (options?: FlowOptions) => void
  onPlayFlow: (track: Track, list: Track[]) => void
  onToggle: () => void
  onArtistRadio: (name: string) => void
  onFeedback: (action: 'more' | 'less' | 'skipArtist', track: Track) => Promise<void>
  onSave?: () => void
  saving?: boolean
  onToast?: (text: string, kind?: 'info' | 'error') => void
  radioLoading?: boolean
  onHover?: (track: Track) => void
}

interface Prefs {
  genres: string[]
  excludeGenres: string[]
  novelty: number
  includeSeeds: string[]
  excludeSeeds: string[]
}

const DEFAULT_PREFS: Prefs = {
  genres: [],
  excludeGenres: [],
  novelty: 55,
  includeSeeds: [],
  excludeSeeds: []
}

const PREFS_KEY = 'undertow.flowOptions'

function loadPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY)
    if (!raw) return { ...DEFAULT_PREFS }
    const parsed = JSON.parse(raw) as Partial<Prefs>
    return {
      genres: Array.isArray(parsed.genres) ? parsed.genres.filter(Boolean) : [],
      excludeGenres: Array.isArray(parsed.excludeGenres) ? parsed.excludeGenres.filter(Boolean) : [],
      novelty: Number.isFinite(parsed.novelty) ? Math.max(0, Math.min(100, Number(parsed.novelty))) : 55,
      includeSeeds: Array.isArray(parsed.includeSeeds) ? parsed.includeSeeds.filter(Boolean) : [],
      excludeSeeds: Array.isArray(parsed.excludeSeeds) ? parsed.excludeSeeds.filter(Boolean) : []
    }
  } catch {
    return { ...DEFAULT_PREFS }
  }
}

/** Аватар-заглушка для артиста без обложки: буква на градиенте по имени. */
function initialGradient(name: string): string {
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360
  return `linear-gradient(140deg, hsl(${h} 62% 32%), hsl(${(h + 48) % 360} 58% 22%))`
}

function plural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return one
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few
  return many
}

function unique(list: string[]): string[] {
  const seen = new Set<string>()
  return list.filter((x) => {
    const key = x.trim().toLowerCase()
    if (!key || seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export default function FlowView({
  queue,
  index,
  playing,
  active,
  loading,
  onStart,
  onPlayFlow,
  onToggle,
  onArtistRadio,
  onFeedback,
  onSave,
  saving,
  onToast,
  radioLoading,
  onHover
}: Props) {
  const [seeds, setSeeds] = useState<{ name: string; weight: number }[]>([])
  const [seedRefs, setSeedRefs] = useState<{ id?: string; name: string; coverUrl?: string; weight?: number }[]>([])
  const [genreList, setGenreList] = useState<{ id: string; name: string; artists: number }[]>([])
  const [genresLoading, setGenresLoading] = useState(true)
  const [prefs, setPrefs] = useState<Prefs>(() => loadPrefs())
  const [genreMode, setGenreMode] = useState<'include' | 'exclude'>('include')
  const [seedQuery, setSeedQuery] = useState('')
  const [seedResults, setSeedResults] = useState<{ id?: string; name: string; coverUrl?: string }[]>([])
  const [seedSearchBusy, setSeedSearchBusy] = useState(false)
  const [seedBusy, setSeedBusy] = useState<string | null>(null)
  const [feedbackBusy, setFeedbackBusy] = useState(false)
  const [routes, setRoutes] = useState<Record<string, FlowRoute>>({})
  const [stats, setStats] = useState<FlowStats | null>(null)
  const [discoveries, setDiscoveries] = useState<{ name: string; coverUrl?: string; at: number }[]>([])

  const alive = active && playing
  const current = active && index >= 0 ? queue[index] : undefined

  useEffect(() => {
    if (!active) return
    let mounted = true
    void window.undertow
      .flowDiscoveries()
      .then((list) => {
        if (mounted) setDiscoveries(list)
      })
      .catch(() => undefined)
    return () => {
      mounted = false
    }
  }, [active, stats?.tracks])
  const upcoming = active && index >= 0 ? queue.slice(index + 1, index + 9) : []
  const route = current && routes ? routes[current.id] : undefined

  const applyInfo = (info: FlowInfo | null | undefined) => {
    if (!info) return
    setSeedRefs(info.seeds ?? [])
    setRoutes(info.routes ?? {})
    setStats(info.stats ?? null)
  }

  useEffect(() => {
    let aliveFetch = true
    void (async () => {
      try {
        const [list, flow, genres] = await Promise.all([
          window.undertow.flowSeeds(),
          window.undertow.flowInfo(),
          window.undertow.flowGenres()
        ])
        if (!aliveFetch) return
        setSeeds(list)
        setSeedRefs(flow?.seeds ?? [])
        setGenreList(genres?.items ?? [])
        setRoutes(flow?.routes ?? {})
        setStats(flow?.stats ?? null)
        if (flow?.active) {
          setPrefs((prev) => ({
            ...prev,
            genres: flow?.genres ?? [],
            excludeGenres: flow?.excludeGenres ?? [],
            novelty: flow?.novelty ?? prev.novelty
          }))
        }
      } catch {
        /* без библиотеки — пусто */
      } finally {
        if (aliveFetch) setGenresLoading(false)
      }
    })()
    return () => {
      aliveFetch = false
    }
  }, [active])

  // маршрут и статистику обновляем при каждом новом треке
  useEffect(() => {
    if (!active) return
    let aliveFetch = true
    const refresh = () => {
      void window.undertow
        .flowInfo()
        .then((info) => {
          if (aliveFetch) applyInfo(info)
        })
        .catch(() => undefined)
    }
    refresh()
    // статистика пополняется после фактического старта трека — обновляем
    // её не на каждом тике, а редким опросом, пока течение живо
    const timer = window.setInterval(refresh, 7000)
    return () => {
      aliveFetch = false
      window.clearInterval(timer)
    }
  }, [active, current?.id])

  useEffect(() => {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(prefs))
    } catch {
      /* приватный режим — настройки не запомнятся */
    }
  }, [prefs])

  const selectedGenres = new Set(prefs.genres)
  const excludedGenres = new Set(prefs.excludeGenres)


  const toggleGenre = (id: string) => {
    setPrefs((prev) => {
      if (genreMode === 'include') {
        const on = prev.genres.includes(id)
        return {
          ...prev,
          genres: on ? prev.genres.filter((x) => x !== id) : [...prev.genres, id],
          excludeGenres: prev.excludeGenres.filter((x) => x !== id)
        }
      }
      const on = prev.excludeGenres.includes(id)
      return {
        ...prev,
        excludeGenres: on ? prev.excludeGenres.filter((x) => x !== id) : [...prev.excludeGenres, id],
        genres: prev.genres.filter((x) => x !== id)
      }
    })
  }

  const setNovelty = (value: number) => {
    setPrefs((prev) => ({ ...prev, novelty: value }))
    if (active) {
      void window.undertow
        .flowNovelty(value)
        .then((info) => setStats(info.stats))
        .catch(() => undefined)
    }
  }

  const start = () => {
    const options: FlowOptions = {
      genres: prefs.genres,
      excludeGenres: prefs.excludeGenres,
      novelty: prefs.novelty,
      includeSeeds: prefs.includeSeeds,
      excludeSeeds: prefs.excludeSeeds
    }
    onStart(options)
  }

  const changeSeed = async (action: 'include' | 'exclude', name: string) => {
    const key = name.trim()
    if (!key) return
    setSeedBusy(key)
    setPrefs((prev) =>
      action === 'include'
        ? {
            ...prev,
            includeSeeds: unique([...prev.includeSeeds, key]),
            excludeSeeds: prev.excludeSeeds.filter((x) => x.toLowerCase() !== key.toLowerCase())
          }
        : {
            ...prev,
            includeSeeds: prev.includeSeeds.filter((x) => x.toLowerCase() !== key.toLowerCase()),
            excludeSeeds: unique([...prev.excludeSeeds, key])
          }
    )
    try {
      if (active) {
        const info = await window.undertow.flowSeed(action, key)
        applyInfo(info)
      }
      if (action === 'include') {
        setSeedResults([])
        setSeedQuery('')
      }
      onToast?.(action === 'include' ? `${key} закреплён в течении` : `${key} исключён из течения`)
    } catch (e) {
      onToast?.(e instanceof Error ? e.message : String(e), 'error')
    } finally {
      setSeedBusy(null)
    }
  }

  const unpinSeed = (name: string) => {
    setPrefs((prev) => ({
      ...prev,
      includeSeeds: prev.includeSeeds.filter((x) => x.toLowerCase() !== name.toLowerCase())
    }))
  }

  const restoreExcluded = async () => {
    const names = [...prefs.excludeSeeds]
    setPrefs((prev) => ({ ...prev, excludeSeeds: [] }))
    if (!active || !names.length) return
    try {
      let info: FlowInfo | null = null
      for (const name of names) info = await window.undertow.flowSeed('include', name)
      applyInfo(info)
      onToast?.('Артисты возвращены в течение')
    } catch (e) {
      onToast?.(e instanceof Error ? e.message : String(e), 'error')
    }
  }

  const searchSeeds = async () => {
    const q = seedQuery.trim()
    if (q.length < 2 || seedSearchBusy) return
    setSeedSearchBusy(true)
    try {
      const res = await window.undertow.searchAll(q)
      setSeedResults((res.artists ?? []).slice(0, 6).map((a) => ({ id: a.id, name: a.name, coverUrl: a.coverUrl })))
    } catch (e) {
      onToast?.(e instanceof Error ? e.message : String(e), 'error')
    } finally {
      setSeedSearchBusy(false)
    }
  }

  const blockForever = async () => {
    if (!current?.artist) return
    setFeedbackBusy(true)
    try {
      const info = await window.undertow.flowSeed('exclude', current.artist)
      applyInfo(info)
      onToast?.(`${current.artist} больше не появится в Течении`)
      onFeedback('skipArtist', current).catch(() => undefined)
    } catch (e) {
      onToast?.(e instanceof Error ? e.message : String(e), 'error')
    } finally {
      setFeedbackBusy(false)
    }
  }

  const sendFeedback = async (action: 'more' | 'less' | 'skipArtist') => {
    if (!current || feedbackBusy) return
    setFeedbackBusy(true)
    try {
      await onFeedback(action, current)
      if (active) applyInfo(await window.undertow.flowInfo())
    } catch (e) {
      onToast?.(e instanceof Error ? e.message : String(e), 'error')
    } finally {
      setFeedbackBusy(false)
    }
  }

  const seedRows = (seedRefs.length ? seedRefs : seeds).filter(
    (s) => !prefs.excludeSeeds.some((x) => x.toLowerCase() === s.name.toLowerCase())
  )
  const existingSeedNames = new Set(seedRows.map((s) => s.name.toLowerCase()))
  const extraSeeds = prefs.includeSeeds
    .filter((name) => !existingSeedNames.has(name.toLowerCase()))
    .map((name) => ({ name, weight: 0, coverUrl: undefined, id: undefined }))
  const allSeedRows = [...seedRows, ...extraSeeds]
  const maxSeedWeight = Math.max(1, ...allSeedRows.map((s) => s.weight ?? 0))
  const statsMinutes = stats ? Math.floor(stats.seconds / 60) : 0
  const routeAvatar = (name: string) => {
    const ref = seedRefs.find((r) => r.name.toLowerCase() === name.toLowerCase())
    return ref?.coverUrl ? (
      <img className="flow-route-avatar" src={ref.coverUrl} alt="" loading="lazy" />
    ) : (
      <span className="flow-route-avatar letter" style={{ background: initialGradient(name) }}>
        {name.slice(0, 1).toUpperCase()}
      </span>
    )
  }
  const genreName = prefs.genres.length
    ? prefs.genres.map((id) => genreList.find((g) => g.id === id)?.name ?? id).join(', ')
    : undefined

  return (
    <div className={`scroll flow-page${alive ? ' live' : ''}`}>
      <section className={`flow-hero fade-up${alive ? ' live' : ''}`}>
        <TopoField started={active} playing={alive} />
        <div className="flow-river" aria-hidden="true">
          <i />
          <i />
          <i />
        </div>
        <div className="flow-hero-text">
          <span className="flow-kicker">поток без конца</span>
          <h1 className="flow-title">Течение</h1>
          <p className="flow-lead">
            Бесконечный поток по вашей библиотеке: любимые артисты, похожие на них
            и редкие треки из лайков. Дальше очередь пополняется сама.
          </p>

          <div className="flow-actions flow-actions-main">
            {active ? (
              <>
                <button
                  className="play-btn flow-main-play"
                  onClick={onToggle}
                  disabled={loading}
                >
                  {playing ? <IconPause width={15} height={15} /> : <IconPlay width={15} height={15} />}
                  {playing ? 'Пауза' : 'Продолжить'}
                </button>
                <button
                  className="flow-secondary"
                  onClick={start}
                  disabled={loading}
                  title="Собрать новый поток с текущими настройками"
                >
                  <IconRefresh width={13} height={13} />
                  {loading ? 'Собираю…' : 'Пересобрать'}
                </button>
                {onSave ? (
                  <button
                    className="flow-secondary"
                    onClick={onSave}
                    disabled={saving}
                    title="Сохранить все треки этого потока в плейлист"
                  >
                    <IconPlus width={13} height={13} />
                    {saving ? 'Сохраняю…' : 'Сохранить'}
                  </button>
                ) : null}
              </>
            ) : (
              <button className="play-btn flow-main-play" onClick={start} disabled={loading}>
                <IconPlay width={15} height={15} />
                {loading ? 'Собираю…' : 'Запустить течение'}
              </button>
            )}
            {active ? (
              <span className="flow-live">
                <span className="flow-dot" />
                {playing ? 'Играет' : 'На паузе'}
              </span>
            ) : null}
          </div>
          <div className="flow-hero-quick">
            <span>
              {prefs.genres.length
                ? `жанры: ${prefs.genres.length}`
                : prefs.excludeGenres.length
                  ? `исключено жанров: ${prefs.excludeGenres.length}`
                  : 'все жанры'}{' '}
              · {prefs.novelty}% новых артистов
            </span>
            <button
              onClick={() =>
                document.getElementById('flow-setup')?.scrollIntoView({
                  behavior: 'smooth',
                  block: 'center'
                })
              }
            >
              {active ? 'изменить настройки' : 'настроить поток'}
            </button>
          </div>

          {stats && stats.tracks > 0 ? (
            <div className="flow-hero-stats" aria-label="Статистика потока">
              <span className="flow-hero-stat-lead">
                <b>{statsMinutes}</b>
                <i>мин в потоке</i>
              </span>
              <span>
                <b>{stats.tracks}</b>
                <i>{plural(stats.tracks, 'трек', 'трека', 'треков')}</i>
              </span>
              <span>
                <b>{stats.newArtists}</b>
                <i>{plural(stats.newArtists, 'новый артист', 'новых артиста', 'новых артистов')}</i>
              </span>
            </div>
          ) : null}
        </div>
      </section>

      {active && current ? (
        <>
        <section className="flow-live-block fade-up">
          <div className="flow-now surface-hero surface-deep">
            <div
              className="flow-now-glow"
              style={{ backgroundImage: current.coverUrl ? `url(${current.coverUrl})` : undefined }}
              aria-hidden="true"
            />
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
              {route ? (
                <div className="flow-why">
                  <span className="flow-route-label">почему этот трек</span>
                  {route.library ? (
                    <>
                      <span className="flow-route-icon">
                        <IconWave width={12} height={12} />
                      </span>
                      <span>из вашей библиотеки</span>
                    </>
                  ) : (
                    <>
                      <span className="flow-route-node">
                        {routeAvatar(route.seed)}
                        <span>{route.seed}</span>
                      </span>
                      {route.via && route.via.toLowerCase() !== route.seed.toLowerCase() ? (
                        <>
                          <i className="flow-route-arrow">→</i>
                          <span className="flow-route-node">
                            {routeAvatar(route.via)}
                            <span>{route.via}</span>
                          </span>
                        </>
                      ) : null}
                      <i className="flow-route-arrow">→</i>
                      <span className="flow-route-icon" title="этот трек">
                        ♪
                      </span>
                    </>
                  )}
                </div>
              ) : null}
            </div>
            <div className="flow-now-controls">
              <div className="flow-feedback-head">
                Подстроить поток <span>только на эту сессию</span>
              </div>
              <div className="flow-feedback">
                <button
                  disabled={feedbackBusy}
                  onClick={() => void sendFeedback('more')}
                  title="Добавить больше треков этого артиста в очередь"
                >
                  чаще этот артист
                </button>
                <button
                  disabled={feedbackBusy}
                  onClick={() => void sendFeedback('less')}
                  title="Пропустить трек и не ставить его снова в этом потоке"
                >
                  пропустить трек
                </button>
                <button
                  disabled={feedbackBusy}
                  onClick={() => void sendFeedback('skipArtist')}
                  title="Убрать артиста из текущего потока"
                >
                  убрать артиста
                </button>
                <button
                  disabled={feedbackBusy}
                  onClick={() => void blockForever()}
                  title="Исключить артиста из всех будущих потоков"
                >
                  убрать навсегда
                </button>
              </div>
              <div className="flow-now-bottom">
                <p className="flow-feedback-note">
                  «Чаще» добавит его треки, «Пропустить» уберёт текущий,
                  «Убрать» исключит из этого потока, «Навсегда» — из всех будущих.
                </p>
                <button
                  className="flow-now-toggle"
                  onClick={onToggle}
                  title={playing ? 'Пауза' : 'Играть'}
                >
                  {playing ? <IconPause width={16} height={16} /> : <IconPlay width={16} height={16} />}
                </button>
              </div>
            </div>
          </div>

          <div className="flow-next surface-hero surface-deep">
            <div className="flow-next-head">
              <span>дальше</span>
              <span className="flow-next-count">ещё {Math.max(0, queue.length - index - 1)}</span>
            </div>
            <div className="flow-timeline">
            {upcoming.map((t, i) => (
              <button
                key={`${t.id}-${i}`}
                className="flow-next-row flow-stop"
                onClick={() => onPlayFlow(t, queue)}
                onMouseEnter={() => onHover?.(t)}
              >
                <span className="flow-stop-dot" aria-hidden="true" />
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
            </div>
            {!upcoming.length ? (
              <div className="flow-next-empty">Подтягиваю ещё…</div>
            ) : null}
          </div>
        </section>

        {discoveries.length > 0 ? (
          <section className="flow-discoveries fade-up">
            <div className="flow-discoveries-head">
              <b>Открыли в Течении</b>
              <span>артисты, которых раньше не было в библиотеке</span>
            </div>
            <div className="flow-discoveries-list">
              {discoveries.slice(0, 8).map((artist) => (
                <button key={artist.name} onClick={() => onArtistRadio(artist.name)}>
                  <span className="flow-discovery-avatar">
                    {artist.coverUrl ? <img src={artist.coverUrl} alt="" loading="lazy" /> : artist.name.charAt(0)}
                  </span>
                  <span>{artist.name}</span>
                </button>
              ))}
            </div>
          </section>
        ) : null}
        </>
      ) : (
        <section className="flow-idle fade-up">
          <div className="flow-idle-head">
            <div className="flow-idle-art">
              <IconWave width={26} height={26} />
            </div>
            <div>
              <b>Течение ещё не запущено</b>
              <p>
                Оно соберёт поток из артистов, которых вы лайкаете и слушаете, добавит
                похожих на них и будет пополнять очередь само.
              </p>
            </div>
          </div>
          <div className="flow-idle-steps">
            <span><i>1</i> Любимые артисты уже взяты из библиотеки</span>
            <span><i>2</i> Жанры и новизну можно оставить как есть</span>
            <span><i>3</i> Нажмите «Запустить течение» выше</span>
          </div>
        </section>
      )}

      <section id="flow-setup" className="flow-setup surface-hero surface-deep fade-up">
        <div className="flow-setup-head">
          <div>
            <h2>Настройки потока</h2>
            <p>Можно менять до запуска и во время — всё запоминается.</p>
          </div>
          <span className="flow-setup-saved">сохраняется автоматически</span>
        </div>

        <div className="flow-setup-grid">
          <div className="flow-setup-block">
            <div className="flow-setup-title">
              <b>Жанры</b>
              <span>
                {prefs.genres.length
                  ? `включено: ${prefs.genres.length}`
                  : prefs.excludeGenres.length
                    ? `исключено: ${prefs.excludeGenres.length}`
                    : 'все жанры'}
              </span>
            </div>

            <div className="flow-genre-tools">
              <div className="flow-genre-mode" role="group" aria-label="Режим выбора жанров">
                <button
                  className={genreMode === 'include' ? 'on' : ''}
                  onClick={() => setGenreMode('include')}
                  aria-pressed={genreMode === 'include'}
                >
                  включить
                </button>
                <button
                  className={genreMode === 'exclude' ? 'on' : ''}
                  onClick={() => setGenreMode('exclude')}
                  aria-pressed={genreMode === 'exclude'}
                >
                  исключить
                </button>
              </div>
            </div>
            <p className="flow-setup-hint">
              {genreMode === 'include'
                ? 'Ничего не выбрано — берём всю библиотеку. Выбранные жанры будут звучать чаще.'
                : 'Эти жанры не будут попадать в поток.'}
            </p>
            {prefs.genres.length || prefs.excludeGenres.length ? (
              <p className="flow-apply-note">
                {active
                  ? 'Применится после кнопки «Пересобрать».'
                  : 'Применится при следующем запуске.'}
              </p>
            ) : null}

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
                    className={`flow-genre${!prefs.genres.length && !prefs.excludeGenres.length ? ' on' : ''}`}
                    onClick={() => setPrefs((prev) => ({ ...prev, genres: [], excludeGenres: [] }))}
                  >
                    всё
                  </button>
                  {genreList.map((g) => (
                    <button
                      key={g.id}
                      className={`flow-genre${selectedGenres.has(g.id) ? ' on' : ''}${
                        excludedGenres.has(g.id) ? ' off' : ''
                      }`}
                      onClick={() => toggleGenre(g.id)}
                      title={`${g.artists} артистов в библиотеке`}
                    >
                      {g.name}
                      <i>{g.artists}</i>
                    </button>
                  ))}
                </>
              )}
            </div>
            {genreName ? <span className="flow-selected-genres">сейчас: {genreName}</span> : null}
          </div>

          <div className="flow-setup-block flow-setup-novelty">
            <div className="flow-setup-title">
              <b>Новизна</b>
              <span>{prefs.novelty}% новых</span>
            </div>
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={prefs.novelty}
              onChange={(e) => setNovelty(Number(e.target.value))}
              aria-label="Новизна течения"
            />
            <div className="flow-novelty-scale">
              <span>только знакомые</span>
              <span>только новые</span>
            </div>
            <p className="flow-setup-hint">
              Доля артистов, которых нет в вашей библиотеке.
              {active ? ' Меняется сразу.' : ' Применится при запуске.'}
            </p>
          </div>
        </div>
      </section>

      <section className="section fade-up">
        <div className="section-head">
          <div className="section-title">
            <div>
              <h2>Основа потока</h2>
              <div className="section-sub">Эти артисты задают направление. Закрепите любимых или уберите лишних.</div>
            </div>
          </div>
          <div className="section-tools">
            <span className="count">
              {allSeedRows.length
                ? `${allSeedRows.length} ${plural(allSeedRows.length, 'артист', 'артиста', 'артистов')}`
                : 'пусто'}
            </span>
          </div>
        </div>

        <p className="flow-seed-help">
          Нажмите на артиста, чтобы включить его радио. <b>+</b> закрепить, <b>×</b> убрать.
        </p>

        <div className="seed-search">
          <input
            value={seedQuery}
            onChange={(e) => setSeedQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void searchSeeds()
            }}
            placeholder="Добавить артиста в течение"
            aria-label="Поиск артиста для течения"
          />
          <button onClick={() => void searchSeeds()} disabled={seedSearchBusy || seedQuery.trim().length < 2}>
            {seedSearchBusy ? 'ищу…' : 'найти'}
          </button>
        </div>
        {seedResults.length ? (
          <div className="seed-results">
            {seedResults.map((a) => (
              <button
                key={`${a.id ?? a.name}-${a.name}`}
                className="seed-result"
                onClick={() => void changeSeed('include', a.name)}
                disabled={seedBusy === a.name}
              >
                {a.coverUrl ? <img src={a.coverUrl} alt="" /> : <span>{a.name.slice(0, 1)}</span>}
                <b>{a.name}</b>
                <i>+</i>
              </button>
            ))}
          </div>
        ) : null}

        {allSeedRows.length ? (
          <div className="seed-river">
            {[...allSeedRows]
              .sort((a, b) => (b.weight ?? 0) - (a.weight ?? 0))
              .map((s) => {
                const ref = seedRefs.find((r) => r.name.toLowerCase() === s.name.toLowerCase())
                const pinned = prefs.includeSeeds.some((x) => x.toLowerCase() === s.name.toLowerCase())
                const ratio = Math.max(0, Math.min(1, (s.weight ?? 0) / maxSeedWeight))
                const size = 58 + Math.round(ratio * 18)
                return (
                  <div className="seed-source" key={s.name}>
                    <button
                      className="seed-main"
                      onClick={() => onArtistRadio(s.name)}
                      disabled={radioLoading}
                      title={`Радио ${s.name}`}
                    >
                      <span
                        className="seed-source-avatar"
                        style={
                          {
                            '--seed-size': `${size}px`,
                            '--seed-pct': `${Math.max(8, ratio * 100)}%`
                          } as CSSProperties
                        }
                      >
                        <span className="seed-ring" aria-hidden="true" />
                        {ref?.coverUrl ? (
                          <img className="seed-avatar" src={ref.coverUrl} alt="" loading="lazy" />
                        ) : (
                          <span className="seed-avatar letter" style={{ background: initialGradient(s.name) }}>
                            {s.name.slice(0, 1).toUpperCase()}
                          </span>
                        )}
                      </span>
                      <span className="seed-name">{s.name}</span>
                      <span className="seed-sub">{pinned ? 'закреплён' : 'включить радио'}</span>
                    </button>
                    <div className="seed-actions">
                      <button
                        className={`seed-pin${pinned ? ' on' : ''}`}
                        onClick={() => (pinned ? unpinSeed(s.name) : void changeSeed('include', s.name))}
                        title={pinned ? 'Открепить' : 'Закрепить в течении'}
                        aria-label={pinned ? `Открепить ${s.name}` : `Закрепить ${s.name}`}
                      >
                        {pinned ? <IconCheck width={12} height={12} /> : <IconPlus width={12} height={12} />}
                      </button>
                      <button
                        className="seed-ban"
                        onClick={() => void changeSeed('exclude', s.name)}
                        title="Исключить из течения"
                        aria-label={`Исключить ${s.name}`}
                      >
                        <IconX width={12} height={12} />
                      </button>
                    </div>
                  </div>
                )
              })}
          </div>
        ) : (
          <div className="empty">
            <b>Пока не из чего течь</b>
            Поставьте лайки нескольким трекам — и течение соберётся.
          </div>
        )}

        {prefs.excludeSeeds.length ? (
          <div className="flow-excluded">
            исключены: {prefs.excludeSeeds.join(', ')}
            <button onClick={() => void restoreExcluded()}>вернуть</button>
          </div>
        ) : null}
      </section>

    </div>
  )
}
