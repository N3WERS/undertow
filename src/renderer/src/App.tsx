import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Sidebar, { type View } from './components/Sidebar'
import HomeView from './components/Home'
import FlowView from './components/FlowView'
import SearchViewBase from './components/SearchView'
import Settings from './components/Settings'
import LibraryView from './components/LibraryView'
import SavedView from './components/SavedView'
import QueuePanel from './components/QueuePanel'
import BrowseView from './components/BrowseView'
import ReleasesView from './components/ReleasesView'
import PlaylistsView from './components/PlaylistsView'
import PlaylistPicker from './components/PlaylistPicker'
import LyricsPanel from './components/LyricsPanel'
import PlayerBar from './components/PlayerBar'
import NowPlaying from './components/NowPlaying'
import MiniPlayer from './components/MiniPlayer'
import CloseDialog from './components/CloseDialog'
import { IconShrink } from './components/Icons'
import { AudioEngine, type RepeatMode, type Snapshot } from './audio/engine'
import { loadEq, saveEq, type EqSettings } from './audio/eq'
import { setProgress } from './audio/progress'
import { onNotify } from './notify'
import type {
  BrowsePage,
  LibrarySnapshot,
  ProviderState,
  ReleaseItem,
  SavedAlbum,
  ChartScope,
  DpiStatus,
  FlowOptions,
  Section,
  TopChart,
  Track,
  TrackVersion,
  UpdateState
} from './types'
import { APP_VERSION } from './version'
import appIcon from './assets/app-icon.png'

// лента и поиск не должны перерисовываться 10 раз в секунду из-за прогресса плеера
const Home = memo(HomeView)
const SearchView = memo(SearchViewBase)

interface Toast {
  id: number
  text: string
  kind: 'info' | 'error'
  action?: { label: string; run: () => void }
}

let toastSeq = 0

const readNum = (key: string, fallback: number) => {
  const raw = localStorage.getItem(key)
  const n = raw === null ? NaN : Number(raw)
  return Number.isFinite(n) ? n : fallback
}

const EMPTY_SNAP: Snapshot = { playing: false, time: 0, duration: 0, rms: 0, gainDb: 0, trackId: null }

export default function App() {
  const [view, setView] = useState<View>('home')
  const [pickerTrack, setPickerTrack] = useState<Track | null>(null)
  const [lyricsOpen, setLyricsOpen] = useState(false)
  const [hasLyrics, setHasLyrics] = useState(false)
  const [sections, setSections] = useState<Section[]>([])
  const [chart, setChart] = useState<TopChart | null>(null)
  const [chartScope, setChartScope] = useState<ChartScope>(() => {
    const saved = localStorage.getItem('undertow.chartScope')
    return saved === 'world' || saved === 'us' ? saved : 'ru'
  })
  const [chartLoading, setChartLoading] = useState(true)
  const [loading, setLoading] = useState(true)
  const [homeError, setHomeError] = useState<string | null>(null)
  const [state, setState] = useState<ProviderState | null>(null)
  const [dpi, setDpi] = useState<DpiStatus | null>(null)
  const [update, setUpdate] = useState<UpdateState | null>(null)
  const [settingsFocus, setSettingsFocus] = useState<'dpi' | 'updates' | null>(null)
  const dpiAutoTried = useRef(false)
  const [toasts, setToasts] = useState<Toast[]>([])

  const [snap, setSnap] = useState<Snapshot>(EMPTY_SNAP)
  const [track, setTrack] = useState<Track | null>(null)
  const [quality, setQuality] = useState<string | null>(null)
  const [source, setSource] = useState<'yandex' | 'youtube' | 'local' | 'soundcloud' | null>(null)
  const [versions, setVersions] = useState<{ loading: boolean; list: TrackVersion[] } | null>(null)
  /** исходный трек, от которого ищем версии: переживает переключение на версию */
  const versionBaseRef = useRef<Track | null>(null)
  /** id треков из открытого списка версий: их переключение панель не закрывает */
  const versionIdsRef = useRef<Set<string>>(new Set())
  /** какая копия играет: показываем отдельной строкой под названием */
  const [copyLabel, setCopyLabel] = useState<string | null>(null)
  const [queueState, setQueueState] = useState<{ queue: Track[]; index: number; shuffled: boolean }>({
    queue: [],
    index: -1,
    shuffled: false
  })
  const [queueOpen, setQueueOpen] = useState(false)
  const [repeat, setRepeat] = useState<RepeatMode>('off')
  const [mini, setMini] = useState(false)
  const [closeAsk, setCloseAsk] = useState(false)
  const [theaterOpen, setTheaterOpen] = useState(false)
  const [resolving, setResolving] = useState(false)
  useEffect(() => {
    if (!track && theaterOpen) setTheaterOpen(false)
  }, [track, theaterOpen])

  useEffect(() => {
    let alive = true
    void window.undertow
      .miniState()
      .then((on) => {
        if (alive) setMini(on)
      })
      .catch(() => undefined)
    const off = window.undertow.onMiniChange((on) => setMini(on))
    return () => {
      alive = false
      off()
    }
  }, [])

  useEffect(() => {
    let alive = true
    void window.undertow
      .updateState()
      .then((s) => {
        if (alive) setUpdate(s)
      })
      .catch(() => undefined)
    const off = window.undertow.onUpdateState(setUpdate)
    return () => {
      alive = false
      off()
    }
  }, [])

  useEffect(() => {
    let alive = true
    const refresh = () => {
      void window.undertow
        .dpiStatus()
        .then((next) => {
          if (!alive) return
          setDpi(next)
          // если обход был включён в прошлый раз — включаем его снова,
          // иначе после перезапуска YouTube снова едет на 20 секунд
          if (
            !dpiAutoTried.current &&
            next.state === 'off' &&
            localStorage.getItem('undertow.dpi') === 'on'
          ) {
            dpiAutoTried.current = true
            void window.undertow
              .dpiSet(true)
              .then((after) => {
                if (alive) setDpi(after)
              })
              .catch(() => undefined)
          }
        })
        .catch(() => undefined)
    }
    refresh()
    const timer = window.setInterval(refresh, 15000)
    window.addEventListener('focus', refresh)
    return () => {
      alive = false
      window.clearInterval(timer)
      window.removeEventListener('focus', refresh)
    }
  }, [])

  useEffect(() => {
    const offRequest = window.undertow.onCloseRequest(() => setCloseAsk(true))
    const offDismiss = window.undertow.onCloseDismiss(() => setCloseAsk(false))
    return () => {
      offRequest()
      offDismiss()
    }
  }, [])

  const closeAction = useCallback((action: 'tray' | 'quit' | 'cancel') => {
    setCloseAsk(false)
    window.undertow.closeAction(action)
  }, [])

  useEffect(() => {
    if (!mini) return
    setTheaterOpen(false)
    setQueueOpen(false)
    setLyricsOpen(false)
    setVersions(null)
    setPickerTrack(null)
  }, [mini])
  const [volume, setVolume] = useState(() => readNum('undertow.volume', 0.85))
  const [crossfade, setCrossfade] = useState(() =>
    Math.max(0, Math.min(15, Math.round(readNum('undertow.crossfade', 0))))
  )
  const [normalize, setNormalize] = useState(() => localStorage.getItem('undertow.normalize') !== '0')
  const [eq, setEq] = useState<EqSettings>(() => loadEq())

  const [lib, setLib] = useState<LibrarySnapshot>({ likes: [], history: [], stats: { likes: 0, history: 0, updatedAt: null } })
  const [savedAlbums, setSavedAlbums] = useState<SavedAlbum[]>([])
  const [importing, setImporting] = useState(false)

  const engineRef = useRef<AudioEngine | null>(null)
  const toastRef = useRef<(text: string, kind?: Toast['kind'], action?: Toast['action']) => void>(() => undefined)
  const currentId = track?.id ?? null
  // кнопка «текст» появляется только там, где LRCLIB реально что-то отдал
  useEffect(() => {
    let alive = true
    if (!track) {
      setHasLyrics(false)
      return
    }
    setHasLyrics(false)
    void window.undertow
      .lyricsHas(track)
      .then((yes) => {
        if (!alive) return
        setHasLyrics(yes)
        if (!yes) setLyricsOpen(false)
      })
      .catch(() => undefined)
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [track?.id])

  const toast = useCallback((text: string, kind: Toast['kind'] = 'info', action?: Toast['action']) => {
    const id = ++toastSeq
    setToasts((prev) => [...prev.slice(-2), { id, text, kind, action }])
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), action ? 12000 : 5200)
  }, [])
  toastRef.current = toast
  // события из любых модулей (например, сохранение трека в TrackList)
  useEffect(() => onNotify((text, kind) => toast(text, kind)), [toast])

  /* ---------------------------- лента и состояние -------------------------- */

  const loadHome = useCallback(async () => {
    setLoading(true)
    setHomeError(null)
    try {
      setSections(await window.undertow.home())
    } catch (e) {
      setHomeError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  // чарт грузим отдельно: если YouTube его не отдал, главная всё равно работает
  useEffect(() => {
    let alive = true
    setChartLoading(true)
    window.undertow
      .topChart(chartScope)
      .then((value) => {
        if (alive) setChart(value)
      })
      .catch(() => {
        // при смене региона не показываем чарт другой страны под новым заголовком
        if (alive) setChart((prev) => (prev?.scope === chartScope ? prev : null))
      })
      .finally(() => {
        if (alive) setChartLoading(false)
      })
    return () => {
      alive = false
    }
  }, [chartScope])

  const changeChartScope = useCallback((scope: ChartScope) => {
    localStorage.setItem('undertow.chartScope', scope)
    setChartScope(scope)
  }, [])

  /** Куда ведёт переход: id (Яндекс) или имя (YouTube-страница без id). */
  interface BrowseTarget {
    kind: 'artist' | 'album' | 'playlist'
    id?: string
    name?: string
    title: string
    artist?: string
    trackTitle?: string
  }

  const [browse, setBrowse] = useState<BrowseTarget | null>(null)
  const [browsePage, setBrowsePage] = useState<BrowsePage | null>(null)
  const [browseLoading, setBrowseLoading] = useState(false)
  const [browseError, setBrowseError] = useState<string | null>(null)

  // стек переходов: артист → альбом → назад возвращает на артиста, а не на главную
  const browseStack = useRef<BrowseTarget[]>([])

  const loadPage = useCallback(async (target: BrowseTarget) => {
    setBrowsePage(null)
    setBrowseError(null)
    setBrowseLoading(true)
    try {
      const page =
        target.kind === 'artist'
          ? await window.undertow.artistPage({ id: target.id, name: target.name ?? target.title })
          : target.kind === 'playlist'
            ? await window.undertow.playlistPage(target.id ?? '')
            : await window.undertow.albumPage({
                id: target.id,
                title: target.title,
                artist: target.artist,
                trackTitle: target.trackTitle
              })
      setBrowsePage(page)
    } catch (e) {
      setBrowseError(e instanceof Error ? e.message : String(e))
    } finally {
      setBrowseLoading(false)
    }
  }, [])

  const openPage = useCallback(
    (target: BrowseTarget) => {
      browseStack.current.push(target)
      setBrowse(target)
      void loadPage(target)
    },
    [loadPage]
  )

  const openArtist = useCallback(
    (target: { id?: string; name: string }) => openPage({ kind: 'artist', id: target.id, name: target.name, title: target.name }),
    [openPage]
  )
  const openAlbum = useCallback(
    (target: { id?: string; title: string; artist?: string; trackTitle?: string }) =>
      openPage({
        kind: 'album',
        id: target.id,
        title: target.title,
        artist: target.artist,
        trackTitle: target.trackTitle
      }),
    [openPage]
  )
  const openPlaylist = useCallback(
    (target: { id: string; title: string }) =>
      openPage({ kind: 'playlist', id: target.id, title: target.title }),
    [openPage]
  )

  const closeBrowse = useCallback(() => {
    browseStack.current = []
    setBrowse(null)
    setBrowsePage(null)
    setBrowseError(null)
  }, [])

  const backFromBrowse = useCallback(() => {
    browseStack.current.pop()
    const prev = browseStack.current[browseStack.current.length - 1]
    if (!prev) {
      closeBrowse()
      return
    }
    setBrowse(prev)
    void loadPage(prev)
  }, [closeBrowse, loadPage])

  // секции, которые пользователь убрал с главной (живут в main, rec-prefs.json)
  const [hidden, setHidden] = useState<string[]>([])
  const hideSection = useCallback(
    async (sectionId: string) => {
      try {
        setHidden(await window.undertow.hideSection(sectionId))
        setSections((prev) => prev.filter((s) => s.id !== sectionId))
        toast('Секция скрыта')
      } catch (e) {
        toast(e instanceof Error ? e.message : String(e), 'error')
      }
    },
    [toast]
  )
  const restoreHidden = useCallback(async () => {
    try {
      await window.undertow.clearHiddenSections()
      setHidden([])
      await loadHome()
      toast('Скрытые секции вернулись')
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error')
    }
  }, [loadHome, toast])

  const [refreshing, setRefreshing] = useState(false)
  const refreshHome = useCallback(async () => {
    setRefreshing(true)
    const chartRefresh = window.undertow
      .topChart(chartScope, true)
      .then(setChart)
      .catch(() => undefined)
    try {
      setSections(await window.undertow.refreshHome())
      toast('Подборка пересобрана')
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error')
    } finally {
      await chartRefresh
      setRefreshing(false)
    }
  }, [toast, chartScope])

  const reloadLibrary = useCallback(async () => {
    try {
      setLib(await window.undertow.library())
    } catch {
      // библиотека не критична для воспроизведения
    }
  }, [])

  // main дозаполнил длительности старых треков — перечитываем главную и
  // библиотеку, иначе в «Продолжить слушать» так и висело бы «—»
  useEffect(() => {
    const off = window.undertow.onDurations?.(() => {
      void loadHome()
      void reloadLibrary()
    })
    return off
  }, [loadHome, reloadLibrary])

  useEffect(() => {
    void loadHome()
    void reloadLibrary()
    void window.undertow.albumsList().then(setSavedAlbums).catch(() => setSavedAlbums([]))
    void window.undertow.hiddenSections().then(setHidden).catch(() => setHidden([]))
    // старые записи лежали без исполнителей — дозаполняем в фоне, чтобы
    // заработали ссылки на артистов в истории и избранном
    void window.undertow
      .enrichLibrary()
      .then((snap) => setLib(snap))
      .catch(() => {
        /* без Яндекса обогащать нечем */
      })
    void window.undertow.state().then(setState).catch(() => setState(null))
  }, [loadHome, reloadLibrary])

  const likedIds = useMemo(() => new Set(lib.likes.map((t) => t.id)), [lib.likes])

  // Первый запуск с подключённым Яндексом и пустой библиотекой: подтягиваем лайки сами
  useEffect(() => {
    if (autoImported.current) return
    if (!state?.yandex.active) return
    if (lib.likes.length > 0) return
    autoImported.current = true
    void importLikesRef.current?.()
  }, [state?.yandex.active, lib.likes.length])

  const toggleLike = useCallback(
    (t: Track) => {
      const liked = !likedIds.has(t.id)
      // оптимистично: сердечко реагирует сразу, main подтверждает запись
      setLib((prev) => ({
        ...prev,
        likes: liked ? [t, ...prev.likes.filter((x) => x.id !== t.id)] : prev.likes.filter((x) => x.id !== t.id),
        stats: { ...prev.stats, likes: liked ? prev.stats.likes + 1 : Math.max(0, prev.stats.likes - 1) }
      }))
      void window.undertow
        .like(t, liked)
        .then((res) => {
          if (res.syncError) toast(`Локально сохранено, Яндекс не принял: ${res.syncError}`, 'error')
        })
        .catch((e: Error) => toast(`Не сохранилось: ${e.message}`, 'error'))
    },
    [likedIds, toast]
  )

  const autoImported = useRef(false)
  const importLikesRef = useRef<null | (() => Promise<void>)>(null)
  const importLikes = useCallback(async () => {
    setImporting(true)
    try {
      const res = await window.undertow.importYandexLikes()
      await reloadLibrary()
      toast(
        res.imported > 0
          ? `Подтянул ${res.imported} лайков из Яндекса — всего в библиотеке ${res.localTotal}`
          : `Новых лайков нет: всё уже на месте (в Яндексе ${res.total})`
      )
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error')
    } finally {
      setImporting(false)
    }
  }, [reloadLibrary, toast])
  importLikesRef.current = importLikes

  /* --------------------------- сохранённые альбомы -------------------------- */

  const pageArtist = browsePage?.tracks[0]?.artist || browsePage?.subtitle.split(' · ')[0] || ''
  const savedAlbum = useMemo(() => {
    if (!browsePage || browsePage.kind !== 'album') return null
    const sameTitle = (a: SavedAlbum) =>
      a.title.trim().toLowerCase() === browsePage.title.trim().toLowerCase() &&
      a.artist.trim().toLowerCase() === pageArtist.trim().toLowerCase()
    return savedAlbums.find((a) => a.id === browsePage.id || sameTitle(a)) ?? null
  }, [browsePage, pageArtist, savedAlbums])

  const toggleSavedAlbum = useCallback(async () => {
    if (!browsePage || browsePage.kind !== 'album') return
    try {
      if (savedAlbum) {
        setSavedAlbums(await window.undertow.albumsRemove(savedAlbum.id))
        toast(`Альбом убран из библиотеки: ${savedAlbum.title}`)
      } else {
        setSavedAlbums(await window.undertow.albumsSave(browsePage))
        toast(`Альбом сохранён в библиотеку: ${browsePage.title}`)
      }
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error')
    }
  }, [browsePage, savedAlbum, toast])

  const removeSavedAlbum = useCallback(
    async (album: SavedAlbum) => {
      try {
        setSavedAlbums(await window.undertow.albumsRemove(album.id))
        toast(`Альбом убран из библиотеки: ${album.title}`)
      } catch (e) {
        toast(e instanceof Error ? e.message : String(e), 'error')
      }
    },
    [toast]
  )

  /* ------------------- очередь между запусками (queue.json) ----------------- */

  const queueMetaRef = useRef({ index: -1, shuffled: false })
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const persistQueue = useCallback((queue: Track[], index: number, shuffled: boolean) => {
    if (!queue.length) return
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => {
      saveTimerRef.current = null
      void window.undertow.queueSave({ tracks: queue, index, shuffled }).catch(() => undefined)
    }, 600)
  }, [])

  /* ------------------------------ движок звука ---------------------------- */

  useEffect(() => {
    const engine = new AudioEngine({
      onSnapshot: (s) => {
        setProgress(s.time, s.duration, s.rms)
        // в state попадают только редкие поля: время и уровень громкости идут
        // через отдельный стор, чтобы не перерисовывать списки на каждом тике
        setSnap((prev) =>
          prev.playing === s.playing && prev.trackId === s.trackId && prev.duration === s.duration
            ? prev
            : { ...prev, playing: s.playing, trackId: s.trackId, duration: s.duration }
        )
        if (s.duration > 0) setResolving(false)
      },
      onTrackChange: (t) => {
        setTrack(t)
        // полоска не должна показывать позицию прошлого трека, пока грузится новый
        setProgress(0, t?.durationSec ?? 0, 0)
        setSnap((prev) => ({ ...prev, duration: t?.durationSec ?? 0, trackId: t?.id ?? null }))
        if (t) {
          setResolving(false)
          void window.undertow.addHistory(t)
          setLib((prev) =>
            prev.history[0]?.id === t.id
              ? prev
              : { ...prev, history: [t, ...prev.history.filter((x) => x.id !== t.id)].slice(0, 2000) }
          )
        }
      },
      onQueue: (queue, index, shuffled) => {
        setQueueState({ queue, index, shuffled })
        queueMetaRef.current = { index, shuffled }
        persistQueue(queue, index, shuffled)
        refillRadio(queue.length, index)
        refillFlow(queue.length, index)
      },
      onRepeat: setRepeat,
      onError: (m, retry) => toastRef.current(m, 'error', retry ? { label: 'Повторить', run: retry } : undefined),
      onQuality: setQuality,
      onCopy: (sub, kind, approximate, main) => {
        setCopyLabel(sub)
        if (!sub || !main) return
        toastRef.current(
          kind === 'variant'
            ? `Играю выбранный вариант: ${main}`
            : approximate
              ? `Точной копии нет — играю похожий вариант с YouTube: ${main}`
              : `Яндекс недоступен — играю копию с YouTube: ${main}`
        )
      },
      onSource: (src, fb) => {
        setSource(src)
        if (!fb) setVersions(null)
      }
    })
    engine.setOptions({ volume, crossfadeSec: crossfade, normalization: normalize })
    engineRef.current = engine
    // для диагностики из CDP (spikes/cdp.mjs)
    ;(window as unknown as { __engine?: AudioEngine }).__engine = engine
    return () => {
      engine.destroy()
      engineRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // возвращаем очередь с прошлого запуска: трек в плеере, звук — по кнопке play
  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const saved = await window.undertow.queueGet()
        const engine = engineRef.current
        if (!alive || !engine || !saved?.tracks.length) return
        const track = saved.tracks[saved.index]
        // очередь помним, но позицию — нет: после запуска трек всегда с начала
        engine.restore(saved.tracks, saved.index, saved.shuffled)
        setProgress(0, track?.durationSec ?? 0, 0)
        queueMetaRef.current = { index: saved.index, shuffled: saved.shuffled }
        setTrack(track ?? null)
        setQueueState({ queue: saved.tracks, index: saved.index, shuffled: saved.shuffled })
        setSnap({
          playing: false,
          time: 0,
          duration: track?.durationSec ?? 0,
          rms: 0,
          gainDb: 0,
          trackId: track?.id ?? null
        })
        setResolving(false)
        setSource(track?.provider === 'yandex' ? 'yandex' : 'youtube')
        toastRef.current('Продолжим с того места — нажми ▶')
        // пока пользователь читает экран, готовим ссылки на текущий и следующий
        // трек: тогда ▶ и «дальше» стартуют почти без паузы
        if (track) window.setTimeout(() => void window.undertow.prewarm(track).catch(() => undefined), 500)
        const nextTrack = saved.tracks[saved.index + 1]
        if (nextTrack) window.setTimeout(() => void window.undertow.prewarm(nextTrack).catch(() => undefined), 3000)
        for (let ahead = 2; ahead <= 4; ahead += 1) {
          const t = saved.tracks[saved.index + ahead]
          if (t) window.setTimeout(() => void window.undertow.prewarm(t).catch(() => undefined), 3500 + ahead * 700)
        }
      } catch {
        /* сохранённой очереди нет — обычный пустой старт */
      }
    })()
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    engineRef.current?.setOptions({ crossfadeSec: crossfade })
    localStorage.setItem('undertow.crossfade', String(crossfade))
  }, [crossfade])

  // клик вне открытого окна закрывает его — так же, как эквалайзер
  useEffect(() => {
    if (!queueOpen && !versions && !lyricsOpen) return
    const onDown = (e: MouseEvent) => {
      const target = e.target
      if (!(target instanceof Element)) return
      if (queueOpen && !target.closest('.queue-panel') && !target.closest('.queue-btn')) {
        setQueueOpen(false)
      }
      if (versions && !target.closest('.versions-menu') && !target.closest('.alt-btn')) {
        setVersions(null)
      }
      if (lyricsOpen && !target.closest('.lyrics-panel') && !target.closest('.lyrics-btn')) {
        setLyricsOpen(false)
      }
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [queueOpen, versions, lyricsOpen])

  useEffect(() => {
    engineRef.current?.setOptions({ normalization: normalize })
    localStorage.setItem('undertow.normalize', normalize ? '1' : '0')
  }, [normalize])

  useEffect(() => {
    engineRef.current?.setEq(eq)
    saveEq(eq)
  }, [eq])

  useEffect(() => {
    engineRef.current?.setOptions({ volume })
    localStorage.setItem('undertow.volume', String(volume))
  }, [volume])

  /* ------------------------------ управление ------------------------------ */

  // активное радио: пока оно задано, очередь дозаправляется само
  const radioRef = useRef<{ id?: string; name: string } | null>(null)
  const radioBusy = useRef(false)

  const refillRadio = useCallback((len: number, index: number) => {
    const radio = radioRef.current
    if (!radio || radioBusy.current) return
    if (index < 0 || len === 0 || index < len - 4) return
    radioBusy.current = true
    void window.undertow
      .radioMore({ id: radio.id, name: radio.name })
      .then((tracks) => {
        if (!tracks.length) {
          // похожие кончились — радио закончилось, очередь остаётся как есть
          radioRef.current = null
          return
        }
        engineRef.current?.appendQueue(tracks)
      })
      .catch(() => {
        radioRef.current = null
      })
      .finally(() => {
        radioBusy.current = false
      })
  }, [])

  // «Течение»: пока оно активно, очередь дозаправляется после каждого трека
  const flowRef = useRef(false)
  const flowBusy = useRef(false)
  const [flowActive, setFlowActive] = useState(false)
  const [releases, setReleases] = useState<{
    loading: boolean
    items: ReleaseItem[]
    updatedAt: number
    artists: number
  } | null>(null)
  const [flowLoading, setFlowLoading] = useState(false)

  const refillFlow = useCallback((len: number, index: number) => {
    if (!flowRef.current || flowBusy.current) return
    if (index < 0 || len === 0 || index < len - 6) return
    flowBusy.current = true
    void window.undertow
      .flowMore()
      .then((tracks) => {
        if (!tracks.length) {
          flowRef.current = false
          setFlowActive(false)
          return
        }
        engineRef.current?.appendQueue(tracks)
      })
      .catch(() => {
        flowRef.current = false
        setFlowActive(false)
      })
      .finally(() => {
        flowBusy.current = false
      })
  }, [])

  const playTrack = useCallback((t: Track, list: Track[]) => {
    const playable = list.filter((x) => x.playable)
    const at = playable.findIndex((x) => x.id === t.id)
    setTrack(t)
    setQuality(null)
    setResolving(true)
    radioRef.current = null
    flowRef.current = false
    setFlowActive(false)
    void engineRef.current?.setQueue(playable, at >= 0 ? at : 0)
  }, [])

  const playSavedAlbum = useCallback(
    (album: SavedAlbum) => {
      const tracks = album.tracks.filter((t) => t.playable)
      if (!tracks.length) {
        toast(`В альбоме «${album.title}» нет доступных треков`, 'error')
        return
      }
      playTrack(tracks[0], tracks)
    },
    [playTrack, toast]
  )

  const loadReleases = useCallback(
    async (force = false) => {
      setReleases((prev) => ({
        loading: true,
        items: prev?.items ?? [],
        updatedAt: prev?.updatedAt ?? 0,
        artists: prev?.artists ?? 0
      }))
      try {
        const res = await window.undertow.releases(force)
        setReleases({ loading: false, ...res })
      } catch (e) {
        setReleases((prev) => (prev ? { ...prev, loading: false } : null))
        toast(`Не получил новинки: ${(e as Error).message}`, 'error')
      }
    },
    [toast]
  )

  useEffect(() => {
    if (view === 'releases' && !releases) void loadReleases()
  }, [view, releases, loadReleases])

  const openReleaseAlbum = useCallback(
    (rel: ReleaseItem) => openAlbum({ id: rel.albumId ? `yt-album:${rel.albumId}` : undefined, title: rel.title, artist: rel.artist }),
    [openAlbum]
  )

  const playRelease = useCallback(
    async (rel: ReleaseItem) => {
      try {
        const page = await window.undertow.albumPage({
          id: rel.albumId ? `yt-album:${rel.albumId}` : undefined,
          title: rel.title,
          artist: rel.artist
        })
        if (!page.tracks.length) {
          toast('В этом релизе нет доступных треков', 'error')
          return
        }
        playTrack(page.tracks[0], page.tracks)
      } catch (e) {
        toast(`Не открылся релиз: ${(e as Error).message}`, 'error')
      }
    },
    [playTrack, toast]
  )

  const startFlow = useCallback(async (options?: FlowOptions) => {
    setFlowLoading(true)
    try {
      const flow = await window.undertow.flowStart(options)
      if (!flow.tracks.length) throw new Error('Не удалось собрать поток')
      playTrack(flow.tracks[0], flow.tracks)
      flowRef.current = true
      setFlowActive(true)
      toast(`${flow.title}: ${flow.tracks.length} треков, дальше подмешается само`)
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error')
    } finally {
      setFlowLoading(false)
    }
  }, [playTrack, toast])

  const flowFeedback = useCallback(
    async (action: 'more' | 'less' | 'skipArtist', t: Track) => {
      try {
        const res = await window.undertow.flowFeedback(action, t)
        if (res.tracks.length) engineRef.current?.appendQueue(res.tracks)
        if (action === 'more') {
          toast(res.tracks.length ? 'Добавил ещё такого же' : 'Этот артист будет звучать чаще')
        } else if (action === 'less') {
          toast('Больше не поставлю этот трек')
          void engineRef.current?.next()
        } else {
          engineRef.current?.removeUpcomingByArtist(t.artist)
          toast(`Пропускаю ${t.artist || 'артиста'} в этом течении`)
          void engineRef.current?.next()
        }
      } catch (e) {
        toast(e instanceof Error ? e.message : String(e), 'error')
      }
    },
    [toast]
  )

  useEffect(() => {
    if (!flowActive || !track) return
    void window.undertow.flowPlayed(track).catch(() => undefined)
  }, [flowActive, track])

  const [radioLoading, setRadioLoading] = useState(false)
  /** «похожее»: радио от конкретного трека (в отличие от радио артиста) */
  const startSimilar = useCallback(
    async (t: Track) => {
      setRadioLoading(true)
      try {
        const res = await window.undertow.radioTrack(t)
        if (!res.tracks.length) throw new Error('Похожих треков не нашлось')
        playTrack(res.tracks[0], res.tracks)
        radioRef.current = null
        toast(`${res.title}: ${res.tracks.length} треков`)
      } catch (e) {
        toast(e instanceof Error ? e.message : String(e), 'error')
      } finally {
        setRadioLoading(false)
      }
    },
    [playTrack, toast]
  )
  const startRadio = useCallback(
    async (ref: { id?: string; name: string }) => {
      setRadioLoading(true)
      try {
        const radio = await window.undertow.artistRadio({ id: ref.id, name: ref.name })
        if (!radio.tracks.length) throw new Error(`Не удалось собрать радио ${ref.name}`)
        playTrack(radio.tracks[0], radio.tracks)
        // playTrack сбрасывает радио, поэтому включаем его после
        radioRef.current = { id: ref.id, name: ref.name }
        toast(`${radio.title}: ${radio.tracks.length} треков, дальше подмешается само`)
      } catch (e) {
        toast(e instanceof Error ? e.message : String(e), 'error')
      } finally {
        setRadioLoading(false)
      }
    },
    [playTrack, toast]
  )


  const toggle = useCallback(() => {
    void engineRef.current?.toggle()
  }, [])

  const go = useCallback((delta: number) => {
    if (delta > 0) void engineRef.current?.next()
    else void engineRef.current?.prev()
  }, [])

  useEffect(
    () =>
      window.undertow.onPlayerCommand((command) => {
        if (command === 'toggle') toggle()
        else if (command === 'next') go(1)
        else go(-1)
      }),
    [toggle, go]
  )

  useEffect(() => {
    window.undertow.reportPlayer({
      playing: snap.playing,
      title: track?.title ?? null,
      artist: track?.artist ?? null,
      source
    })
  }, [snap.playing, track?.id, track?.title, track?.artist, source])

  /* ------------------- подмена на YouTube: прогрев и варианты ------------------ */

  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const warmedRef = useRef<string[]>([])
  const pendingWarmRef = useRef<Track | null>(null)
  const warmingRef = useRef(false)

  const processWarm = useCallback(async (): Promise<void> => {
    if (warmingRef.current) return
    const next = pendingWarmRef.current
    pendingWarmRef.current = null
    if (!next || warmedRef.current.includes(next.id)) return

    warmingRef.current = true
    const warmed = warmedRef.current
    warmed.push(next.id)
    if (warmed.length > 400) warmed.splice(0, warmed.length - 400)
    try {
      await window.undertow.prewarm(next)
    } catch {
      // прогрев не критичен: трек всё равно резолвится при воспроизведении
    } finally {
      warmingRef.current = false
      if (pendingWarmRef.current) void processWarm()
    }
  }, [])

  const hoverPrewarm = useCallback(
    (t: Track) => {
      if (warmedRef.current.includes(t.id)) return
      if (snap.trackId === t.id) return
      if (hoverTimer.current) clearTimeout(hoverTimer.current)
      // держим паузу дольше: yt-dlp — тяжёлый процесс, и курсор часто
      // просто проезжает по списку, не задерживаясь на треке
      hoverTimer.current = setTimeout(() => {
        pendingWarmRef.current = t
        void processWarm()
      }, 250)
    },
    [snap.trackId, processWarm]
  )

  // работаем с треком из очереди, а не с показанным: у выбранного варианта
  // свой id, и закрепление должно остаться за оригиналом
  const queueTrackOf = useCallback(() => engineRef.current?.queueTrack() ?? track, [track])

  const openVersions = useCallback(async () => {
    const t = versionBaseRef.current ?? queueTrackOf()
    if (!t) return
    versionBaseRef.current = t
    setVersions({ loading: true, list: [] })
    try {
      const list = await window.undertow.versions(t)
      versionIdsRef.current = new Set(list.map((v) => v.track.id))
      setVersions({ loading: false, list })
    } catch (e) {
      setVersions(null)
      toast(`Не получил версии: ${(e as Error).message}`, 'error')
    }
  }, [queueTrackOf, toast])

  // версия — обычный трек: очередь собираем из всего списка, чтобы можно было
  // листать переделки вперёд-назад
  const pickVersion = useCallback(
    (v: TrackVersion) => {
      const base = versionBaseRef.current ?? queueTrackOf()
      const list = versions?.list ?? []
      const queue = [v.track, ...list.map((x) => x.track).filter((t) => t.id !== v.track.id)]
      playTrack(v.track, queue)
      versionBaseRef.current = base
      versionIdsRef.current = new Set(queue.map((t) => t.id))
      setVersions(null)
      toast(`«${v.label}» — ${v.title}`, 'info')
    },
    [playTrack, queueTrackOf, toast, versions]
  )

  const addVersion = useCallback(
    (v: TrackVersion) => {
      engineRef.current?.addToQueue(v.track, 'end')
      toast(`«${v.title}» в очереди`)
    },
    [toast]
  )

  // переключились на другой трек — старый список версий больше не актуален
  useEffect(() => {
    const id = track?.id
    const base = versionBaseRef.current
    if (!id) {
      versionBaseRef.current = null
      return
    }
    if (!base || id === base.id || versionIdsRef.current.has(id)) return
    versionBaseRef.current = null
    setVersions(null)
  }, [track?.id])

  const restoreOriginal = useCallback(async () => {
    const t = queueTrackOf()
    if (!t) return
    setVersions(null)
    try {
      await window.undertow.fallbackUnpin(t)
      await engineRef.current?.reload()
      toast('Вернул оригинал трека')
    } catch (e) {
      toast(`Не получилось вернуть оригинал: ${(e as Error).message}`, 'error')
    }
  }, [queueTrackOf, toast])

  const addToQueue = useCallback(
    (t: Track) => {
      const engine = engineRef.current
      if (!engine) return
      engine.addToQueue(t, 'end')
      toast(`«${t.title}» в очереди`)
    },
    [toast]
  )

  const onLocked = useCallback(
    (t: Track) =>
      toast(
        t.kind === 'album'
          ? `«${t.title}»: страницы альбомов появятся позже — сейчас треки берём из ленты и поиска.`
          : `«${t.title}»: этот раздел ещё не подключён.`
      ),
    [toast]
  )

  // Space — пауза/играть, Alt+стрелки — переключение
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return
      if (e.code === 'Space') {
        e.preventDefault()
        toggle()
      } else if (e.key === 'ArrowRight' && e.altKey) {
        go(1)
      } else if (e.key === 'ArrowLeft' && e.altKey) {
        go(-1)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [toggle, go])

  const primaryLabel =
    state?.primary === 'yandex'
      ? `Яндекс${state.yandex.login ? ` · ${state.yandex.login}` : ''} + YouTube`
      : state?.youtube.ready
        ? `YouTube · yt-dlp ${state.youtube.ytdlp}`
        : 'yt-dlp не найден'

  return (
    <div className={`app${theaterOpen ? ' theater-on' : ''}${mini ? ' mini-on' : ''}`}>
      <header className="titlebar">
        <div className="brand">
          <img className="brand-mark" src={appIcon} alt="" draggable={false} />
          <span className="brand-name">Undertow</span>
          <span className="brand-by">
            by <b>N3WERS</b>
          </span>
          <span className="brand-ver" title={`Версия ${APP_VERSION}`}>
            v{APP_VERSION}
          </span>
        </div>
        <span className="titlebar-spacer" />
        <button
          className={`status-chip dpi-chip update-chip ${
            update?.status === 'available' ||
            update?.status === 'downloading' ||
            update?.status === 'downloaded'
              ? 'on'
              : update?.status === 'error'
                ? 'off'
                : ''
          }`}
          onClick={() => {
            closeBrowse()
            setSettingsFocus('updates')
            setView('settings')
          }}
          title={
            update?.status === 'available'
              ? `Доступно обновление ${update.version}`
              : update?.status === 'downloading'
                ? `Скачиваю обновление: ${update.progress}%`
                : update?.status === 'downloaded'
                  ? 'Обновление скачано — установить в настройках'
                  : update?.status === 'checking'
                    ? 'Проверяю обновления'
                    : update?.status === 'error'
                      ? `Обновление: ${update.error ?? 'ошибка'}`
                      : update?.status === 'none'
                        ? 'Установлена последняя версия'
                        : 'Открыть настройки обновлений'
          }
          aria-label="Обновления приложения"
        >
          <span
            className={`dot${
              update?.status === 'error'
                ? ' bad'
                : update?.status === 'checking' || update?.status === 'idle'
                  ? ' yt'
                  : ''
            }`}
          />
          <span className="status-text update-chip-text">
            {update?.status === 'available'
              ? `Обновление ${update.version}`
              : update?.status === 'downloading'
                ? `Обновление · ${update.progress}%`
                : update?.status === 'downloaded'
                  ? 'Обновление готово'
                  : update?.status === 'checking'
                    ? 'Проверяю обновления'
                    : update?.status === 'error'
                      ? 'Ошибка обновления'
                      : update?.status === 'none'
                        ? 'Обновлений нет'
                        : 'Обновления'}
          </span>
        </button>
        <button
          className={`status-chip dpi-chip ${dpi?.state === 'on' || dpi?.running ? 'on' : 'off'}`}
          onClick={() => {
            closeBrowse()
            setSettingsFocus('dpi')
            setView('settings')
          }}
          title={
            dpi === null
              ? 'Проверяю UndertowDPI'
              : dpi.state === 'on'
                ? 'UndertowDPI включён'
                : dpi.state === 'starting'
                  ? 'UndertowDPI запускается'
                  : dpi.state === 'error'
                    ? `UndertowDPI: ${dpi.error ?? 'ошибка'}`
                    : 'UndertowDPI выключен — открыть настройки'
          }
          aria-label="UndertowDPI"
        >
          <span className={`dot${dpi?.state === 'on' || dpi?.running ? '' : ' yt'}`} />
          <span>UndertowDPI</span>
        </button>
        <span className="status-chip" title={primaryLabel}>
          <span className={`dot${state?.youtube.ready || state?.yandex.active ? '' : ' bad'}`} />
          <span className="status-text">{primaryLabel}</span>
        </span>
        <button
          className="titlebar-mini"
          onClick={() => void window.undertow.setMini(true)}
          title="Открыть мини-плеер"
          aria-label="Открыть мини-плеер"
        >
          <IconShrink width={15} height={15} />
        </button>
      </header>

      <div className="body">
        <Sidebar
          view={view}
          onChange={(v) => {
            closeBrowse()
            setSettingsFocus(null)
            setView(v)
          }}
          state={state}
        />

        <main className="content">
          {browse && (
            <BrowseView
              kind={browse.kind}
              loading={browseLoading}
              error={browseError}
              page={browsePage}
              currentId={currentId}
              playing={snap.playing}
              likedIds={likedIds}
              onPlay={playTrack}
              onToggle={toggle}
              onLike={toggleLike}
              onHover={hoverPrewarm}
              onAddToQueue={addToQueue}
              onBack={backFromBrowse}
              onOpenAlbum={openAlbum}
              onOpenArtist={openArtist}
              onRadio={() => void startRadio({ id: browse.id, name: browse.name ?? browse.title })}
              radioLoading={radioLoading}
              onAddToPlaylist={setPickerTrack}
              onSimilar={(t) => void startSimilar(t)}
              albumSaved={Boolean(savedAlbum)}
              onToggleAlbum={() => void toggleSavedAlbum()}
            />
          )}

          {!browse && view === 'home' && (
            <Home
              sections={sections}
              chart={chart}
              chartScope={chartScope}
              chartLoading={chartLoading}
              onChartScope={changeChartScope}
              loading={loading}
              error={homeError}
              currentId={currentId}
              playing={snap.playing}
              onPlay={playTrack}
              onToggle={toggle}
              onLocked={onLocked}
              likedIds={likedIds}
              onLike={toggleLike}
              onHover={hoverPrewarm}
              onAddToQueue={addToQueue}
              onRefresh={() => void refreshHome()}
              refreshing={refreshing}
              onOpenPage={(kind, target) => openPage({ kind, ...target })}
              onHideSection={(id) => void hideSection(id)}
              hiddenCount={hidden.length}
              onRestoreHidden={() => void restoreHidden()}
              onAddToPlaylist={setPickerTrack}
              onSimilar={(t) => void startSimilar(t)}
              onOpenArtist={openArtist}
              onOpenAlbum={openAlbum}
            />
          )}

          {!browse && view === 'releases' && (
            <ReleasesView
              data={releases}
              onRefresh={() => void loadReleases(true)}
              onOpenAlbum={openReleaseAlbum}
              onArtist={(rel) => openArtist({ id: rel.artistId, name: rel.artist })}
              onPlay={(rel) => void playRelease(rel)}
            />
          )}

          {!browse && view === 'flow' && (
            <FlowView
              queue={queueState.queue}
              index={queueState.index}
              playing={snap.playing}
              active={flowActive}
              loading={flowLoading}
              onStart={(options) => void startFlow(options)}
              onPlay={playTrack}
              onToggle={toggle}
              onArtistRadio={(name) => void startRadio({ name })}
              onFeedback={flowFeedback}
              onToast={toast}
              radioLoading={radioLoading}
              onHover={hoverPrewarm}
            />
          )}

          {!browse && view === 'search' && (
            <SearchView
              currentId={currentId}
              playing={snap.playing}
              onPlay={playTrack}
              onToggle={toggle}
              likedIds={likedIds}
              onLike={toggleLike}
              onHover={hoverPrewarm}
              onAddToQueue={addToQueue}
              onOpenArtist={openArtist}
              onOpenAlbum={openAlbum}
              onOpenPlaylist={openPlaylist}
              onAddToPlaylist={setPickerTrack}
              onSimilar={(t) => void startSimilar(t)}
            />
          )}

          {!browse && view === 'saved' && (
            <SavedView
              currentId={currentId}
              playing={snap.playing}
              likedIds={likedIds}
              onPlay={playTrack}
              onToggle={toggle}
              onLike={toggleLike}
              onHover={hoverPrewarm}
              onAddToQueue={addToQueue}
              onOpenArtist={openArtist}
              onOpenAlbum={openAlbum}
              onAddToPlaylist={setPickerTrack}
              onSimilar={(t) => void startSimilar(t)}
            />
          )}

          {!browse && view === 'playlists' && (
            <PlaylistsView
              canImport={Boolean(state?.yandex.active)}
              currentId={currentId}
              playing={snap.playing}
              likedIds={likedIds}
              onPlay={playTrack}
              onToggle={toggle}
              onLike={toggleLike}
              onHover={hoverPrewarm}
              onAddToQueue={addToQueue}
              onAddToPlaylist={setPickerTrack}
              onSimilar={(t) => void startSimilar(t)}
              onOpenArtist={openArtist}
              onOpenAlbum={openAlbum}
              onToast={toast}
            />
          )}

          {!browse && view === 'settings' && (
            <Settings
              state={state}
              onState={(next) => {
                setState(next)
                void loadHome()
              }}
              onToast={toast}
              crossfade={crossfade}
              onCrossfade={(v) => setCrossfade(Math.max(0, Math.min(15, Math.round(v))))}
              normalize={normalize}
              onNormalize={setNormalize}
              eq={eq}
              onEq={setEq}
              dpi={dpi}
              onDpi={setDpi}
              focus={settingsFocus}
              onFocusDone={() => setSettingsFocus(null)}
            />
          )}

          {!browse && view === 'library' && (
            <LibraryView
              likes={lib.likes}
              history={lib.history}
              albums={savedAlbums}
              likedIds={likedIds}
              currentId={currentId}
              playing={snap.playing}
              canImport={Boolean(state?.yandex.active)}
              yandexActive={Boolean(state?.yandex.active)}
              importing={importing}
              onPlay={playTrack}
              onToggle={toggle}
              onLike={toggleLike}
              onLocked={onLocked}
              onHover={hoverPrewarm}
              onAddToQueue={addToQueue}
              onOpenArtist={openArtist}
              onOpenAlbum={openAlbum}
              onAddToPlaylist={setPickerTrack}
              onSimilar={(t) => void startSimilar(t)}
              onImport={() => void importLikes()}
              onClearHistory={() => {
                void window.undertow.clearHistory().then(() => {
                  setLib((prev) => ({ ...prev, history: [] }))
                  toast('История очищена')
                })
              }}
              onPlayAlbum={playSavedAlbum}
              onRemoveAlbum={(album) => void removeSavedAlbum(album)}
            />
          )}
        </main>
      </div>

      <PlayerBar
        track={track}
        playing={snap.playing}
        resolving={resolving}
        progress={snap.time}
        duration={snap.duration}
        volume={volume}
        quality={quality}
        source={source}
        copyLabel={copyLabel}
        versions={versions}
        onVersions={() => {
          if (versions) setVersions(null)
          else {
            setQueueOpen(false)
            setLyricsOpen(false)
            void openVersions()
          }
        }}
        onPickVersion={pickVersion}
        onAddVersion={addVersion}
        onRestoreOriginal={() => void restoreOriginal()}
        liked={track ? likedIds.has(track.id) : false}
        onLike={() => track && toggleLike(track)}
        normalize={normalize}
        onNormalize={setNormalize}
        eq={eq}
        onEq={setEq}
        onClosePanels={() => {
          setQueueOpen(false)
          setLyricsOpen(false)
          setVersions(null)
          setPickerTrack(null)
        }}
        onToggle={toggle}
        onNext={() => go(1)}
        onPrev={() => go(-1)}
        onSeek={(sec) => {
          engineRef.current?.seek(sec)
          setProgress(sec, snap.duration, 0)
        }}
        onVolume={setVolume}
        onOpenArtist={openArtist}
        onOpenAlbum={openAlbum}
        queueCount={queueState.queue.length}
        queueOpen={queueOpen}
        shuffled={queueState.shuffled}
        onShuffle={(on) => engineRef.current?.setShuffle(on)}
        repeat={repeat}
        onCycleRepeat={() => engineRef.current?.cycleRepeat()}
        onToggleQueue={() => {
          if (!queueOpen) {
            setVersions(null)
            setLyricsOpen(false)
          }
          setQueueOpen(!queueOpen)
        }}
        lyricsOpen={lyricsOpen}
        onToggleLyrics={() => {
          if (!lyricsOpen) {
            setQueueOpen(false)
            setVersions(null)
          }
          setLyricsOpen(!lyricsOpen)
        }}
        hasLyrics={hasLyrics}
        onRadio={() => track && void startSimilar(track)}
        radioLoading={radioLoading}
        onAddToPlaylist={() => track && setPickerTrack(track)}
        onExpand={() => {
          if (!track) return
          setQueueOpen(false)
          setLyricsOpen(false)
          setVersions(null)
          setTheaterOpen(true)
        }}
        onFindMusic={() => {
          closeBrowse()
          setSettingsFocus(null)
          setView('search')
        }}
      />

      {theaterOpen && track ? (
        <NowPlaying
          track={track}
          playing={snap.playing}
          resolving={resolving}
          progress={snap.time}
          duration={snap.duration}
          volume={volume}
          quality={quality}
          source={source}
          copyLabel={copyLabel}
          versions={versions}
          onVersions={() => {
            if (versions) setVersions(null)
            else {
              setQueueOpen(false)
              setLyricsOpen(false)
              void openVersions()
            }
          }}
          onPickVersion={pickVersion}
          onAddVersion={addVersion}
          onRestoreOriginal={() => void restoreOriginal()}
          queue={queueState.queue}
          queueIndex={queueState.index}
          queueShuffled={queueState.shuffled}
          onQueuePlay={(i) => void engineRef.current?.playAt(i)}
          onQueueMove={(from, to) => engineRef.current?.moveInQueue(from, to)}
          onQueueRemove={(i) => engineRef.current?.removeFromQueue(i)}
          onQueueShuffle={(on) => engineRef.current?.setShuffle(on)}
          onQueueClear={() => {
            engineRef.current?.clearQueue()
            radioRef.current = null
            flowRef.current = false
            setFlowActive(false)
            setTrack(null)
            setQuality(null)
            setCopyLabel(null)
            setSource(null)
            void window.undertow.queueClear().catch(() => undefined)
            toast('Очередь очищена')
          }}
          queueOpen={queueOpen}
          onToggleQueue={() => {
            if (!queueOpen) {
              setVersions(null)
              setLyricsOpen(false)
            }
            setQueueOpen(!queueOpen)
          }}
          lyricsOpen={lyricsOpen}
          onToggleLyrics={() => {
            if (!lyricsOpen) {
              setQueueOpen(false)
              setVersions(null)
            }
            setLyricsOpen(!lyricsOpen)
          }}
          hasLyrics={hasLyrics}
          normalize={normalize}
          onNormalize={setNormalize}
          liked={track ? likedIds.has(track.id) : false}
          onLike={() => track && toggleLike(track)}
          onToggle={toggle}
          onNext={() => go(1)}
          onPrev={() => go(-1)}
          onSeek={(sec) => {
            engineRef.current?.seek(sec)
            setProgress(sec, snap.duration, 0)
          }}
          onVolume={setVolume}
          onOpenArtist={openArtist}
          onOpenAlbum={openAlbum}
          onRadio={() => void startSimilar(track)}
          radioLoading={radioLoading}
          onAddToPlaylist={() => setPickerTrack(track)}
          escBlocked={Boolean(pickerTrack)}
          onClose={() => {
            setTheaterOpen(false)
            setVersions(null)
            setQueueOpen(false)
            setLyricsOpen(false)
          }}
        />
      ) : null}

      {lyricsOpen && (
        <LyricsPanel
          track={track}
          shifted={queueOpen}
          onClose={() => setLyricsOpen(false)}
          onSeek={(sec) => {
            engineRef.current?.seek(sec)
            setProgress(sec, snap.duration, 0)
          }}
        />
      )}

      {queueOpen && (
        <QueuePanel
          queue={queueState.queue}
          index={queueState.index}
          shuffled={queueState.shuffled}
          repeat={repeat}
          playing={snap.playing}
          onClose={() => setQueueOpen(false)}
          onPlay={(i) => void engineRef.current?.playAt(i)}
          onMove={(from, to) => engineRef.current?.moveInQueue(from, to)}
          onRemove={(i) => engineRef.current?.removeFromQueue(i)}
          onShuffle={(on) => engineRef.current?.setShuffle(on)}
          onCycleRepeat={() => engineRef.current?.cycleRepeat()}
          onClear={() => {
            engineRef.current?.clearQueue()
            radioRef.current = null
            flowRef.current = false
            setFlowActive(false)
            setTrack(null)
            setQuality(null)
            setCopyLabel(null)
            setSource(null)
            void window.undertow.queueClear().catch(() => undefined)
            toast('Очередь очищена')
          }}
        />
      )}

      <PlaylistPicker
        track={pickerTrack}
        onClose={() => setPickerTrack(null)}
        onAdded={(title) => toast(`Добавлено в «${title}»`)}
        onToast={toast}
      />

      {mini ? (
        <MiniPlayer
          track={track}
          playing={snap.playing}
          resolving={resolving}
          duration={snap.duration}
          volume={volume}
          source={source}
          quality={quality}
          queue={queueState.queue}
          queueIndex={queueState.index}
          shuffled={queueState.shuffled}
          repeat={repeat}
          liked={track ? likedIds.has(track.id) : false}
          onLike={() => track && toggleLike(track)}
          onToggle={toggle}
          onNext={() => go(1)}
          onPrev={() => go(-1)}
          onSeek={(sec) => {
            engineRef.current?.seek(sec)
            setProgress(sec, snap.duration, 0)
          }}
          onVolume={setVolume}
          onPlayAt={(i) => void engineRef.current?.playAt(i)}
          onShuffle={(on) => engineRef.current?.setShuffle(on)}
          onCycleRepeat={() => engineRef.current?.cycleRepeat()}
          onRestore={() => void window.undertow.setMini(false)}
        />
      ) : null}

      {closeAsk ? (
        <CloseDialog
          onTray={() => closeAction('tray')}
          onQuit={() => closeAction('quit')}
          onCancel={() => closeAction('cancel')}
        />
      ) : null}

      <div className="toasts">
        {toasts.map((t) => (
          <div key={t.id} className={`toast${t.kind === 'error' ? ' error' : ''}`}>
            <span>{t.text}</span>
            {t.action && (
              <button
                className="toast-action"
                onClick={() => {
                  t.action?.run()
                  setToasts((prev) => prev.filter((x) => x.id !== t.id))
                }}
              >
                {t.action.label}
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
