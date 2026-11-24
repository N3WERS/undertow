import { useState } from 'react'
import type { ProviderState } from '../types'
import { APP_AUTHOR, APP_VERSION } from '../version'

interface Props {
  state: ProviderState | null
  onState: (s: ProviderState) => void
  onToast: (text: string, kind?: 'info' | 'error') => void
  crossfade: number
  onCrossfade: (v: number) => void
  normalize: boolean
  onNormalize: (v: boolean) => void
}

export default function Settings({ state, onState, onToast, crossfade, onCrossfade, normalize, onNormalize }: Props) {
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState<'save' | 'clear' | 'refresh' | null>(null)
  const yn = state?.yandex

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

  return (
    <div className="scroll">
      <div className="page-head">
        <div>
          <h1>Настройки</h1>
          <p>Провайдеры, токен и качество</p>
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
          <span>
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
            <span>python</span>
            <b>{state?.youtube.python ?? '—'}</b>
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
