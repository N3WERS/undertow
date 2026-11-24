import { IconHome, IconLibrary, IconList, IconSearch, IconSettings, IconSpark, IconWave } from './Icons'
import type { ProviderState } from '../types'

export type View = 'home' | 'releases' | 'flow' | 'search' | 'library' | 'playlists' | 'settings'

interface Props {
  view: View
  onChange: (v: View) => void
  state: ProviderState | null
}

type Item = { id: View; label: string; icon: typeof IconHome }

export default function Sidebar({ view, onChange, state }: Props) {
  const yn = state?.yandex
  const listen: Item[] = [
    { id: 'home', label: 'Главная', icon: IconHome },
    { id: 'releases', label: 'Новинки', icon: IconSpark },
    { id: 'flow', label: 'Течение', icon: IconWave },
    { id: 'search', label: 'Поиск', icon: IconSearch }
  ]
  const collection: Item[] = [
    { id: 'library', label: 'Библиотека', icon: IconLibrary },
    { id: 'playlists', label: 'Плейлисты', icon: IconList }
  ]
  const settings: Item = { id: 'settings', label: 'Настройки', icon: IconSettings }
  const primary = state?.primary === 'yandex' ? 'Яндекс' : 'YouTube'

  const row = ({ id, label, icon: Icon }: Item) => (
    <button
      key={id}
      className={`nav-item${view === id ? ' active' : ''}`}
      onClick={() => onChange(id)}
    >
      <span className="nav-icon">
        <Icon />
      </span>
      <span>{label}</span>
    </button>
  )

  return (
    <aside className="sidebar">
      <div className="sidebar-glow" aria-hidden="true" />
      <nav className="nav">
        <div className="nav-label">Слушать</div>
        {listen.map(row)}
        <div className="nav-label nav-label-gap">Коллекция</div>
        {collection.map(row)}
      </nav>

      <div className="sidebar-bottom">
        {row(settings)}
        <div className="sidebar-foot">
          <div className="foot-title">Источники</div>
          <div className="row">
            <span className="foot-name">
              <i className={`status-dot${state?.primary === 'yandex' ? ' on' : ''}`} />
              Основной
            </span>
            <b>{primary}</b>
          </div>
          <div className="row">
            <span className="foot-name">
              <i className={`status-dot${yn?.active ? ' on' : ''}`} />
              Яндекс
            </span>
            <b>{!yn?.hasToken ? 'нет токена' : yn.active ? 'Плюс' : 'без Плюса'}</b>
          </div>
          <div className="row">
            <span className="foot-name">
              <i className={`status-dot${state?.youtube.ytdlp ? ' on' : ''}`} />
              yt-dlp
            </span>
            <b>{state?.youtube.ytdlp ?? '—'}</b>
          </div>
        </div>
      </div>
    </aside>
  )
}
