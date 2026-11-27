import { useEffect, useState } from 'react'
import type { BrowsePage, Track } from '../types'
import TrackList from './TrackList'
import { IconBookmark, IconDownload, IconPlay, IconRadio, IconWave } from './Icons'
import { enqueueDownloads } from '../downloads'

interface Props {
  kind: 'artist' | 'album' | 'playlist'
  loading: boolean
  error: string | null
  page: BrowsePage | null
  currentId: string | null
  playing: boolean
  likedIds?: Set<string>
  onPlay: (track: Track, list: Track[]) => void
  onToggle: () => void
  onLike?: (track: Track) => void
  onHover?: (track: Track) => void
  onAddToQueue?: (track: Track) => void
  onBack: () => void
  onOpenAlbum: (target: { id?: string; title: string; artist?: string; trackTitle?: string }) => void
  onAddToPlaylist?: (track: Track) => void
  onSimilar?: (track: Track) => void
  onOpenArtist?: (target: { id?: string; name: string }) => void
  /** «радио артиста»: своё + похожие, сразу в очередь */
  onRadio?: () => void
  onFlow?: (tracks: Track[], title: string) => void
  radioLoading?: boolean
  /** альбом уже сохранён в библиотеке */
  albumSaved?: boolean
  onToggleAlbum?: () => void
}

/**
 * Страница артиста или альбома. Одна на два случая: отличается шапка
 * (у артиста ещё блок его альбомов) и подпись-kicker.
 */
export default function BrowseView({
  kind,
  loading,
  error,
  page,
  currentId,
  playing,
  likedIds,
  onPlay,
  onToggle,
  onLike,
  onHover,
  onAddToQueue,
  onBack,
  onOpenAlbum,
  onAddToPlaylist,
  onSimilar,
  onOpenArtist,
  onRadio,
  onFlow,
  radioLoading,
  albumSaved,
  onToggleAlbum
}: Props) {
  const [genre, setGenre] = useState<{ id: string; name: string }[]>([])
  const genreArtist = page
    ? kind === 'artist'
      ? page.title
      : page.tracks[0]?.artist ?? page.subtitle.split('·')[0]?.trim() ?? ''
    : ''
  const firstYmId = page?.tracks[0]
  const trackYmId =
    firstYmId?.provider === 'yandex' && /^\d+$/.test(firstYmId.artistId ?? '')
      ? firstYmId.artistId
      : undefined
  const genreYmId = page?.id?.startsWith('ym-artist:')
    ? page.id.slice('ym-artist:'.length)
    : trackYmId

  useEffect(() => {
    if (!genreArtist) {
      setGenre([])
      return
    }
    let alive = true
    setGenre([])
    void window.undertow
      .genreForArtist(genreArtist, genreYmId)
      .then((items) => {
        if (alive) setGenre(items)
      })
      .catch(() => {
        if (alive) setGenre([])
      })
    return () => {
      alive = false
    }
  }, [genreArtist, genreYmId])

  const head = (
    <div className="browse-top">
      <button className="back-btn" onClick={onBack} title="Назад">
        ←
      </button>
      <span className="browse-kicker">
        {kind === 'artist' ? 'Артист' : kind === 'playlist' ? 'Плейлист' : 'Альбом'}
      </span>
    </div>
  )

  if (loading) {
    return (
      <div className="scroll">
        {head}
        <div className="browse-head">
          <div className="skeleton browse-cover" />
          <div style={{ flex: 1 }}>
            <div className="skeleton" style={{ height: 30, width: 260, marginBottom: 12 }} />
            <div className="skeleton" style={{ height: 14, width: 180, marginBottom: 20 }} />
            <div className="skeleton" style={{ height: 34, width: 130 }} />
          </div>
        </div>
        <div className="skeleton" style={{ height: 200 }} />
      </div>
    )
  }

  if (error || !page) {
    return (
      <div className="scroll">
        {head}
        <div className="empty">
          <b>Не удалось открыть страницу</b>
          {error ?? 'Пустой ответ'}
        </div>
      </div>
    )
  }

  const playable = page.tracks.filter((t) => t.playable)

  return (
    <div className="scroll">
      {head}

      <div className="browse-head surface-hero surface-deep fade-up">
        {page.coverUrl ? (
          <div className="browse-wash" style={{ backgroundImage: `url(${page.coverUrl})` }} aria-hidden="true" />
        ) : null}
        <div className="browse-scrim" aria-hidden="true" />
        {page.coverUrl ? (
          <img className="browse-cover" src={page.coverUrl} alt="" />
        ) : (
          <div className="browse-cover" />
        )}
        {genre.length ? (
          <div className="browse-genre">
            <span className="browse-genre-name">
              {genre[0].name.charAt(0).toUpperCase() + genre[0].name.slice(1)}
            </span>
            {genre.length > 1 ? (
              <span className="browse-genre-more">
                {genre[1].name.charAt(0).toUpperCase() + genre[1].name.slice(1)}
              </span>
            ) : null}
          </div>
        ) : null}
        <div className="browse-info">
          <h1 className="browse-title">{page.title}</h1>
          <p className="browse-sub">{page.subtitle}</p>
          <div className="browse-actions">
            <button className="play-btn" disabled={!playable.length} onClick={() => onPlay(playable[0], playable)}>
              <IconPlay width={15} height={15} />
              Слушать всё
            </button>
            {playable.length > 0 ? (
              <button
                className="ghost-btn"
                title="Поставить все треки в очередь загрузок"
                onClick={() => void enqueueDownloads(playable)}
              >
                <IconDownload width={14} height={14} />
                Скачать
              </button>
            ) : null}
            {onFlow && playable.length > 0 ? (
              <button
                className="ghost-btn"
                title="Запустить Течение от этого списка"
                onClick={() => onFlow(playable, page.title)}
              >
                <IconWave width={14} height={14} />
                Течение
              </button>
            ) : null}
            {kind === 'artist' && onRadio ? (
              <button className="ghost-btn radio-btn" onClick={onRadio} disabled={radioLoading}>
                <IconRadio width={14} height={14} />
                {radioLoading ? 'собираю…' : 'Радио'}
              </button>
            ) : null}
            {kind === 'album' && onToggleAlbum ? (
              <button
                className={`ghost-btn save-album-btn${albumSaved ? ' on' : ''}`}
                onClick={onToggleAlbum}
                disabled={!page.tracks.length}
                title={albumSaved ? 'Убрать альбом из библиотеки' : 'Сохранить альбом в библиотеку'}
              >
                <IconBookmark width={14} height={14} filled={albumSaved} />
                {albumSaved ? 'В библиотеке' : 'Сохранить альбом'}
              </button>
            ) : null}
          </div>
        </div>
      </div>

      {kind === 'artist' && page.albums?.length ? (
        <section className="section">
          <div className="section-head">
            <h2>Альбомы</h2>
            <span className="count">{page.albums.length}</span>
          </div>
          <div className="cards">
            {page.albums.map((a) => (
              <button
                className="card"
                key={a.id}
                onClick={() => onOpenAlbum({ id: a.id, title: a.title, artist: page.title })}
              >
                <div className="card-img">
                  {a.coverUrl ? <img src={a.coverUrl} alt="" loading="lazy" /> : null}
                  <span className="card-fade">открыть</span>
                </div>
                <div className="card-title">{a.title}</div>
                <div className="card-sub">{a.year ?? 'альбом'}</div>
              </button>
            ))}
          </div>
        </section>
      ) : null}

      {kind === 'artist' && page.related?.length ? (
        <section className="section">
          <div className="section-head">
            <h2>Похожие исполнители</h2>
            <span className="count">{page.related.length}</span>
          </div>
          <div className="artist-cards">
            {page.related.map((a) => (
              <button
                className="artist-card"
                key={a.id}
                title={`Открыть страницу: ${a.name}`}
                onClick={() => onOpenArtist?.({ id: a.id, name: a.name })}
              >
                <div className="artist-card-img">
                  {a.coverUrl ? <img src={a.coverUrl} alt="" loading="lazy" /> : null}
                </div>
                <div className="artist-card-name">{a.name}</div>
              </button>
            ))}
          </div>
        </section>
      ) : null}

      <section className="section">
        <div className="section-head">
          <h2>{kind === 'artist' ? 'Популярные треки' : 'Треки'}</h2>
          <span className="count">{page.tracks.length}</span>
        </div>
        {page.tracks.length ? (
          <TrackList
            tracks={page.tracks}
            currentId={currentId}
            playing={playing}
            onPlay={(t, l) => onPlay(t, l)}
            onToggle={onToggle}
            likedIds={likedIds}
            onLike={onLike}
            onHover={onHover}
            onAddToQueue={onAddToQueue}
            onOpenArtist={onOpenArtist}
            onOpenAlbum={onOpenAlbum}
            onAddToPlaylist={onAddToPlaylist}
            onSimilar={onSimilar}
          />
        ) : (
          <div className="empty">
            <b>Пусто</b>Ни одного доступного трека.
          </div>
        )}
      </section>
    </div>
  )
}
