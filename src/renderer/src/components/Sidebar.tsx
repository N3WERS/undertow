import { IconHome, IconLibrary, IconSearch, IconSettings, IconWave } from './Icons'
import type { ProviderState } from '../types'

export type View = 'home' | 'flow' | 'search' | 'library' | 'settings'

interface Props {
  view: View
  onChange: (v: View) => void
  state: ProviderState | null
}

export default function Sidebar({ view, onChange, state }: Props) {
  const yn = state?.yandex
  const items: { id: View; label: string; icon: typeof IconHome }[] = [
    { id: 'home', label: 'Главная', icon: IconHome },
    { id: 'flow', label: 'Течение', icon: IconWave },
    { id: 'search', label: 'Поиск', icon: IconSearch },
    { id: 'library', label: 'Библиотека', icon: IconLibrary },
    { id: 'settings', label: 'Настройки', icon: IconSettings }
  ]

  const primary = state?.primary === 'yandex' ? 'Яндекс' : 'YouTube'

  return (
    <aside className="sidebar">
      <nav className="nav">
        <div className="nav-label">Слушать</div>
        {items.map(({ id, label, icon: Icon }) => (
          <button key={id} className={`nav-item${view === id ? ' active' : ''}`} onClick={() => onChange(id)}>
            <Icon />
            <span>{label}</span>
          </button>
        ))}
      </nav>

      <div className="sidebar-foot">
        <div className="row">
          <b>Основной</b>
          <span style={{ color: state?.primary === 'yandex' ? 'var(--accent)' : 'var(--text-dim)' }}>{primary}</span>
        </div>
        <div className="row">
          <b>Яндекс</b>
          <span style={{ color: yn?.active ? 'var(--accent)' : 'var(--text-mute)' }}>
            {!yn?.hasToken ? 'нет токена' : yn.active ? 'Плюс' : 'без Плюса'}
          </span>
        </div>
        <div className="row">
          <b>yt-dlp</b>
          <span>{state?.youtube.ytdlp ?? '—'}</span>
        </div>
      </div>
    </aside>
  )
}
