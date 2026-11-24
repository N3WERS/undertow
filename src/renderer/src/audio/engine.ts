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
  onError(message: string): void
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
  onSource(source: 'yandex' | 'youtube' | null, fallback: boolean): void
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

export class AudioEngine {
  private ctx: AudioContext | null = null
  private els: HTMLAudioElement[] = []
  private gains: GainNode[] = []
  private master: GainNode | null = null
  private analyser: AnalyserNode | null = null
  private buf: Float32Array = new Float32Array(2048)
  private freqBuf: Uint8Array = new Uint8Array(1024)
  private level = 0

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
  private preloadToken = 0
  /** хвост очереди в исходном порядке — чтобы выключить перемешивание */
  private shuffleTail: Track[] | null = null
  /** позиция, с которой нужно начать после восстановления очереди */
  private shuffled = false

  private opts: EngineOptions = { crossfadeSec: 0, normalization: true, volume: 0.85 }
  private normDb = 0
  private rms = 0
  private raf = 0
  private lastEmit = 0
  private lastQuality: string | null = null

  constructor(private handlers: EngineHandlers) {
    this.loop = this.loop.bind(this)
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

    const analyser = ctx.createAnalyser()
    analyser.fftSize = 2048
    analyser.smoothingTimeConstant = 0.55

    master.connect(comp)
    comp.connect(analyser)
    analyser.connect(ctx.destination)

    this.master = master
    this.analyser = analyser
    this.buf = new Float32Array(analyser.fftSize)

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
      el.addEventListener('error', () => {
        if (i !== this.active) return
        const code = el.error?.code
        this.handlers.onError(`Поток оборвался${code ? ` (код ${code})` : ''}`)
        void this.next()
      })

      this.els.push(el)
      this.gains.push(g)
    }

    this.raf = requestAnimationFrame(this.loop)
    return ctx
  }

  /**
   * Спектр для визуализации: `bins` значений 0…255 от низа к верху.
   * Рендерер рисует из него волну вокруг орбиты «Течения».
   */
  spectrum(bins = 64): Uint8Array | null {
    const analyser = this.analyser
    if (!analyser || !this.ctx) return null
    analyser.getByteFrequencyData(this.freqBuf as Uint8Array<ArrayBuffer>)
    if (bins >= this.freqBuf.length) return this.freqBuf
    const out = new Uint8Array(bins)
    // логарифмическая выборка: низы не должны занимать весь круг
    for (let i = 0; i < bins; i++) {
      const from = Math.floor(Math.pow(i / bins, 1.9) * (this.freqBuf.length - 1))
      const to = Math.max(from + 1, Math.floor(Math.pow((i + 1) / bins, 1.9) * (this.freqBuf.length - 1)))
      let peak = 0
      for (let j = from; j < to; j++) peak = Math.max(peak, this.freqBuf[j])
      out[i] = peak
    }
    return out
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
    this.emitQueue()
  }

  /** Полная очистка: останавливаем звук, освобождаем оба слота. */
  clearQueue(): void {
    this.queue = []
    this.index = -1
    this.shuffled = false
    this.shuffleTail = null
    this.playing = false
    for (let i = 0; i < 2; i++) this.clearSlot(i)
    this.handlers.onTrackChange(null)
    this.emitQueue()
  }

  async toggle(): Promise<void> {
    // после восстановления очереди граф ещё не создан — play и есть первый запуск
    this.ensureGraph()
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
    } else {
      this.playing = true
      await this.ctx?.resume()
      try {
        await el.play()
      } catch (e) {
        this.handlers.onError(`Не играет: ${(e as Error).message}`)
      }
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
    if (this.index + 1 >= this.queue.length) return
    await this.hardSwitch(this.index + 1)
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
    const wasPlaying = this.playing
    try {
      // fresh=false: закреплённый вариант не должен переискиваться заново
      const stream = await window.undertow.resolve(track.id, false, track)
      if (this.destroyed) return
      el.src = stream.url
      el.load()
      this.loadedId[this.active] = track.id
      this.loadedInfo[this.active] = stream
      this.emitQuality(stream.mime, stream.bitrateKbps)
      this.handlers.onSource(
        stream.source ??
          (stream.fallback || stream.variant
            ? 'youtube'
            : track.provider === 'yandex'
              ? 'yandex'
              : 'youtube'),
        Boolean(stream.fallback)
      )
      el.currentTime = 0
      this.handlers.onTrackChange(this.displayOf(track))
      this.emitCopy(track)
      if (wasPlaying) await el.play().catch(() => undefined)
      void this.preloadNext()
    } catch (e) {
      this.handlers.onError(`Не удалось перезапустить: ${(e as Error).message}`)
    }
  }

  destroy(): void {
    this.destroyed = true
    cancelAnimationFrame(this.raf)
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
        const stream = await window.undertow.resolve(track.id, false, track)
        if (this.destroyed) return
        // пока резолвили, трек могли переключить ещё раз
        if (this.queue[this.index]?.id !== track.id) return
        el.src = stream.url
        el.load()
        this.loadedId[this.active] = track.id
        this.loadedInfo[this.active] = stream
      } catch (e) {
        this.handlers.onError(`Не удалось получить звук: ${(e as Error).message}`)
        this.playing = false
        return
      }
    }

    el.currentTime = 0
    this.normDb = 0
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
              : 'youtube'),
        Boolean(info.fallback)
      )
      this.emitCopy(track)
    } else {
      this.handlers.onSource(track.provider === 'yandex' ? 'yandex' : 'youtube', false)
    }

    if (autoplay) {
      try {
        await this.ctx?.resume()
        await el.play()
      } catch (e) {
        this.handlers.onError(`Не играет: ${(e as Error).message}`)
      }
    }

    void this.preloadNext()
  }

  private async preloadNext(): Promise<void> {
    const next = this.queue[this.index + 1]
    if (!next) return
    const token = ++this.preloadToken
    const slot = 1 - this.active
    const el = this.els[slot]
    if (this.loadedId[slot] === next.id) return
    try {
      const stream = await window.undertow.resolve(next.id, false, next)
      if (this.destroyed || token !== this.preloadToken) return
      if (this.loadedId[slot] === next.id) return
      el.src = stream.url
      el.load()
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
    el.removeAttribute('src')
    el.load()
    this.loadedId[i] = null
    this.loadedInfo[i] = null
  }

  private emitQuality(mime: string, bitrateKbps?: number): void {
    const codec = mime.includes('webm') ? 'OPUS' : mime.includes('mp4') ? 'AAC' : mime.includes('flac') ? 'FLAC' : 'MP3'
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
    if (!el.src || this.loadedId[other] !== this.queue[this.index + 1]?.id) {
      this.switching = false
      await this.hardSwitch(this.index + 1)
      return
    }

    try {
      await el.play()
    } catch {
      this.switching = false
      await this.hardSwitch(this.index + 1)
      return
    }

    const now = ctx.currentTime
    this.gains[other].gain.cancelScheduledValues(now)
    this.gains[other].gain.setValueAtTime(this.gains[other].gain.value, now)
    this.gains[other].gain.linearRampToValueAtTime(1, now + 0.02)
    this.gains[this.active].gain.cancelScheduledValues(now)
    this.gains[this.active].gain.setValueAtTime(this.gains[this.active].gain.value, now)
    this.gains[this.active].gain.linearRampToValueAtTime(0, now + 0.02)

    this.commitSwitch(120, token)
  }

  /** Кроссфейд по равномощной кривой. */
  private async beginCrossfade(remain: number, seconds: number): Promise<void> {
    if (this.switching) return
    this.switching = true
    const token = ++this.switchToken
    const ctx = this.ctx!
    const other = 1 - this.active
    const el = this.els[other]

    if (!el.src || this.loadedId[other] !== this.queue[this.index + 1]?.id) {
      this.switching = false
      await this.hardSwitch(this.index + 1)
      return
    }
    try {
      await el.play()
    } catch {
      this.switching = false
      await this.hardSwitch(this.index + 1)
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

    this.commitSwitch(dur * 1000 + 40, token)
  }

  private commitSwitch(delayMs: number, token: number): void {
    const expected = this.queue[this.index + 1]?.id ?? null
    setTimeout(() => {
      if (this.destroyed) return
      // пока шёл таймер, пользователь мог переключить трек вручную
      if (token !== this.switchToken) return
      if ((this.queue[this.index + 1]?.id ?? null) !== expected) return
      const old = this.active
      this.active = 1 - old
      this.index += 1
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
      if (!this.queue[this.index + 1]) {
        // следующий слот больше не нужен — освобождаем
        this.loadedId[old] = null
        this.loadedInfo[old] = null
      }
    }, delayMs)
  }

  private onElementEnded(i: number): void {
    if (i !== this.active) return
    if (this.switching) return
    if (this.index + 1 < this.queue.length) {
      void this.gaplessSwitch()
    } else {
      this.playing = false
      this.handlers.onSnapshot({
        playing: false,
        time: this.els[this.active].duration || 0,
        duration: this.els[this.active].duration || 0,
        rms: 0,
        gainDb: 0,
        trackId: this.queue[this.index]?.id ?? null
      })
    }
  }

  /* ------------------------------ цикл ------------------------------------ */

  private loop(): void {
    if (this.destroyed) return
    this.raf = requestAnimationFrame(this.loop)
    const el = this.els[this.active]
    if (!el) return

    if (el.src && this.playing) this.applyNormalization()

    const duration = Number.isFinite(el.duration) ? el.duration : (this.queue[this.index]?.durationSec ?? 0)
    const time = el.src ? el.currentTime || 0 : 0
    const remain = duration - el.currentTime

    if (!this.switching && this.queue[this.index + 1] && el.src && this.playing) {
      const xf = this.opts.crossfadeSec
      if (xf > 0) {
        if (remain > 0 && remain <= xf) void this.beginCrossfade(remain, xf)
      } else if (remain > 0 && remain <= 0.16) {
        void this.gaplessSwitch()
      }
    }

    const now = performance.now()
    if (now - this.lastEmit > 100) {
      this.lastEmit = now
      this.handlers.onSnapshot({
        playing: this.playing,
        time,
        duration,
        rms: this.rms,
        gainDb: this.normDb,
        trackId: this.queue[this.index]?.id ?? null
      })
    }
  }

  /**
   * Нормализация: целимся в средний RMS -18 dBFS.
   * Тишину не трогаем (иначе поднимем шум между треками), реакция медленная,
   * чтобы не было «дыхания» громкости.
   */
  private applyNormalization(): void {
    const analyser = this.analyser
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
