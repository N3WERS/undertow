import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Sidebar, { type View } from './components/Sidebar'
import HomeView from './components/Home'
import FlowView from './components/FlowView'
import SearchViewBase from './components/SearchView'
import Settings from './components/Settings'
import LibraryView from './components/LibraryView'
import QueuePanel from './components/QueuePanel'
import BrowseView from './components/BrowseView'
import ReleasesView from './components/ReleasesView'
import PlaylistsView from './components/PlaylistsView'
import PlaylistPicker from './components/PlaylistPicker'
import LyricsPanel from './components/LyricsPanel'
import PlayerBar from './components/PlayerBar'
import { AudioEngine, type Snapshot } from './audio/engine'
import type { BrowsePage, LibrarySnapshot, ProviderState, ReleaseItem, Section, Track, TrackVersion } from './types'
import { APP_VERSION } from './version'

// лента и поиск не должны перерисовываться 10 раз в секунду из-за прогресса плеера
const Home = memo(HomeView)
const SearchView = memo(SearchViewBase)

interface Toast {
  id: number
  text: string
  kind: 'info' | 'error'
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
  const [loading, setLoading] = useState(true)
  const [homeError, setHomeError] = useState<string | null>(null)
  const [state, setState] = useState<ProviderState | null>(null)
  const [toasts, setToasts] = useState<Toast[]>([])

  const [snap, setSnap] = useState<Snapshot>(EMPTY_SNAP)
  const [track, setTrack] = useState<Track | null>(null)
  const [quality, setQuality] = useState<string | null>(null)
  const [source, setSource] = useState<'yandex' | 'youtube' | null>(null)
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
  const [resolving, setResolving] = useState(false)
  const [volume, setVolume] = useState(() => readNum('undertow.volume', 0.85))
  const [crossfade, setCrossfade] = useState(() => readNum('undertow.crossfade', 0))
  const [normalize, setNormalize] = useState(() => localStorage.getItem('undertow.normalize') !== '0')

  const [lib, setLib] = useState<LibrarySnapshot>({ likes: [], history: [], stats: { likes: 0, history: 0, updatedAt: null } })
  const [importing, setImporting] = useState(false)

  const engineRef = useRef<AudioEngine | null>(null)
  const toastRef = useRef<(text: string, kind?: Toast['kind']) => void>(() => undefined)
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

  const toast = useCallback((text: string, kind: Toast['kind'] = 'info') => {
    const id = ++toastSeq
    setToasts((prev) => [...prev.slice(-2), { id, text, kind }])
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 5200)
  }, [])
  toastRef.current = toast

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

  /** Куда ведёт переход: id (Яндекс) или имя (YouTube-страница без id). */
  interface BrowseTarget {
    kind: 'artist' | 'album'
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
    try {
      setSections(await window.undertow.refreshHome())
      toast('Подборка пересобрана')
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error')
    } finally {
      setRefreshing(false)
    }
  }, [toast])

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

  /* ------------------- очередь между запусками (queue.json) ----------------- */

  const queueTimeRef = useRef(0)
  const queueMetaRef = useRef({ index: -1, shuffled: false })
  const lastTouchRef = useRef(0)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const persistQueue = useCallback((queue: Track[], index: number, shuffled: boolean) => {
    if (!queue.length) return
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => {
      saveTimerRef.current = null
      void window.undertow
        .queueSave({ tracks: queue, index, shuffled, time: queueTimeRef.current })
        .catch(() => undefined)
    }, 600)
  }, [])

  /* ------------------------------ движок звука ---------------------------- */

  useEffect(() => {
    const engine = new AudioEngine({
      onSnapshot: (s) => {
        setSnap(s)
        queueTimeRef.current = s.time
        if (s.duration > 0) setResolving(false)
        // позицию достаточно сохранять раз в пять секунд — очередь пишется тем же файлом
        if (queueMetaRef.current.index >= 0 && s.duration > 0) {
          const now = performance.now()
          if (now - lastTouchRef.current > 5000) {
            lastTouchRef.current = now
            void window.undertow.queueTime(queueMetaRef.current.index, s.time).catch(() => undefined)
          }
        }
      },
      onTrackChange: (t) => {
        setTrack(t)
        // полоска не должна показывать позицию прошлого трека, пока грузится новый
        setSnap((prev) => ({
          ...prev,
          time: 0,
          duration: t?.durationSec ?? 0,
          trackId: t?.id ?? null
        }))
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
      onError: (m) => toastRef.current(m, 'error'),
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
        engine.restore(saved.tracks, saved.index, saved.shuffled, saved.time)
        queueTimeRef.current = saved.time
        queueMetaRef.current = { index: saved.index, shuffled: saved.shuffled }
        setTrack(track ?? null)
        setQueueState({ queue: saved.tracks, index: saved.index, shuffled: saved.shuffled })
        setSnap({
          playing: false,
          time: saved.time,
          duration: track?.durationSec ?? 0,
          rms: 0,
          gainDb: 0,
          trackId: track?.id ?? null
        })
        setResolving(false)
        setSource(track?.provider === 'yandex' ? 'yandex' : 'youtube')
        toastRef.current('Продолжим с того места — нажми ▶')
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

  useEffect(() => {
    engineRef.current?.setOptions({ normalization: normalize })
    localStorage.setItem('undertow.normalize', normalize ? '1' : '0')
  }, [normalize])

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

  const startFlow = useCallback(async (genre?: string) => {
    setFlowLoading(true)
    try {
      const flow = await window.undertow.flowStart(genre)
      if (!flow.tracks.length) throw new Error('Не удалось собрать поток')
      playTrack(flow.tracks[0], flow.tracks)
      flowRef.current = true
      setFlowActive(true)
      toast(
        genre
          ? `Течение: ${genre} — ${flow.tracks.length} треков`
          : `Течение: ${flow.tracks.length} треков, дальше подмешается само`
      )
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error')
    } finally {
      setFlowLoading(false)
    }
  }, [playTrack, toast])

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

  /* ------------------- подмена на YouTube: прогрев и варианты ------------------ */

  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const warmedRef = useRef(new Set<string>())
  const hoverPrewarm = useCallback(
    (t: Track) => {
      if (warmedRef.current.has(t.id)) return
      if (snap.trackId === t.id) return
      if (hoverTimer.current) clearTimeout(hoverTimer.current)
      // небольшая задержка: не дёргаем yt-dlp, если курсор просто проехал мимо
      hoverTimer.current = setTimeout(() => {
        warmedRef.current.add(t.id)
        void window.undertow.prewarm(t)
      }, 120)
    },
    [snap.trackId]
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

  const playOriginalVersion = useCallback(() => {
    const t = versionBaseRef.current ?? queueTrackOf()
    if (!t) return
    setVersions(null)
    versionIdsRef.current = new Set()
    playTrack(t, [t])
  }, [playTrack, queueTrackOf])

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
    <div className="app">
      <header className="titlebar">
        <div className="brand">
          <span className="brand-mark">
            <i />
            <i />
            <i />
            <i />
          </span>
          <span className="brand-name">Undertow</span>
          <span className="brand-by">
            by <b>N3WERS</b>
          </span>
          <span className="brand-ver" title={`Версия ${APP_VERSION}`}>
            v{APP_VERSION}
          </span>
        </div>
        <span className="titlebar-spacer" />
        <span className="status-chip">
          <span className={`dot${state?.youtube.ready || state?.yandex.active ? '' : ' bad'}`} />
          {primaryLabel}
        </span>
      </header>

      <div className="body">
        <Sidebar
          view={view}
          onChange={(v) => {
            closeBrowse()
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
            />
          )}

          {!browse && view === 'home' && (
            <Home
              sections={sections}
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
              onStart={(genre) => void startFlow(genre)}
              onPlay={playTrack}
              onToggle={toggle}
              onArtistRadio={(name) => void startRadio({ name })}
              radioLoading={radioLoading}
              onHover={hoverPrewarm}
              getSpectrum={() => engineRef.current?.spectrum() ?? null}
              getEnergy={() => engineRef.current?.energy() ?? 0}
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
              onCrossfade={setCrossfade}
              normalize={normalize}
              onNormalize={setNormalize}
            />
          )}

          {!browse && view === 'library' && (
            <LibraryView
              likes={lib.likes}
              history={lib.history}
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
        onVersions={() => (versions ? setVersions(null) : void openVersions())}
        onPickVersion={pickVersion}
        onAddVersion={addVersion}
        onPlayOriginal={playOriginalVersion}
        onRestoreOriginal={() => void restoreOriginal()}
        liked={track ? likedIds.has(track.id) : false}
        onLike={() => track && toggleLike(track)}
        normalize={normalize}
        level={snap.rms}
        onNormalize={setNormalize}
        onToggle={toggle}
        onNext={() => go(1)}
        onPrev={() => go(-1)}
        onSeek={(sec) => {
          engineRef.current?.seek(sec)
          setSnap((s) => ({ ...s, time: sec }))
        }}
        onVolume={setVolume}
        onOpenArtist={openArtist}
        onOpenAlbum={openAlbum}
        queueCount={queueState.queue.length}
        queueOpen={queueOpen}
        onToggleQueue={() => setQueueOpen((v) => !v)}
        lyricsOpen={lyricsOpen}
        onToggleLyrics={() => setLyricsOpen((v) => !v)}
        hasLyrics={hasLyrics}
      />

      {lyricsOpen && (
        <LyricsPanel
          track={track}
          time={snap.time}
          shifted={queueOpen}
          onClose={() => setLyricsOpen(false)}
          onSeek={(sec) => {
            engineRef.current?.seek(sec)
            setSnap((s) => ({ ...s, time: sec }))
          }}
        />
      )}

      {queueOpen && (
        <QueuePanel
          queue={queueState.queue}
          index={queueState.index}
          shuffled={queueState.shuffled}
          playing={snap.playing}
          onClose={() => setQueueOpen(false)}
          onPlay={(i) => void engineRef.current?.playAt(i)}
          onMove={(from, to) => engineRef.current?.moveInQueue(from, to)}
          onRemove={(i) => engineRef.current?.removeFromQueue(i)}
          onShuffle={(on) => engineRef.current?.setShuffle(on)}
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

      <div className="toasts">
        {toasts.map((t) => (
          <div key={t.id} className={`toast${t.kind === 'error' ? ' error' : ''}`}>
            {t.text}
          </div>
        ))}
      </div>
    </div>
  )
}
