/**
 * Аудио-движок Undertow.
 *
 * Задачи:
 *  1. gapless / кроссфейд — два <audio> элемента в одном графе Web Audio,
 *     следующий трек прогревается заранее, переключение идёт по кривой без паузы;
 *  2. нормализация громкости — измеряем RMS через AnalyserNode и медленно
 *     подтягиваем общий гейн к целевому уровню, ограничитель ловит пики;
 *  3. всё это возможно только потому, что звук идёт через локальный прокси
 *     с CORS (main/audioProxy.ts), иначе MediaElementSource даёт тишину.
 */
import type { ResolvedStream, Track } from '../types'
import { EQ_BANDS, clampEq, DEFAULT_EQ, type EqSettings } from './eq'
import type HlsType from 'hls.js'

/** off — не повторять; all — очередь по кругу; one — текущий трек */
export type RepeatMode = 'off' | 'all' | 'one'

export interface Snapshot {
  playing: boolean
  time: number
  duration: number
  rms: number
  gainDb: number
  trackId: string | null
}

export interface EngineHandlers {
  onSnapshot(s: Snapshot): void
  onTrackChange(track: Track | null): void
  /** очередь изменилась: состав, порядок или текущая позиция */
  onQueue(queue: Track[], index: number, shuffled: boolean): void
  onRepeat(mode: RepeatMode): void
  onError(message: string, retry?: () => void): void
  onQuality(label: string | null): void
  /** трек играет найденной копией с YouTube (Яндекс был недоступен) */
  /**
   * Играет копия с YouTube. kind='fallback' — Яндекс был недоступен,
   * kind='variant' — вариант выбран вручную. null — играет оригинал.
   */
  onCopy(
    /** строка-подпись под треком («оригинал: …» или «копия: …») */
    sub: string | null,
    kind: 'fallback' | 'variant',
    approximate: boolean,
    /** что играет прямо сейчас — название копии */
    main: string | null
  ): void
  /** откуда реально играет трек — для значка в плеере */
  onSource(source: 'yandex' | 'youtube' | 'local' | 'soundcloud' | null, fallback: boolean): void
}

export interface EngineOptions {
  crossfadeSec: number
  normalization: boolean
  volume: number
}

const TARGET_RMS_DB = -18
const MAX_BOOST_DB = 12

const dbToGain = (db: number) => Math.pow(10, db / 20)
const gainToDb = (g: number) => 20 * Math.log10(Math.max(g, 1e-6))

/**
 * play() отменяется pause() при быстром переключении или повторном клике.
 * Это штатная гонка HTMLMediaElement, а не ошибка загрузки — не показываем её.
 */
const withTimeout = <T>(p: Promise<T>, ms: number, message: string): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms)
    p.then(
      (v) => {
        clearTimeout(timer)
        resolve(v)
      },
      (e) => {
        clearTimeout(timer)
        reject(e)
      }
    )
  })

const playInterrupted = (e: unknown): boolean => {
  const err = e as { name?: string; message?: string } | null
  return (
    err?.name === 'AbortError' ||
    err?.name === 'NotSupportedError' ||
    /interrupted by a call to pause|play\(\) request was interrupted|no supported source/i.test(
      err?.message ?? ''
    )
  )
}

export class AudioEngine {
  private ctx: AudioContext | null = null
  private els: HTMLAudioElement[] = []
  private gains: GainNode[] = []
  private hls: (HlsType | null)[] = [null, null]
  /** отменяет устаревшую асинхронную загрузку hls.js */
  private hlsTicket = [0, 0]
  private master: GainNode | null = null
  /** измерительный вход нормализации: до EQ и до лимитера */
  private normAnalyser: AnalyserNode | null = null
  /** общий вход эквалайзера: preamp → 10 фильтров → лимитер */
  private eqPreamp: GainNode | null = null
  private eqNodes: BiquadFilterNode[] = []
  private limiter: DynamicsCompressorNode | null = null
  /** включён ли сейчас обход цепочки эквалайзера */
  private eqActive = true
  /** direct — без нормы и EQ, processed — через рабочие узлы */
  private routeMode: 'direct' | 'processed' | null = null
  private buf: Float32Array = new Float32Array(2048)

  private queue: Track[] = []
  private index = -1
  private active = 0
  private playing = false
  private switching = false
  /**
   * Номер текущего переключения. Любой отложенный commitSwitch сверяет его
   * с актуальным: если между постановкой таймера и его срабатыванием случился
   * ручной переход или ещё одно переключение, таймер обязан промолчать.
   * Без этого быстрые «пролистывания в конец» давали рассинхрон: в панели
   * следующий трек, в динамиках — предыдущий.
   */
  private switchToken = 0
  private destroyed = false
  private loadedId: (string | null)[] = [null, null]
  /** что именно загружено в каждый слот: mime/битрейт/признак подмены */
  private loadedInfo: (ResolvedStream | null)[] = [null, null]
  /** на текущем треке уже была одна попытка перезапросить поток */
  private activeAttempts = 0
  /** пока идёт перезапрос URL, старые ошибки элемента игнорируем */
  private retrying = false
  /** сторож загрузки: не даёт переходу зависнуть на «вечном» buffering */
  private loadTimer: ReturnType<typeof setTimeout> | null = null
  private preloadToken = 0
  /** хвост очереди в исходном порядке — чтобы выключить перемешивание */
  private shuffleTail: Track[] | null = null
  /** позиция, с которой нужно начать после восстановления очереди */
  private shuffled = false
  private repeat: RepeatMode = 'off'

  private opts: EngineOptions = { crossfadeSec: 0, normalization: true, volume: 0.85 }
  private eq: EqSettings = clampEq(DEFAULT_EQ)
  private normDb = 0
  private rms = 0
  private raf = 0
  private timer: ReturnType<typeof setTimeout> | null = null
  private lastEmit = 0
  private lastNormalize = 0
  private lastQuality: string | null = null

  constructor(private handlers: EngineHandlers) {
    this.loop = this.loop.bind(this)
    this.onVisibility = this.onVisibility.bind(this)
    document.addEventListener('visibilitychange', this.onVisibility)
  }

  /* ------------------------------- граф ---------------------------------- */

  private ensureGraph(): AudioContext {
    if (this.ctx) return this.ctx
    const ctx = new AudioContext({ latencyHint: 'playback' })
    this.ctx = ctx

    const master = ctx.createGain()
    master.gain.value = this.opts.volume

    // ограничитель: страхует от клиппинга, когда нормализация поднимает тихий трек
    const comp = ctx.createDynamicsCompressor()
    comp.threshold.value = -6
    comp.knee.value = 6
    comp.ratio.value = 6
    comp.attack.value = 0.004
    comp.release.value = 0.25

    // Нормализация слушает громкость ДО эквалайзера: иначе подъём баса
    // автоматически компенсировался бы и эквалайзер боролся бы сам с собой.
    // Ветка измерения уходит в нулевой гейн, чтобы граф гарантированно
    // проталкивал через неё сэмплы, но не дублировал звук.
    const normAnalyser = ctx.createAnalyser()
    normAnalyser.fftSize = 2048
    normAnalyser.smoothingTimeConstant = 0.55
    const silent = ctx.createGain()
    silent.gain.value = 0
    master.connect(normAnalyser)
    normAnalyser.connect(silent)
    silent.connect(ctx.destination)

    const eqPreamp = ctx.createGain()
    eqPreamp.gain.value = 1
    master.connect(eqPreamp)
    let tail: AudioNode = eqPreamp
    const eqNodes = EQ_BANDS.map((hz) => {
      const filter = ctx.createBiquadFilter()
      filter.type = 'peaking'
      filter.frequency.value = hz
      filter.Q.value = 1.2
      filter.gain.value = 0
      tail.connect(filter)
      tail = filter
      return filter
    })
    tail.connect(comp)
    comp.connect(ctx.destination)

    this.master = master
    this.normAnalyser = normAnalyser
    this.eqPreamp = eqPreamp
    this.eqNodes = eqNodes
    this.limiter = comp
    this.buf = new Float32Array(normAnalyser.fftSize)
    this.applyEq()
    this.applyRouting()

    for (let i = 0; i < 2; i++) {
      const el = new Audio()
      el.crossOrigin = 'anonymous'
      el.preload = 'auto'
      el.volume = 1

      const src = ctx.createMediaElementSource(el)
      const g = ctx.createGain()
      g.gain.value = i === 0 ? 1 : 0
      src.connect(g)
      g.connect(master)

      el.addEventListener('ended', () => this.onElementEnded(i))
      el.addEventListener('canplay', () => {
        if (i === this.active) this.clearLoadTimer()
      })
      el.addEventListener('error', () => {
        // Ошибка в неактивном слоте — это сломанная предзагрузка. Если
        // оставить loadedId, при переключении движок решит, что трек уже
        // готов, и будет играть мёртвый элемент вместо нового resolve.
        if (i !== this.active) {
          window.undertow.log('preload failed', { id: this.loadedId[i], code: el.error?.code ?? null })
          this.clearSlot(i)
          return
        }
        if (this.retrying) return
        this.clearLoadTimer()
        // Конкретный rr-хост googlevideo может сбросить соединение или
        // отдать мёртвый редирект. Пробуем до трёх свежих URL, прежде чем
        // пропустить трек: разные запросы попадают на разные узлы CDN.
        const track = this.queue[this.index]
        if (track?.provider === 'youtube' && this.activeAttempts < 3) {
          this.activeAttempts += 1
          void this.retryActive(el, track)
          return
        }
        const code = el.error?.code
        window.undertow.log('audio error', { id: track?.id, code, attempts: this.activeAttempts })
        const retry = (): void => {
          this.activeAttempts = 0
          void this.retryActive(el, track)
        }
        this.handlers.onError(
          `Не удалось запустить «${track?.title ?? 'трек'}»${code ? ` (код ${code})` : ''}`,
          retry
        )
        void this.next()
      })

      this.els.push(el)
      this.gains.push(g)
    }

    this.syncLoop()
    return ctx
  }

  /** Громкость 0…1 для «дыхания» подсветки. */
  energy(): number {
    return this.playing ? this.rms : 0
  }

  /* ----------------------------- управление ------------------------------- */

  setOptions(patch: Partial<EngineOptions>): void {
    this.opts = { ...this.opts, ...patch }
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(this.opts.volume * dbToGain(this.normDb), this.ctx.currentTime, 0.05)
    }
    this.applyRouting()
  }

  /**
   * HLS приходит с SoundCloud: Chromium не умеет m3u8 в <audio>, поэтому
   * для таких потоков подключаем hls.js к тому же медиаэлементу.
   */
  private async loadInto(el: HTMLAudioElement, slot: number, stream: ResolvedStream): Promise<void> {
    this.destroyHls(slot)
    const ticket = ++this.hlsTicket[slot]
    if (stream.hls || /\.m3u8(\?|$)/i.test(stream.url)) {
      try {
        // hls.js нужен только SoundCloud: не тянем 600 КБ в первый экран.
        const { default: Hls } = await import('hls.js')
        if (this.destroyed || ticket !== this.hlsTicket[slot]) return
        if (Hls.isSupported()) {
          const hls = new Hls({
            enableWorker: true,
            backBufferLength: 90,
            maxBufferLength: 30
          })
          hls.on(Hls.Events.ERROR, (_event, data) => {
            if (data.fatal) {
              window.undertow.log('hls fatal', { type: data.type, details: data.details })
            }
          })
          this.hls[slot] = hls
          hls.loadSource(stream.url)
          hls.attachMedia(el)
          return
        }
      } catch {
        /* без hls.js остаётся прямой src — для не-HLS это обычный путь */
      }
    }
    el.src = stream.url
    el.load()
  }

  private destroyHls(slot: number): void {
    this.hlsTicket[slot] += 1
    const hls = this.hls[slot]
    if (!hls) return
    this.hls[slot] = null
    try {
      hls.destroy()
    } catch {
      /* уже уничтожен */
    }
  }

  /** Настройки эквалайзера можно менять до создания графа — они применятся при старте. */
  setEq(eq: EqSettings): void {
    this.eq = clampEq(eq)
    this.applyEq()
  }

  /**
   * Если нормализация и эквалайзер выключены, незачем гонять сигнал через
   * измерительную ветку и цепочку фильтров. Оставляем только страховочный
   * лимитер — это заметно дешевле для аудиопотока.
   */
  private applyRouting(): void {
    const ctx = this.ctx
    if (!ctx || !this.master || !this.limiter || !this.eqPreamp || !this.normAnalyser) return
    const processed = this.eqActive || this.opts.normalization
    const mode = processed ? 'processed' : 'direct'
    if (mode === this.routeMode) return
    this.master.disconnect()
    if (mode === 'direct') {
      this.master.connect(this.limiter)
    } else {
      this.master.connect(this.eqPreamp)
      if (this.opts.normalization) this.master.connect(this.normAnalyser)
    }
    this.routeMode = mode
  }

  private applyEq(): void {
    const ctx = this.ctx
    if (!ctx || !this.eqPreamp || !this.limiter) return
    const now = ctx.currentTime
    const on = this.eq.enabled
    const flat = this.eq.gains.every((gain) => gain === 0) && this.eq.preamp === 0
    // Плоский эквалайзер не должен гонять 10 biquad-фильтров в реальном времени.
    const active = on && !flat
    this.eqPreamp.gain.setTargetAtTime(active ? dbToGain(this.eq.preamp) : 1, now, 0.03)
    this.eqNodes.forEach((filter, i) => {
      filter.gain.setTargetAtTime(active ? this.eq.gains[i] ?? 0 : 0, now, 0.03)
    })
    if (active === this.eqActive) return
    this.eqPreamp.disconnect()
    if (active) this.eqPreamp.connect(this.eqNodes[0])
    else this.eqPreamp.connect(this.limiter)
    this.eqActive = active
    this.applyRouting()
  }

  async setQueue(tracks: Track[], startIndex: number): Promise<void> {
    this.ensureGraph()
    await this.ctx?.resume()
    this.switchToken++
    this.switching = false
    // в слотах могли остаться треки прошлой очереди: их нельзя доигрывать
    const ids = new Set(tracks.map((t) => t.id))
    for (let i = 0; i < 2; i++) {
      if (this.loadedId[i] && !ids.has(this.loadedId[i] as string)) this.clearSlot(i)
    }
    this.queue = tracks
    this.index = Math.max(0, Math.min(startIndex, tracks.length - 1))
    this.playing = true
    this.shuffleTail = null
    // если перемешивание включено, новая очередь тоже стартует вперемешку
    if (this.shuffled) {
      this.shuffled = false
      this.setShuffle(true)
    }
    this.emitQueue()
    await this.startActive(true)
  }

  /**
   * Восстановление сохранённой очереди после перезапуска: ставим состав и
   * позицию, но звук не включаем. Поток подгрузится по кнопке play и начнётся
   * с того же места.
   */
  restore(tracks: Track[], index: number, shuffled: boolean): void {
    if (!tracks.length) return
    this.queue = tracks
    this.index = Math.max(0, Math.min(index, tracks.length - 1))
    // порядок уже сохранён таким, каким играл; заново не перемешиваем
    this.shuffled = Boolean(shuffled)
    this.shuffleTail = null
    this.playing = false
    this.stopLoop()
    this.emitQueue()
  }

  /** Полная очистка: останавливаем звук, освобождаем оба слота. */
  clearQueue(): void {
    this.queue = []
    this.index = -1
    this.shuffled = false
    this.shuffleTail = null
    this.playing = false
    this.stopLoop()
    this.repeat = 'off'
    for (let i = 0; i < 2; i++) this.clearSlot(i)
    this.handlers.onTrackChange(null)
    this.emitQueue()
    this.handlers.onRepeat('off')
  }

  async toggle(): Promise<void> {
    // после восстановления очереди граф ещё не создан — play и есть первый запуск
    this.ensureGraph()
    this.retrying = false
    const el = this.els[this.active]
    if (!el.src) {
      // восстановленная очередь ещё не загружена — play и есть первый запуск
      if (!this.queue[this.index]) return
      this.playing = true
      await this.startActive(true)
      return
    }
    if (this.playing) {
      this.playing = false
      el.pause()
      this.emitSnapshot(performance.now(), false)
      this.stopLoop()
    } else {
      this.playing = true
      await this.ctx?.resume()
      // play() резолвится только когда реально пошли данные; на медленном
      // rr-хосте ожидание подвешивало весь переход. Запускаем без await.
      void el.play().catch((e) => {
        if (!playInterrupted(e)) this.handlers.onError(`Не играет: ${(e as Error).message}`)
      })
      const track = this.queue[this.index]
      if (track && el.readyState < 2) this.armLoadTimer(track)
      this.syncLoop()
    }
  }

  /* ------------------------- очередь: чтение/правка ------------------------ */

  getQueue(): Track[] {
    return this.queue
  }

  getIndex(): number {
    return this.index
  }

  isShuffled(): boolean {
    return this.shuffled
  }

  getRepeat(): RepeatMode {
    return this.repeat
  }

  /** off → all → one → off */
  cycleRepeat(): RepeatMode {
    const next: RepeatMode = this.repeat === 'off' ? 'all' : this.repeat === 'all' ? 'one' : 'off'
    this.repeat = next
    this.handlers.onRepeat(next)
    void this.preloadNext()
    return next
  }

  private emitQueue(): void {
    this.handlers.onQueue(this.queue, this.index, this.shuffled)
  }

  /** Переместить трек в очереди (перетаскиванием). */
  moveInQueue(from: number, to: number): void {
    if (from === to) return
    if (from < 0 || from >= this.queue.length) return
    const target = Math.max(0, Math.min(to, this.queue.length - 1))
    const current = this.queue[this.index]
    const [item] = this.queue.splice(from, 1)
    this.queue.splice(target, 0, item)
    // текущий трек остаётся текущим, куда бы его ни перетащили
    this.index = Math.max(0, this.queue.indexOf(current))
    // ручная правка отменяет возможность «вернуть как было» после перемешивания
    this.shuffleTail = null
    this.emitQueue()
  }

  /** Убрать трек из очереди. Если убрали играющий — сразу включаем следующий. */
  removeFromQueue(at: number): void {
    if (at < 0 || at >= this.queue.length) return
    const wasCurrent = at === this.index
    this.queue.splice(at, 1)
    this.shuffleTail = null

    if (!this.queue.length) {
      this.index = -1
      this.playing = false
      this.stopLoop()
      this.switchToken++
      for (let i = 0; i < 2; i++) this.clearSlot(i)
      this.handlers.onTrackChange(null)
      this.emitQueue()
      return
    }

    if (at < this.index) this.index -= 1
    this.emitQueue()
    if (wasCurrent) {
      this.index = Math.min(this.index, this.queue.length - 1)
      void this.hardSwitch(this.index)
    } else {
      this.index = Math.max(0, Math.min(this.index, this.queue.length - 1))
      void this.preloadNext()
    }
  }

  /** Убирает из будущих треков очередь всё, что принадлежит артисту. */
  removeUpcomingByArtist(artist: string): number {
    const key = String(artist ?? '').split(',')[0].trim().toLowerCase()
    if (!key || this.index < 0) return 0
    const tail = this.queue.slice(this.index + 1)
    const filtered = tail.filter(
      (t) => String(t.artists?.[0]?.name ?? t.artist ?? '').split(',')[0].trim().toLowerCase() !== key
    )
    const removed = tail.length - filtered.length
    if (!removed) return 0
    this.queue = [...this.queue.slice(0, this.index + 1), ...filtered]
    this.emitQueue()
    void this.preloadNext()
    return removed
  }

  /** Добавить трек в очередь: сразу после текущего или в конец. */
  addToQueue(track: Track, where: 'next' | 'end' = 'end'): void {
    if (this.queue.some((t) => t.id === track.id)) {
      this.handlers.onError(`«${track.title}» уже в очереди`)
      return
    }
    const at = where === 'next' ? this.index + 1 : this.queue.length
    this.queue.splice(at, 0, track)
    this.shuffleTail = null
    this.emitQueue()
    void this.preloadNext()
  }

  /**
   * Дописать треки в конец (дозаправка радио). Возвращает, сколько добавилось:
   * уже стоящие в очереди треки игнорируются.
   */
  appendQueue(tracks: Track[]): number {
    const have = new Set(this.queue.map((t) => t.id))
    const fresh = tracks.filter((t) => !have.has(t.id) && (have.add(t.id), true))
    if (!fresh.length) return 0
    this.queue.push(...fresh)
    // ручная правка порядка: восстановление перемешанного хвоста больше не актуально
    this.shuffleTail = null
    this.emitQueue()
    void this.preloadNext()
    return fresh.length
  }

  /** Перейти к произвольному месту очереди. */
  async playAt(at: number): Promise<void> {
    if (at < 0 || at >= this.queue.length) return
    if (at === this.index) {
      if (!this.playing) await this.toggle()
      return
    }
    this.playing = true
    await this.hardSwitch(at)
  }

  /**
   * Перемешивание. Перетасовываем только то, что впереди: уже сыгранное
   * и текущий трек остаются на месте. Выключение возвращает исходный порядок.
   */
  setShuffle(on: boolean): void {
    if (on === this.shuffled) return
    if (on) {
      this.shuffleTail = this.queue.slice(this.index + 1)
      const tail = [...this.shuffleTail]
      for (let i = tail.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1))
        ;[tail[i], tail[j]] = [tail[j], tail[i]]
      }
      this.queue = [...this.queue.slice(0, this.index + 1), ...tail]
      this.shuffled = true
    } else {
      if (this.shuffleTail) {
        const head = this.queue.slice(0, this.index + 1)
        const ids = new Set(head.map((t) => t.id))
        const seen = new Set<string>()
        const rest = this.shuffleTail.filter((t) => {
          if (ids.has(t.id) || seen.has(t.id)) return false
          seen.add(t.id)
          return true
        })
        this.queue = [...head, ...rest]
      }
      this.shuffleTail = null
      this.shuffled = false
    }
    this.emitQueue()
    void this.preloadNext()
  }

  async next(): Promise<void> {
    const target = this.nextIndex()
    if (target === null || target === this.index) return
    // Если следующий трек уже прогрет, уходим в него коротким равномощным
    // переходом: ручной «следующий» не должен щёлкать. Если слот пуст или
    // движок уже переключается — обычный быстрый путь.
    const slot = 1 - this.active
    const next = this.queue[target]
    if (
      this.playing &&
      !this.switching &&
      next &&
      this.loadedId[slot] === next.id &&
      !this.els[slot]?.error
    ) {
      await this.beginCrossfade(0.28, 0.28)
      return
    }
    await this.hardSwitch(target)
  }

  async prev(): Promise<void> {
    // как в большинстве плееров: если трек ушёл дальше 3 секунд — начинаем заново
    const el = this.els[this.active]
    if (el.currentTime > 3 || this.index === 0) {
      this.seek(0)
      if (!this.playing) await this.toggle()
      return
    }
    await this.hardSwitch(this.index - 1)
  }

  seek(sec: number): void {
    const el = this.els[this.active]
    if (!el.src) return
    el.currentTime = Math.max(0, sec)
    // после прыжка старый замер громкости неактуален
    this.normDb = 0
    // на паузе цикл уже остановлен — обновляем полосу вручную
    this.emitSnapshot(performance.now(), this.playing)
  }

  /** Перезапускает текущий трек с чистого листа — после смены варианта подмены. */
  async reload(): Promise<void> {
    const track = this.queue[this.index]
    if (!track) return
    const el = this.els[this.active]
    this.switchToken++
    this.switching = false
    this.loadedId[this.active] = null
    this.loadedInfo[this.active] = null
    this.activeAttempts = 0
    this.retrying = false
    const wasPlaying = this.playing
    try {
      // fresh=false: закреплённый вариант не должен переискиваться заново
      const stream = await withTimeout(
        window.undertow.resolve(track.id, false, track),
        35_000,
        'источник не ответил'
      )
      if (this.destroyed) return
      window.undertow.log('retry ok', { id: track.id, mime: stream.mime })
      this.loadInto(el, this.active, stream)
      this.loadedId[this.active] = track.id
      this.loadedInfo[this.active] = stream
      this.armLoadTimer(track)
      this.emitQuality(stream.mime, stream.bitrateKbps)
      this.handlers.onSource(
        stream.source ??
          (stream.fallback || stream.variant
            ? 'youtube'
            : track.provider === 'yandex'
              ? 'yandex'
              : track.provider === 'soundcloud'
                ? 'soundcloud'
                : 'youtube'),
        Boolean(stream.fallback)
      )
      el.currentTime = 0
      this.handlers.onTrackChange(this.displayOf(track))
      this.emitCopy(track)
      this.emitSnapshot(performance.now(), this.playing)
      if (wasPlaying) await el.play().catch(() => undefined)
      void this.preloadNext()
    } catch (e) {
      this.handlers.onError(`Не удалось перезапустить: ${(e as Error).message}`)
    }
  }

  destroy(): void {
    this.destroyed = true
    this.clearLoadTimer()
    this.stopLoop()
    document.removeEventListener('visibilitychange', this.onVisibility)
    for (let i = 0; i < this.els.length; i++) this.destroyHls(i)
    for (const el of this.els) {
      el.pause()
      el.removeAttribute('src')
      el.load()
    }
    void this.ctx?.close()
    this.ctx = null
  }

  /* ------------------------------ треки ----------------------------------- */

  private async startActive(autoplay: boolean): Promise<void> {
    const track = this.queue[this.index]
    if (!track) {
      this.playing = false
      this.handlers.onTrackChange(null)
      return
    }
    // Предзагрузка могла умереть, пока слот был неактивен: считаем его
    // пустым до того, как решить, нужен ли новый resolve.
    const activeEl = this.els[this.active]
    if (
      activeEl &&
      this.loadedId[this.active] === track.id &&
      (activeEl.error || activeEl.networkState === HTMLMediaElement.NETWORK_NO_SOURCE)
    ) {
      window.undertow.log('stale preload, reload', { id: track.id })
      this.clearSlot(this.active)
    }
    this.ensureGraph()
    const el = this.els[this.active]
    const ctx = this.ctx!

    this.gains[this.active].gain.cancelScheduledValues(ctx.currentTime)
    this.gains[this.active].gain.setValueAtTime(1, ctx.currentTime)
    this.gains[1 - this.active].gain.cancelScheduledValues(ctx.currentTime)
    this.gains[1 - this.active].gain.setValueAtTime(0, ctx.currentTime)

    if (this.loadedId[this.active] !== track.id) {
      // Пока новый URL резолвится (в подмене это до ~3.5 с), в слоте ещё лежит
      // предыдущий трек — иначе он продолжает звучать, а панель уже показывает
      // следующий. Молчание лучше рассинхрона.
      this.clearSlot(this.active)
      try {
        const stream = await withTimeout(
          window.undertow.resolve(track.id, false, track),
          35_000,
          'источник не ответил'
        )
        if (this.destroyed) return
        // пока резолвили, трек могли переключить ещё раз
        if (this.queue[this.index]?.id !== track.id) return
        this.loadInto(el, this.active, stream)
        this.loadedId[this.active] = track.id
        this.loadedInfo[this.active] = stream
      } catch (e) {
        this.handlers.onError(`Не удалось получить звук: ${(e as Error).message}`)
        this.playing = false
        this.stopLoop()
        return
      }
    }

    el.currentTime = 0
    this.normDb = 0
    this.activeAttempts = 0
    this.armLoadTimer(track)
    this.handlers.onTrackChange(this.displayOf(track))

    // подпись качества и сообщение о подмене берём из того, что уже загружено в слот:
    // трек мог быть прогрет заранее (preloadNext), тогда resolve выше не выполнялся
    const info = this.loadedInfo[this.active]
    if (info) {
      this.emitQuality(info.mime, info.bitrateKbps)
      this.handlers.onSource(
        info.source ??
          (info.fallback || info.variant
            ? 'youtube'
            : track.provider === 'yandex'
              ? 'yandex'
              : track.provider === 'soundcloud'
                ? 'soundcloud'
                : 'youtube'),
        Boolean(info.fallback)
      )
      this.emitCopy(track)
    } else {
      this.handlers.onSource(
        track.provider === 'yandex' ? 'yandex' : track.provider === 'soundcloud' ? 'soundcloud' : 'youtube',
        false
      )
    }

    if (autoplay) {
      await this.ctx?.resume()
      void el.play().catch((e) => {
        if (!playInterrupted(e)) this.handlers.onError(`Не играет: ${(e as Error).message}`)
      })
    }

    void this.preloadNext()
    void this.prewarmAhead()
    this.emitSnapshot(performance.now(), this.playing)
    this.syncLoop()
  }

  private nextIndex(): number | null {
    if (!this.queue.length) return null
    if (this.index + 1 < this.queue.length) return this.index + 1
    return this.repeat === 'all' ? 0 : null
  }

  /** Повтор одного трека: тот же слот, с начала, без пересоздания потока. */
  private clearLoadTimer(): void {
    if (this.loadTimer) {
      clearTimeout(this.loadTimer)
      this.loadTimer = null
    }
  }

  private armLoadTimer(track: Track): void {
    this.clearLoadTimer()
    const id = track.id
    this.loadTimer = setTimeout(() => {
      this.loadTimer = null
      if (this.destroyed || this.queue[this.index]?.id !== id || !this.playing || this.retrying) return
      const el = this.els[this.active]
      if (el.readyState >= 2) return
      if (this.activeAttempts < 3) {
        this.activeAttempts += 1
        void this.retryActive(el, track)
      } else {
        window.undertow.log('load timeout, skip', { id, attempts: this.activeAttempts })
        this.handlers.onError(`«${track.title}» не загрузился, пропускаю`, () => {
          this.activeAttempts = 0
          void this.retryActive(el, track)
        })
        void this.next()
      }
    }, 8_000)
  }

  /**
   * Перезапрос потока после ошибки элемента. Свежий resolve нужен потому,
   * что googlevideo-URL живёт ограниченное время, а редирект может увести
   * на конкретный rr-хост, который сейчас недоступен.
   */
  private async retryActive(el: HTMLAudioElement, track: Track): Promise<void> {
    window.undertow.log('retry start', track.id)
    this.retrying = true
    this.clearLoadTimer()
    // Ошибка может случиться в середине/конце трека. Запоминаем позицию до
    // сброса src, иначе retry всегда начинал бы с 0:00.
    const resumeAt = Number.isFinite(el.currentTime) && el.currentTime > 1 ? el.currentTime : 0
    try {
      const stream = await withTimeout(
        window.undertow.resolve(track.id, true, track),
        35_000,
        'источник не ответил'
      )
      if (this.destroyed || this.queue[this.index]?.id !== track.id) return
      window.undertow.log('retry ok', { id: track.id, mime: stream.mime })
      this.loadInto(el, this.active, stream)
      this.loadedId[this.active] = track.id
      this.loadedInfo[this.active] = stream
      this.emitQuality(stream.mime, stream.bitrateKbps)
      this.emitCopy(track)

      let seekDone: Promise<void> = Promise.resolve()
      if (resumeAt > 1) {
        let resolveSeek: (() => void) | null = null
        seekDone = new Promise<void>((r) => {
          resolveSeek = r
        })
        const seek = (): void => {
          if (this.destroyed || this.queue[this.index]?.id !== track.id) return
          try {
            const end = Number.isFinite(el.duration) && el.duration > 0 ? el.duration - 0.5 : resumeAt
            el.currentTime = Math.max(0, Math.min(resumeAt, end))
            window.undertow.log('retry resume', { id: track.id, at: Math.round(el.currentTime) })
          } catch {
            /* метаданные ещё не готовы — сработает canplay */
          }
          resolveSeek?.()
        }
        if (el.readyState >= 1) seek()
        else {
          el.addEventListener('loadedmetadata', seek, { once: true })
          el.addEventListener('canplay', seek, { once: true })
        }
      }

      await this.ctx?.resume()
      // Даём новому src подняться и перескочить на прежнюю позицию, затем
      // запускаем. Если метаданные не пришли за 1,2 с — не блокируем playback.
      if (resumeAt > 1) {
        await Promise.race([seekDone, new Promise((r) => setTimeout(r, 1200))])
      }
      void el.play().catch((e) => {
        if (!playInterrupted(e)) this.handlers.onError(`Не играет: ${(e as Error).message}`)
      })
      // даём элементу проглотить события от старого src, прежде чем снова
      // слушать ошибки — иначе один сбой съедает все три попытки
      await new Promise((r) => setTimeout(r, 500))
      if (this.destroyed || this.queue[this.index]?.id !== track.id) return
      this.retrying = false
      this.armLoadTimer(track)
      this.syncLoop()
    } catch (e) {
      this.retrying = false
      window.undertow.log('retry FAIL', { id: track.id, err: (e as Error).message })
      this.handlers.onError(`«${track.title}»: ${(e as Error).message}`, () => {
        this.activeAttempts = 0
        void this.retryActive(el, track)
      })
      void this.next()
    }
  }

  private restartCurrent(): void {
    const el = this.els[this.active]
    if (!el.src) return
    this.switchToken++
    this.switching = false
    this.playing = true
    this.normDb = 0
    el.currentTime = 0
    void this.ctx?.resume()
    void el.play().catch((e) => {
      if (!playInterrupted(e)) this.handlers.onError(`Не играет: ${(e as Error).message}`)
    })
    void this.preloadNext()
    this.syncLoop()
  }

  /**
   * Готовит ссылки на 2–3 трека вперёд. Сам следующий трек уже загружен в
   * аудио-слот, а здесь параллельно прогреваются URL для дальнейших стыков:
   * к моменту перехода resolve отдаёт готовый поток без сетевой паузы.
   */
  private async prewarmAhead(): Promise<void> {
    const token = this.preloadToken
    const targets = [2, 3]
      .map((step) => this.queue[this.index + step])
      .filter((t): t is Track => Boolean(t) && !this.destroyed && token === this.preloadToken)
    await Promise.all(
      targets.map((target) =>
        window.undertow.prewarm(target).catch(() => undefined)
      )
    )
  }

  private async preloadNext(): Promise<void> {
    const target = this.nextIndex()
    if (target === null || target === this.index) return
    const next = this.queue[target]
    if (!next) return
    const token = ++this.preloadToken
    const slot = 1 - this.active
    const el = this.els[slot]
    if (this.loadedId[slot] === next.id) return
    try {
      const stream = await window.undertow.resolve(next.id, false, next)
      if (this.destroyed || token !== this.preloadToken) return
      if (this.loadedId[slot] === next.id) return
      this.loadInto(el, slot, stream)
      this.loadedId[slot] = next.id
      this.loadedInfo[slot] = stream
    } catch {
      // не критично: если прогрев не удался, resolve повторится при переключении
    }
  }

  /**
   * Сообщает, какая именно копия играет. Основной заголовок в плеере остаётся
   * названием трека из очереди: сердечко лайка относится к записи в библиотеке,
   * и если бы заголовок подменялся на название копии, выглядело бы так, будто
   * лайк горит у трека, которого в библиотеке нет.
   */
  private emitCopy(track: Track): void {
    const info = this.loadedInfo[this.active]
    // вариант выбран вручную: он и есть главный трек, оригинал уходит подпись
    if (info?.variant) {
      this.handlers.onCopy(`оригинал: ${track.title} — ${track.artist}`, 'variant', false, info.fallbackMatched?.title ?? null)
      return
    }
    if (info?.fallbackMatched) {
      this.handlers.onCopy(
        `копия: ${info.fallbackMatched.title}`,
        'fallback',
        Boolean(info.fallbackApprox),
        info.fallbackMatched.title
      )
      return
    }
    this.handlers.onCopy(null, 'fallback', false, null)
  }

  /**
   * Трек, с которым работает интерфейс. Для выбранного вручную варианта это
   * отдельная запись `yt:<videoId>`: его можно лайкнуть, и сердечко будет
   * относиться именно к копии, а не к оригиналу из Яндекса.
   */
  private displayOf(track: Track): Track {
    const info = this.loadedInfo[this.active]
    if (!info?.variant || !info.variantVideoId) return track
    return {
      ...track,
      id: `yt:${info.variantVideoId}`,
      provider: 'youtube',
      title: info.fallbackMatched?.title ?? track.title
    }
  }

  /** Трек из очереди на текущей позиции — без подмены на вариант. */
  queueTrack(): Track | null {
    return this.queue[this.index] ?? null
  }

  /** Полностью освобождает слот: тишина, никакого старого src. */
  private clearSlot(i: number): void {
    const el = this.els[i]
    if (!el) return
    el.pause()
    this.destroyHls(i)
    el.removeAttribute('src')
    el.load()
    this.loadedId[i] = null
    this.loadedInfo[i] = null
  }

  private emitQuality(mime: string, bitrateKbps?: number): void {
    const codec = mime.includes('webm')
      ? 'OPUS'
      : mime.includes('mpegurl') || mime.includes('mp4')
        ? 'AAC'
        : mime.includes('flac')
          ? 'FLAC'
          : 'MP3'
    // источник рядом отдельным значком YM/YT — дублировать его в чипе незачем
    const label = bitrateKbps ? `${codec} ${bitrateKbps}` : codec
    if (label !== this.lastQuality) {
      this.lastQuality = label
      this.handlers.onQuality(label)
    }
  }

  /* --------------------------- переключения -------------------------------- */

  /** Ручное переключение: короткое затухание, без ожидания конца трека. */
  private async hardSwitch(targetIndex: number): Promise<void> {
    if (targetIndex < 0 || targetIndex >= this.queue.length) return
    // отложенное переключение предыдущего трека больше не должно срабатывать
    this.switchToken++
    this.switching = true
    const ctx = this.ctx
    const old = this.active
    if (ctx) this.gains[old].gain.setTargetAtTime(0, ctx.currentTime, 0.01)
    const oldEl = this.els[old]
    setTimeout(() => {
      if (!this.destroyed) oldEl.pause()
    }, 80)

    this.active = 1 - old
    this.index = targetIndex
    this.switching = false
    // ручной переход меняет текущую позицию — панель очереди должна это видеть
    this.emitQueue()
    await this.startActive(this.playing)
  }

  /** Стык без паузы: следующий трек уже прогружен, стартуем его заранее. */
  private async gaplessSwitch(): Promise<void> {
    if (this.switching) return
    this.switching = true
    const token = ++this.switchToken
    const ctx = this.ctx!
    const other = 1 - this.active
    const el = this.els[other]

    // В соседнем слоте может лежать устаревший трек (или ничего): проверяем,
    // что это ровно следующий по очереди, иначе играл бы предыдущий.
    const target = this.nextIndex()
    if (target === null || target === this.index) {
      this.switching = false
      return
    }
    if (!el.src || el.error || this.loadedId[other] !== this.queue[target]?.id) {
      this.switching = false
      await this.hardSwitch(target)
      return
    }

    try {
      await el.play()
    } catch {
      this.switching = false
      await this.hardSwitch(target)
      return
    }

    const now = ctx.currentTime
    this.gains[other].gain.cancelScheduledValues(now)
    this.gains[other].gain.setValueAtTime(this.gains[other].gain.value, now)
    this.gains[other].gain.linearRampToValueAtTime(1, now + 0.02)
    this.gains[this.active].gain.cancelScheduledValues(now)
    this.gains[this.active].gain.setValueAtTime(this.gains[this.active].gain.value, now)
    this.gains[this.active].gain.linearRampToValueAtTime(0, now + 0.02)

    this.commitSwitch(120, token, target)
  }

  /** Кроссфейд по равномощной кривой. */
  private async beginCrossfade(remain: number, seconds: number): Promise<void> {
    if (this.switching) return
    this.switching = true
    const token = ++this.switchToken
    const ctx = this.ctx!
    const other = 1 - this.active
    const el = this.els[other]

    const target = this.nextIndex()
    if (target === null || target === this.index) {
      this.switching = false
      return
    }
    if (!el.src || el.error || this.loadedId[other] !== this.queue[target]?.id) {
      this.switching = false
      await this.hardSwitch(target)
      return
    }
    try {
      await el.play()
    } catch {
      this.switching = false
      await this.hardSwitch(target)
      return
    }

    const dur = Math.max(0.25, Math.min(seconds, remain))
    const steps = 48
    const curveOut = new Float32Array(steps)
    const curveIn = new Float32Array(steps)
    for (let i = 0; i < steps; i++) {
      const x = i / (steps - 1)
      curveOut[i] = Math.cos((x * Math.PI) / 2)
      curveIn[i] = Math.sin((x * Math.PI) / 2)
    }

    const now = ctx.currentTime
    this.gains[this.active].gain.cancelScheduledValues(now)
    this.gains[this.active].gain.setValueAtTime(1, now)
    this.gains[this.active].gain.setValueCurveAtTime(curveOut, now, dur)

    this.gains[other].gain.cancelScheduledValues(now)
    this.gains[other].gain.setValueAtTime(0, now)
    this.gains[other].gain.setValueCurveAtTime(curveIn, now, dur)

    this.commitSwitch(dur * 1000 + 40, token, target)
  }

  private commitSwitch(delayMs: number, token: number, target: number): void {
    const expected = this.queue[target]?.id ?? null
    setTimeout(() => {
      if (this.destroyed) return
      // пока шёл таймер, пользователь мог переключить трек вручную
      if (token !== this.switchToken) return
      if ((this.queue[target]?.id ?? null) !== expected) return
      const old = this.active
      this.active = 1 - old
      this.index = target
      this.switching = false
      const ctx = this.ctx
      if (ctx) {
        this.gains[this.active].gain.cancelScheduledValues(ctx.currentTime)
        this.gains[this.active].gain.setValueAtTime(1, ctx.currentTime)
        this.gains[old].gain.cancelScheduledValues(ctx.currentTime)
        this.gains[old].gain.setValueAtTime(0, ctx.currentTime)
      }
      const shown = this.queue[this.index]
      this.handlers.onTrackChange(shown ? this.displayOf(shown) : null)
      if (shown) this.emitCopy(shown)
      this.emitQueue()
      void this.preloadNext()
      if (this.nextIndex() === null) {
        // следующий слот больше не нужен — освобождаем
        this.loadedId[old] = null
        this.loadedInfo[old] = null
      }
    }, delayMs)
  }

  private onElementEnded(i: number): void {
    if (i !== this.active) return
    if (this.switching) return
    if (this.repeat === 'one' || (this.repeat === 'all' && this.queue.length === 1)) {
      this.restartCurrent()
      return
    }
    if (this.nextIndex() !== null) {
      void this.gaplessSwitch()
    } else {
      this.playing = false
      this.emitSnapshot(performance.now(), false)
      this.stopLoop()
    }
  }

  /* ------------------------------ цикл ------------------------------------ */

  private loop(): void {
    this.raf = 0
    this.timer = null
    if (this.destroyed) return
    const el = this.els[this.active]
    if (!el) {
      this.syncLoop()
      return
    }

    const now = performance.now()
    // RMS читаем не чаще ~11 раз в секунду: на слух нормализация всё равно
    // сглажена, а 60 замеров по 2048 сэмплов каждый кадр — лишняя нагрузка.
    if (el.src && this.playing && now - this.lastNormalize >= 150) {
      this.lastNormalize = now
      this.applyNormalization()
    }

    const duration = Number.isFinite(el.duration) ? el.duration : (this.queue[this.index]?.durationSec ?? 0)
    const remain = duration - el.currentTime

    const upcoming = this.nextIndex()
    if (
      !this.switching &&
      this.repeat !== 'one' &&
      upcoming !== null &&
      upcoming !== this.index &&
      el.src &&
      this.playing
    ) {
      const xf = this.opts.crossfadeSec
      if (xf > 0) {
        if (remain > 0 && remain <= xf) void this.beginCrossfade(remain, xf)
      } else if (remain > 0 && remain <= 0.16) {
        void this.gaplessSwitch()
      }
    }

    // в фоне интерфейс не виден, поэтому незачем будить React 10 раз в секунду
    if (now - this.lastEmit > (document.hidden ? 800 : 100)) this.emitSnapshot(now)
    if (this.playing) this.scheduleNext()
  }

  private emitSnapshot(now = performance.now(), playing = this.playing): void {
    this.lastEmit = now
    const el = this.els[this.active]
    if (!el) return
    const duration = Number.isFinite(el.duration) ? el.duration : (this.queue[this.index]?.durationSec ?? 0)
    const time = el.src ? el.currentTime || 0 : 0
    this.handlers.onSnapshot({
      playing,
      time,
      duration,
      rms: playing ? this.rms : 0,
      gainDb: this.normDb,
      trackId: this.queue[this.index]?.id ?? null
    })
  }

  private scheduleNext(): void {
    if (this.destroyed || !this.playing || this.raf || this.timer) return
    // Обычный трек не требует 60 кадров в секунду: прогресс и нормализация
    // обновляются 10 раз в секунду. rAF включаем только у стыка/кроссфейда,
    // где важна точность до кадра.
    if (this.needsFastLoop()) this.raf = requestAnimationFrame(this.loop)
    else this.timer = setTimeout(this.loop, document.hidden ? 120 : 100)
  }

  private needsFastLoop(): boolean {
    const el = this.els[this.active]
    if (!el || !el.src) return false
    if (this.switching) return true
    const duration = Number.isFinite(el.duration) ? el.duration : (this.queue[this.index]?.durationSec ?? 0)
    if (!(duration > 0)) return false
    const remain = duration - el.currentTime
    if (remain <= 2) return true
    return this.opts.crossfadeSec > 0 && remain <= this.opts.crossfadeSec + 0.5
  }

  private syncLoop(): void {
    if (this.destroyed || !this.playing) {
      this.stopLoop()
      return
    }
    this.scheduleNext()
  }

  private stopLoop(): void {
    if (this.raf) {
      cancelAnimationFrame(this.raf)
      this.raf = 0
    }
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
  }

  private onVisibility(): void {
    if (this.destroyed) return
    this.stopLoop()
    if (!this.playing) return
    if (!document.hidden) this.emitSnapshot()
    this.scheduleNext()
  }

  /**
   * Нормализация: целимся в средний RMS -18 dBFS.
   * Тишину не трогаем (иначе поднимем шум между треками), реакция медленная,
   * чтобы не было «дыхания» громкости.
   */
  private applyNormalization(): void {
    const analyser = this.normAnalyser
    const ctx = this.ctx
    const master = this.master
    if (!analyser || !ctx || !master) return

    analyser.getFloatTimeDomainData(this.buf as Float32Array<ArrayBuffer>)
    let sum = 0
    for (let i = 0; i < this.buf.length; i++) sum += this.buf[i] * this.buf[i]
    const rms = Math.sqrt(sum / this.buf.length)
    this.rms = Math.min(1, rms * 3)

    if (!this.opts.normalization) {
      this.normDb = 0
      master.gain.setTargetAtTime(this.opts.volume, ctx.currentTime, 0.05)
      return
    }

    const db = gainToDb(rms)
    if (db > -45 && rms > 0) {
      const desired = Math.max(-MAX_BOOST_DB, Math.min(MAX_BOOST_DB, TARGET_RMS_DB - db))
      this.normDb += (desired - this.normDb) * 0.06
    }
    master.gain.setTargetAtTime(this.opts.volume * dbToGain(this.normDb), ctx.currentTime, 0.2)
  }
}
