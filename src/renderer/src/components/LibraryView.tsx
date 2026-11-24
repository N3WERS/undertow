import { useState } from 'react'
import type { Track } from '../types'
import TrackList from './TrackList'

interface Props {
  likes: Track[]
  history: Track[]
  likedIds: Set<string>
  currentId: string | null
  playing: boolean
  canImport: boolean
  importing: boolean
  yandexActive: boolean
  onPlay: (track: Track, list: Track[]) => void
  onToggle: () => void
  onLike: (track: Track) => void
  onLocked: (track: Track) => void
  onImport: () => void
  onClearHistory: () => void
  onHover?: (track: Track) => void
  onOpenArtist?: (target: { id?: string; name: string }) => void
  onOpenAlbum?: (target: { id?: string; title: string; artist?: string; trackTitle?: string }) => void
  onAddToQueue?: (track: Track) => void
}

type Tab = 'likes' | 'history'

export default function LibraryView(p: Props) {
  const [tab, setTab] = useState<Tab>('likes')
  const list = tab === 'likes' ? p.likes : p.history

  return (
    <div className="scroll">
      <div className="page-head">
        <div>
          <h1>Библиотека</h1>
          <p>
            {p.likes.length} в «Мне нравится» · {p.history.length} в истории
          </p>
        </div>
        <div className="head-actions">
          {p.canImport && (
            <button className="play-btn ghost" onClick={p.onImport} disabled={p.importing}>
              {p.importing ? <span className="spinner" /> : null}
              {p.importing ? 'Импортирую…' : 'Импортировать лайки из Яндекса'}
            </button>
          )}
          {tab === 'likes' && p.likes.length > 0 && (
            <button className="play-btn" onClick={() => p.likes[0] && p.onPlay(p.likes[0], p.likes)}>
              Слушать всё
            </button>
          )}
          {tab === 'history' && p.history.length > 0 && (
            <button className="link-btn" onClick={p.onClearHistory}>
              Очистить историю
            </button>
          )}
        </div>
      </div>

      {!p.yandexActive && p.likes.some((t) => t.provider === 'yandex') && (
        <div className="notice">
          Яндекс отключён — его треки в библиотеке будут играть найденными копиями с YouTube (первый запуск трека ищет
          пару 2–3 секунды, дальше запоминается).
        </div>
      )}

      <div className="tabs">
        <button className={`tab${tab === 'likes' ? ' on' : ''}`} onClick={() => setTab('likes')}>
          Мне нравится
          <span className="tab-count">{p.likes.length}</span>
        </button>
        <button className={`tab${tab === 'history' ? ' on' : ''}`} onClick={() => setTab('history')}>
          История
          <span className="tab-count">{p.history.length}</span>
        </button>
      </div>

      {list.length === 0 ? (
        <div className="empty">
          <b>{tab === 'likes' ? 'Пока пусто' : 'Ещё ничего не слушал'}</b>
          {tab === 'likes'
            ? p.canImport
              ? 'Нажми «Импортировать лайки из Яндекса» — подтянется всё, что ты лайкал там, или ставь сердечки прямо в списках.'
              : 'Ставь сердечки на треках — они появятся здесь. При подключённом Яндексе лайки уходят и в его библиотеку.'
            : 'История собирается сама: всё, что играло, попадает сюда.'}
        </div>
      ) : (
        <TrackList
          tracks={list}
          currentId={p.currentId}
          playing={p.playing}
          onPlay={p.onPlay}
          onToggle={p.onToggle}
          onLocked={p.onLocked}
          likedIds={p.likedIds}
          onLike={p.onLike}
          onHover={p.onHover}
          onAddToQueue={p.onAddToQueue}
          onOpenArtist={p.onOpenArtist}
          onOpenAlbum={p.onOpenAlbum}
          showSource
        />
      )}
    </div>
  )
}
