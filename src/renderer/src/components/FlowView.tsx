import { useEffect, useState } from 'react'
import type { FlowAnchor, FlowInfo, FlowOptions, FlowRoute, FlowStats, Track } from '../types'
import { fmtTime } from './TrackList'
import { IconPause, IconPlay, IconPlus, IconRefresh, IconWave } from './Icons'
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
  onHover?: (track: Track) => void
}

interface Prefs {
  genres: string[]
  excludeGenres: string[]
}

const DEFAULT_PREFS: Prefs = {
  genres: [],
  excludeGenres: []
}

const TIER_LABEL: Record<string, string> = {
  hit: 'хит',
  recent: 'новинка',
  deep: 'глубина'
}

const ROLE_LABEL: Record<FlowAnchor['role'], string> = {
  like: 'недавний',
  top: 'частый',
  middle: 'середина',
  history: 'история',
  unexpected: 'неожиданный',
  manual: 'от трека'
}

const PREFS_KEY = 'undertow.flowOptions'

function loadPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY)
    if (!raw) return { ...DEFAULT_PREFS }
    const parsed = JSON.parse(raw) as Partial<Prefs>
    return {
      genres: Array.isArray(parsed.genres) ? parsed.genres.filter(Boolean) : [],
      excludeGenres: Array.isArray(parsed.excludeGenres) ? parsed.excludeGenres.filter(Boolean) : []
    }
  } catch {
    return { ...DEFAULT_PREFS }
  }
}

function plural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return one
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few
  return many
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
  onHover
}: Props) {
  const [genreList, setGenreList] = useState<{ id: string; name: string; artists: number }[]>([])
  const [genresLoading, setGenresLoading] = useState(true)
  const [prefs, setPrefs] = useState<Prefs>(() => loadPrefs())
  const [genreMode, setGenreMode] = useState<'include' | 'exclude'>('include')
  const [feedbackBusy, setFeedbackBusy] = useState(false)
  const [setupOpen, setSetupOpen] = useState(false)
  const [routes, setRoutes] = useState<Record<string, FlowRoute>>({})
  const [stats, setStats] = useState<FlowStats | null>(null)
  const [anchors, setAnchors] = useState<FlowAnchor[]>([])
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
    setRoutes(info.routes ?? {})
    setStats(info.stats ?? null)
    setAnchors(info.anchors ?? [])
  }

  useEffect(() => {
    let aliveFetch = true
    void (async () => {
      try {
        const [flow, genres] = await Promise.all([
          window.undertow.flowInfo(),
          window.undertow.flowGenres()
        ])
        if (!aliveFetch) return
        setGenreList(genres?.items ?? [])
        setRoutes(flow?.routes ?? {})
        setStats(flow?.stats ?? null)
        setAnchors(flow?.anchors ?? [])
        if (flow?.active) {
          setPrefs((prev) => ({
            ...prev,
            genres: flow?.genres ?? [],
            excludeGenres: flow?.excludeGenres ?? []
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



  const start = () => {
    const options: FlowOptions = {
      genres: prefs.genres,
      excludeGenres: prefs.excludeGenres
    }
    onStart(options)
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

  const statsMinutes = stats ? Math.floor(stats.seconds / 60) : 0
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
            Двенадцать треков-якорей из вашей библиотеки, похожие на них треки
            и новые артисты. Дальше очередь пополняется сама.
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
                  : 'все жанры'}
            </span>
            <button
              onClick={() => {
                setSetupOpen(true)
                window.setTimeout(
                  () =>
                    document.getElementById('flow-setup')?.scrollIntoView({
                      behavior: 'smooth',
                      block: 'center'
                    }),
                  40
                )
              }}
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

      {active && anchors.length ? (
        <section className="flow-anchors fade-up" aria-label="Треки-якоря потока">
          <div className="flow-anchors-head">
            <b>Двенадцать якорей</b>
            <span>от этих треков строится поток</span>
          </div>
          <div className="flow-anchors-row">
            {anchors.slice(0, 12).map((anchor) => (
              <button
                key={`${anchor.track.id}-${anchor.role}`}
                className="flow-anchor"
                onClick={() => onArtistRadio(anchor.track.artist)}
                title={`Радио ${anchor.track.artist}`}
              >
                <span className="flow-anchor-cover">
                  {anchor.track.coverUrl ? (
                    <img src={anchor.track.coverUrl} alt="" loading="lazy" />
                  ) : (
                    <i>{anchor.track.artist.slice(0, 1).toUpperCase()}</i>
                  )}
                </span>
                <span className="flow-anchor-text">
                  <b>{anchor.track.title}</b>
                  <i>{anchor.track.artist}</i>
                </span>
                <span className={`flow-anchor-role role-${anchor.role}`}>{ROLE_LABEL[anchor.role]}</span>
              </button>
            ))}
          </div>
        </section>
      ) : null}

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
                  ) : route.anchor ? (
                    <>
                      <span className="flow-route-label">похоже на</span>
                      <span className="flow-route-track">«{route.anchor}»</span>
                      <span className="flow-route-icon" title="трек-якорь">
                        ♪
                      </span>
                    </>
                  ) : (
                    <span className="flow-route-track">{route.seed}</span>
                  )}
                  {route.tier ? (
                    <span className={`flow-tier flow-tier-${route.tier}`}>{TIER_LABEL[route.tier]}</span>
                  ) : null}
                </div>
              ) : null}
            </div>
            <div className="flow-now-controls">
              <div className="flow-feedback-head">
                Подстроить поток <span>запоминается между запусками</span>
              </div>
              <div className="flow-feedback">
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
                  «Пропустить» уберёт текущий трек, «Убрать» исключит артиста
                  из этого потока, «Навсегда» — из всех будущих.
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
                Оно возьмёт двенадцать треков-якорей из вашей библиотеки и пойдёт
                по похожим трекам, пополняя очередь сама.
              </p>
            </div>
          </div>
          <div className="flow-idle-steps">
            <span><i>1</i> Двенадцать треков-якорей уже взяты из библиотеки</span>
            <span><i>2</i> Жанры можно оставить как есть</span>
            <span><i>3</i> Нажмите «Запустить течение» выше</span>
          </div>
        </section>
      )}

      <section
        id="flow-setup"
        className={`flow-setup surface-hero surface-deep fade-up${setupOpen ? ' open' : ' collapsed'}`}
      >
        <div className="flow-setup-head">
          <div>
            <h2>Настройки потока</h2>
            <p>Жанры и фильтры — если хочется точнее.</p>
          </div>
          <button className="flow-setup-toggle" onClick={() => setSetupOpen((v) => !v)}>
            {setupOpen ? 'свернуть' : 'настроить'}
          </button>
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


        </div>
      </section>

    </div>
  )
}
