import { useEffect, useRef, useState } from 'react'
import type { DpiStatus, ProviderState, UpdateState } from '../types'
import { APP_AUTHOR, APP_VERSION } from '../version'

interface Props {
  state: ProviderState | null
  onState: (s: ProviderState) => void
  onToast: (text: string, kind?: 'info' | 'error') => void
  crossfade: number
  onCrossfade: (v: number) => void
  normalize: boolean
  onNormalize: (v: boolean) => void
  dpi: DpiStatus | null
  onDpi: (s: DpiStatus) => void
  focus?: 'dpi' | null
  onFocusDone?: () => void
}

export default function Settings({
  state,
  onState,
  onToast,
  crossfade,
  onCrossfade,
  normalize,
  onNormalize,
  dpi,
  onDpi,
  focus,
  onFocusDone
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const dpiRef = useRef<HTMLElement>(null)
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState<'save' | 'clear' | 'refresh' | null>(null)
  const [dpiBusy, setDpiBusy] = useState(false)
  const [update, setUpdate] = useState<UpdateState | null>(null)
  const [updateBusy, setUpdateBusy] = useState(false)
  const yn = state?.yandex

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

  // плашка UndertowDPI в заголовке ведёт не просто в настройки, а прямо к блоку
  useEffect(() => {
    if (focus !== 'dpi') return
    const scroller = scrollRef.current
    const target = dpiRef.current
    if (!scroller || !target) return
    const top =
      scroller.scrollTop + target.getBoundingClientRect().top - scroller.getBoundingClientRect().top - 12
    scroller.scrollTo({ top, behavior: 'smooth' })
    onFocusDone?.()
  }, [focus])

  const refreshDpi = async () => {
    try {
      onDpi(await window.undertow.dpiStatus())
    } catch (e) {
      onToast(e instanceof Error ? e.message : String(e), 'error')
    }
  }

  const toggleDpi = async (next: boolean) => {
    setDpiBusy(true)
    try {
      onDpi(await window.undertow.dpiSet(next))
      localStorage.setItem('undertow.dpi', next ? 'on' : 'off')
      onToast(
        next
          ? 'Обход DPI включён — YouTube должен открываться заметно быстрее'
          : 'Обход DPI выключен'
      )
    } catch (e) {
      onToast(e instanceof Error ? e.message : String(e), 'error')
      await refreshDpi()
    } finally {
      setDpiBusy(false)
    }
  }

  const run = async (kind: 'save' | 'clear' | 'refresh') => {
    setBusy(kind)
    try {
      if (kind === 'save') {
        const next = await window.undertow.setYandexToken(token)
        onState(next)
        setToken('')
        onToast(
          next.yandex.hasPlus
            ? `Яндекс подключён как основной провайдер${next.yandex.login ? ` · ${next.yandex.login}` : ''}`
            : 'Токен принят, но Плюс не активен — Яндекс отключён, играем через YouTube',
          next.yandex.hasPlus ? 'info' : 'error'
        )
      } else if (kind === 'clear') {
        const next = await window.undertow.clearYandexToken()
        onState(next)
        onToast('Токен удалён — работаем только через YouTube')
      } else {
        const next = await window.undertow.refreshYandex()
        onState(next)
        onToast(next.yandex.active ? 'Плюс активен — Яндекс основной' : 'Плюс не активен — только YouTube')
      }
    } catch (e) {
      onToast(e instanceof Error ? e.message : String(e), 'error')
    } finally {
      setBusy(null)
    }
  }

  const dpiLabel =
    dpi?.state === 'on'
      ? 'включён'
      : dpi?.state === 'starting'
        ? 'запускаю'
        : dpi?.state === 'stopping'
          ? 'останавливаю'
          : dpi?.state === 'error'
            ? 'ошибка'
            : dpi?.state === 'unavailable'
              ? 'недоступен'
              : dpi
                ? 'выключен'
                : 'проверяю'
  const dpiCanToggle = Boolean(dpi?.supported) && Boolean(dpi?.available || dpi?.running) && !dpiBusy

  return (
    <div className="scroll" ref={scrollRef}>
      <div className="page-head">
        <div>
          <h1>Настройки</h1>
          <p>Провайдеры, сеть и качество</p>
        </div>
      </div>

      <section className="panel surface-hero surface-deep">
        <div className="panel-head">
          <div>
            <h2>Яндекс.Музыка</h2>
            <p>
              Нужен OAuth-токен своего аккаунта. Полностью работает только с подпиской Плюс: без неё сервис отдаёт
              тридцатисекундные обрывки, поэтому такой Яндекс автоматически отключается и всё играет через YouTube.
            </p>
          </div>
          <span className={`pill ${yn?.active ? 'ok' : 'off'}`}>
            {yn?.active ? 'основной' : yn?.hasToken ? 'выключен' : 'не подключён'}
          </span>
        </div>

        <form
          className="token-row"
          onSubmit={(e) => {
            e.preventDefault()
            if (!busy) void run('save')
          }}
        >
          <input
            className="token-input"
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="y0_AgAAAAB… — вставь токен"
            spellCheck={false}
            autoComplete="off"
          />
          <button className="play-btn" type="submit" disabled={!token.trim() || busy !== null}>
            {busy === 'save' ? <span className="spinner" /> : null}
            Проверить и подключить
          </button>
          {yn?.hasToken && (
            <button className="play-btn ghost" type="button" disabled={busy !== null} onClick={() => void run('clear')}>
              Отключить
            </button>
          )}
        </form>

        <div className="status-list">
          <div>
            <span>Токен</span>
            <b>{yn?.hasToken ? 'сохранён' : 'нет'}</b>
          </div>
          <div>
            <span>Аккаунт</span>
            <b>{yn?.login ?? '—'}</b>
          </div>
          <div>
            <span>Плюс</span>
            <b style={{ color: yn?.hasPlus ? 'var(--accent)' : undefined }}>{yn?.hasPlus ? 'активен' : 'нет'}</b>
          </div>
          <div>
            <span>Используется</span>
            <b>{yn?.active ? 'как основной' : 'только YouTube'}</b>
          </div>
          <div>
            <span>Максимум качества</span>
            <b>
              {yn?.lossless === 'available'
                ? 'FLAC (lossless)'
                : yn?.lossless === 'unavailable'
                  ? 'MP3 320 — FLAC нет в тарифе'
                  : yn?.active
                    ? 'проверю при первом треке'
                    : '—'}
            </b>
          </div>
        </div>

        {yn?.error && <div className="notice">{yn.error}</div>}

        <div className="panel-foot">
          <button className="link-btn" onClick={() => void run('refresh')} disabled={!yn?.hasToken || busy !== null}>
            {busy === 'refresh' ? 'Проверяю…' : 'Перепроверить подписку'}
          </button>
          <a className="link-btn" href="https://ym.marshal.dev/token/" target="_blank" rel="noreferrer">
            Где взять токен ↗
          </a>
        </div>
      </section>

      <section className="panel surface-hero surface-deep">
        <div className="panel-head">
          <div>
            <h2>Звук</h2>
            <p>
              Оба провайдера играют через Web Audio: это даёт стык треков без паузы и выравнивание громкости.
              Поток идёт через локальный прокси — иначе браузерный движок не пропускает чужое аудио в обработку.
            </p>
          </div>
          <span className="pill ok">включено</span>
        </div>

        <div className="field">
          <label htmlFor="xfade">Переход между треками</label>
          <select
            id="xfade"
            className="input"
            value={crossfade}
            onChange={(e) => onCrossfade(Number(e.target.value))}
          >
            <option value={0}>Без паузы (gapless)</option>
            <option value={3}>Кроссфейд 3 с</option>
            <option value={6}>Кроссфейд 6 с</option>
            <option value={12}>Кроссфейд 12 с</option>
          </select>
        </div>

        <label className="check">
          <input type="checkbox" checked={normalize} onChange={(e) => onNormalize(e.target.checked)} />
          <span className="check-box" aria-hidden="true" />
          <span className="check-copy">
            <b>Выравнивать громкость</b>
            <em>
              Тихое поднимается, громкое опускается к одному уровню (−18 dBFS RMS). В плеере показывает текущую
              поправку: плюс — поднял, минус — приглушил.
            </em>
          </span>
        </label>
      </section>

      <section className="panel surface-hero surface-deep">
        <div className="panel-head">
          <div>
            <h2>Обновления</h2>
            <p>
              Проверяет новые релизы Undertow на GitHub. Скачивание и установка запускаются
              только вручную — приложение не перезапустится без твоего согласия.
            </p>
          </div>
          <span
            className={`pill ${
              update?.status === 'available' || update?.status === 'downloaded'
                ? 'ok'
                : update?.status === 'error'
                  ? 'off'
                  : ''
            }`}
          >
            {update?.status === 'checking'
              ? 'проверяю'
              : update?.status === 'available'
                ? 'есть обновление'
                : update?.status === 'downloading'
                  ? `${update.progress}%`
                  : update?.status === 'downloaded'
                    ? 'готово'
                    : update?.status === 'error'
                      ? 'ошибка'
                      : update?.status === 'disabled'
                        ? 'в установленной версии'
                        : 'актуально'}
          </span>
        </div>

        <div className="status-list">
          <div>
            <span>Установлено</span>
            <b>{update?.currentVersion ?? APP_VERSION}</b>
          </div>
          <div>
            <span>Доступно</span>
            <b>{update?.version ?? '—'}</b>
          </div>
        </div>

        {update?.notes && <div className="update-notes">{update.notes}</div>}

        {update?.status === 'downloading' && (
          <div className="update-progress" aria-label={`Скачано ${update.progress}%`}>
            <span style={{ width: `${update.progress}%` }} />
          </div>
        )}

        {update?.error && update.status !== 'disabled' && <div className="notice">{update.error}</div>}
        {update?.status === 'disabled' && (
          <div className="notice">Автообновление работает в установленной версии приложения.</div>
        )}

        <div className="panel-foot">
          {update?.status === 'available' ? (
            <button
              className="play-btn"
              type="button"
              onClick={() => {
                void window.undertow.updateDownload().then(setUpdate)
              }}
            >
              Скачать {update.version}
            </button>
          ) : update?.status === 'downloaded' ? (
            <button
              className="play-btn"
              type="button"
              onClick={() => void window.undertow.updateInstall()}
            >
              Установить и перезапустить
            </button>
          ) : (
            <button
              className="link-btn"
              type="button"
              disabled={updateBusy || update?.status === 'checking' || update?.status === 'downloading'}
              onClick={() => {
                setUpdateBusy(true)
                void window.undertow
                  .updateCheck()
                  .then(setUpdate)
                  .catch((e) => onToast(e instanceof Error ? e.message : String(e), 'error'))
                  .finally(() => setUpdateBusy(false))
              }}
            >
              {update?.status === 'checking' ? 'Проверяю…' : 'Проверить обновления'}
            </button>
          )}
          <span className="settings-hint">Проверка также идёт при запуске и раз в 4 часа</span>
        </div>
      </section>

      <section id="settings-dpi" ref={dpiRef} className="panel surface-hero surface-deep">
        <div className="panel-head">
          <div>
            <h2>Обход блокировок</h2>
            <p>
              YouTube в России часто открывается в разы медленнее из-за DPI. UndertowDPI сам перехватывает
              TLS-рукопожатие к доменам YouTube и Google и делит его на два TCP-сегмента через WinDivert.
              Остальной трафик не трогается. Переключение идёт через службу, без UAC.
            </p>
          </div>
          <span className={`pill ${dpi?.state === 'on' ? 'ok' : 'off'}`}>{dpiLabel}</span>
        </div>

        <label className="check">
          <input
            type="checkbox"
            checked={Boolean(dpi?.running)}
            disabled={!dpiCanToggle}
            onChange={(e) => void toggleDpi(e.target.checked)}
          />
          <span className="check-box" aria-hidden="true" />
          <span className="check-copy">
            <b>Обход DPI для YouTube</b>
            <em>
              Служба UndertowDpi устанавливается вместе с приложением. Включение и выключение идут без UAC,
              а при закрытии Undertow служба сама выключает обход.
            </em>
          </span>
        </label>

        <div className="status-list">
          <div>
            <span>Состояние</span>
            <b>{dpiLabel}</b>
          </div>
          <div>
            <span>Движок</span>
            <b>UndertowDPI + WinDivert</b>
          </div>
          <div>
            <span>Правила</span>
            <b>TLS ClientHello · TCP 443</b>
          </div>
          <div>
            <span>Режим</span>
            <b>служба, без UAC</b>
          </div>
          <div>
            <span>Права</span>
            <b>служба работает от SYSTEM</b>
          </div>
        </div>

        {dpi?.error && <div className="notice">{dpi.error}</div>}

        <div className="panel-foot">
          <button className="link-btn" onClick={() => void refreshDpi()} disabled={dpiBusy}>
            Проверить
          </button>
        </div>
      </section>

      <section className="panel surface-hero surface-deep">
        <div className="panel-head">
          <div>
            <h2>Диагностика</h2>
            <p>
              Журнал приложения: запуск, включение DPI, разрешение ссылок, ошибки потока и ответы
              аудио-прокси. По нему видно, на каком треке и узле CDN всё сломалось.
            </p>
          </div>
        </div>
        <div className="status-list">
          <div>
            <span>Файл лога</span>
            <b>%APPDATA%\undertow\app.log</b>
          </div>
        </div>
        <div className="panel-foot">
          <button className="link-btn" onClick={() => void window.undertow.openLog()}>
            Открыть лог
          </button>
        </div>
      </section>

      <section className="panel surface-hero surface-deep">
        <div className="panel-head">
          <div>
            <h2>YouTube</h2>
            <p>Работает всегда и без аккаунта. Если Яндекс активен — добирает то, чего в нём нет.</p>
          </div>
          <span className={`pill ${state?.youtube.ready ? 'ok' : 'off'}`}>
            {state?.youtube.ready ? 'готов' : 'yt-dlp не найден'}
          </span>
        </div>
        <div className="status-list">
          <div>
            <span>yt-dlp</span>
            <b>{state?.youtube.ytdlp ?? '—'}</b>
          </div>
          <div>
            <span>движок</span>
            <b>
              {state?.youtube.engine === 'bundled'
                ? 'встроенный'
                : state?.youtube.engine === 'python'
                  ? 'python'
                  : state?.youtube.engine === 'system'
                    ? 'системный'
                    : '—'}
            </b>
          </div>
          <div>
            <span>Кодек</span>
            <b>Opus / AAC, играет Chromium</b>
          </div>
        </div>
      </section>

      <div className="about-line">
        <span>
          Undertow <b>v{APP_VERSION}</b> · by {APP_AUTHOR}
        </span>
        <span>личный клиент музыки · Яндекс и YouTube</span>
      </div>
    </div>
  )
}
