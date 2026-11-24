import { useEffect, useRef, useState } from 'react'
import type { Section, Track } from '../types'
import TrackList, { fmtTime } from './TrackList'
import { IconClose, IconPlay, IconSpark } from './Icons'

interface Props {
  sections: Section[]
  loading: boolean
  error: string | null
  currentId: string | null
  playing: boolean
  onPlay: (track: Track, list: Track[]) => void
  onToggle: () => void
  onLocked: (track: Track) => void
  likedIds?: Set<string>
  onLike?: (track: Track) => void
  onHover?: (track: Track) => void
  onAddToQueue?: (track: Track) => void
  /** пересобрать персональную подборку заново */
  onRefresh?: () => void
  refreshing?: boolean
  /** открыть страницу артиста/альбома (карточки из ленты и персональные секции) */
  onOpenPage?: (
    kind: 'artist' | 'album',
    target: { id?: string; name?: string; title: string; artist?: string }
  ) => void
  /** убрать секцию с главной (запоминается) */
  onHideSection?: (sectionId: string) => void
  hiddenCount?: number
  onRestoreHidden?: () => void
  onOpenArtist?: (target: { id?: string; name: string }) => void
  onOpenAlbum?: (target: { id?: string; title: string; artist?: string; trackTitle?: string }) => void
  onAddToPlaylist?: (track: Track) => void
  onSimilar?: (track: Track) => void
}

/** Из id секции достаём сущность, для которой есть отдельная страница. */
function sectionTarget(
  id: string
): { kind: 'artist' | 'album'; id?: string; name?: string } | null {
  const named = id.match(/^rec-artist-name:(.+)$/)
  if (named) return { kind: 'artist', name: decodeURIComponent(named[1]) }
  const artist = id.match(/^rec-artist-(.+)$/)
  if (artist) return { kind: 'artist', id: artist[1] }
  const album = id.match(/^rec-album-(.+)$/)
  if (album) return { kind: 'album', id: album[1] }
  return null
}

interface StripAlbum {
  key: string
  title: string
  cover: string
  year?: string
  id?: string
  artist: string
  trackTitle?: string
}

/** Альбомы артиста для полоски под шапкой секции. */
function sectionAlbums(s: Section): StripAlbum[] {
  const artist = s.title.replace(/^Ещё от /, '')
  const listed = (s.albums ?? []).filter((a) => a.coverUrl)
  if (listed.length >= 2) {
    return listed.slice(0, 4).map((a) => ({
      key: a.id,
      title: a.title,
      cover: a.coverUrl as string,
      year: a.year,
      id: a.id,
      artist
    }))
  }
  const seen = new Map<string, StripAlbum & { n: number }>()
  for (const t of s.items) {
    if (!t.album || !t.coverUrl) continue
    const key = t.albumId ?? t.album
    const cur = seen.get(key)
    if (cur) cur.n++
    else
      seen.set(key, {
        key,
        title: t.album,
        cover: t.coverUrl,
        id: t.albumId,
        artist: t.artist ?? artist,
        trackTitle: t.title,
        n: 1
      })
  }
  return [...seen.values()].sort((a, b) => b.n - a.n).slice(0, 4)
}

/** «12 треков / 2 трека / 1 трек» */
function tracksWord(n: number): string {
  const a = n % 10
  const b = n % 100
  if (a === 1 && b !== 11) return `${n} трек`
  if (a >= 2 && a <= 4 && (b < 12 || b > 14)) return `${n} трека`
  return `${n} треков`
}

/** Короткое имя секции для липкой панели. */
function chipLabel(s: Section): string {
  if (s.id === 'rec-resume') return 'Продолжить'
  if (s.id === 'rec-forgotten') return 'Давно не слушали'
  if (s.id.startsWith('rec-artist')) return s.title.replace(/^Ещё от /, '')
  if (s.id.startsWith('rec-album')) return s.title.replace(/^Альбом /, '')
  if (s.id.startsWith('rec-new')) return s.title.replace(/^Новое от /, '') + ' · новое'
  return s.title.length > 22 ? `${s.title.slice(0, 21)}…` : s.title
}

function Hero({
  track,
  onPlay,
  list,
  kicker,
  onOpenArtist,
  onOpenAlbum
}: {
  track: Track
  list: Track[]
  onPlay: (t: Track, l: Track[]) => void
  kicker: string
  onOpenArtist?: (target: { id?: string; name: string }) => void
  onOpenAlbum?: (target: { id?: string; title: string; artist?: string; trackTitle?: string }) => void
}) {
  return (
    <section className="hero fade-up">
      {track.coverUrl && <div className="hero-bg" style={{ backgroundImage: `url(${track.coverUrl})` }} />}
      <div className="hero-meta">
        <span className="hero-kicker">{kicker}</span>
        <h2 className="hero-title">{track.title}</h2>
        <div className="hero-artist">
          {track.artist}
          {track.durationSec ? ` · ${fmtTime(track.durationSec)}` : ''}
        </div>
        <div className="hero-tags">
          <span className="hero-tag">{track.provider === 'yandex' ? 'Яндекс Музыка' : 'YouTube Music'}</span>
          <span className="hero-tag">{tracksWord(list.length)} в подборке</span>
        </div>
        <div className="hero-actions">
          <button className="play-btn" onClick={() => onPlay(track, list)}>
            <IconPlay width={15} height={15} />
            Слушать
          </button>
          {track.artist && onOpenArtist ? (
            <button
              className="ghost-btn"
              onClick={() => onOpenArtist({ id: track.artistId, name: track.artist as string })}
            >
              Об артисте
            </button>
          ) : null}
          {track.album && onOpenAlbum ? (
            <button
              className="ghost-btn"
              title={`Открыть альбом: ${track.album}`}
              onClick={() =>
                onOpenAlbum({
                  id: track.albumId,
                  title: track.album as string,
                  artist: track.artist,
                  trackTitle: track.title
                })
              }
            >
              Альбом
            </button>
          ) : null}
        </div>
      </div>
      {track.coverUrl && <img className="hero-cover" src={track.coverUrl} alt="" />}
    </section>
  )
}

export default function Home({
  sections,
  loading,
  error,
  currentId,
  playing,
  onPlay,
  onToggle,
  onLocked,
  likedIds,
  onLike,
  onHover,
  onAddToQueue,
  onRefresh,
  refreshing,
  onOpenPage,
  onHideSection,
  hiddenCount,
  onRestoreHidden,
  onOpenArtist,
  onOpenAlbum,
  onAddToPlaylist,
  onSimilar
}: Props) {
  // раскрытые секции: по умолчанию видно 8 строк, кнопка показывает все
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const toggleSection = (id: string) => setExpanded((prev) => ({ ...prev, [id]: !prev[id] }))

  const personal = sections.some((s) => s.id.startsWith('rec-'))
  const trending = sections.find((s) => s.layout === 'list' && s.items.some((i) => i.playable))
  const heroTrack = trending?.items.find((i) => i.playable && i.coverUrl) ?? trending?.items[0]

  // липкая панель быстрых переходов по секциям
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const chipsRef = useRef<HTMLDivElement | null>(null)
  const chipsNavRef = useRef<HTMLElement | null>(null)
  const sectionRefs = useRef<Record<string, HTMLElement | null>>({})
  const [active, setActive] = useState<string | null>(null)
  const [stuck, setStuck] = useState(false)
  const [edges, setEdges] = useState({ left: false, right: false })

  /** Стрелки показываем только если чипы реально не влезли. */
  const syncEdges = (): void => {
    const el = chipsNavRef.current
    if (!el) return
    const max = el.scrollWidth - el.clientWidth
    setEdges((prev) => {
      const next = { left: el.scrollLeft > 2, right: max > 2 && el.scrollLeft < max - 2 }
      return prev.left === next.left && prev.right === next.right ? prev : next
    })
  }

  useEffect(() => {
    syncEdges()
    const el = chipsNavRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(syncEdges)
    ro.observe(el)
    return () => ro.disconnect()
  }, [sections.length])

  const jumpTo = (id: string): void => {
    const sc = scrollRef.current
    const el = sectionRefs.current[id]
    if (!sc || !el) return
    // цель — сразу под липкой полосой. Высота полосы, а не её текущий низ:
    // в самом верху страницы она ещё не прилипла и стоит ниже
    const barH = chipsRef.current?.getBoundingClientRect().height ?? 0
    const target = sc.getBoundingClientRect().top + barH + 40
    const delta = el.getBoundingClientRect().top - target
    sc.scrollTo({ top: sc.scrollTop + delta, behavior: 'smooth' })
  }

  /** Держим нажатый чип по центру полосы, чтобы он не уезжал под край. */
  const centerChip = (el: HTMLElement): void => {
    const nav = chipsNavRef.current
    if (!nav) return
    const navRect = nav.getBoundingClientRect()
    const elRect = el.getBoundingClientRect()
    const delta = elRect.left - navRect.left - (nav.clientWidth - elRect.width) / 2
    nav.scrollBy({ left: delta, behavior: 'smooth' })
  }

  const trackScroll = (): void => {
    const sc = scrollRef.current
    if (!sc) return
    // offsetTop врёт, если offsetParent не скролл-контейнер: считаем по экрану
    const barH = chipsRef.current?.getBoundingClientRect().height ?? 0
    const line = sc.getBoundingClientRect().top + barH + 44
    const wrap = chipsRef.current
    const flush = Boolean(wrap) && wrap!.getBoundingClientRect().top <= sc.getBoundingClientRect().top + 1
    setStuck((prev) => (prev === flush ? prev : flush))

    let current: string | null = null
    for (const s of sections) {
      const el = sectionRefs.current[s.id]
      if (el && el.getBoundingClientRect().top <= line) current = s.id
    }
    // последняя секция может не дотянуться до линии — подсвечиваем её у дна
    if (sc.scrollTop + sc.clientHeight >= sc.scrollHeight - 4) {
      current = sections[sections.length - 1]?.id ?? current
    }
    setActive(current)
  }

  if (loading) {
    return (
      <div className="scroll">
        <div className="page-head">
          <div>
            <h1>Главная</h1>
            <p>Подтягиваю новинки и тренды…</p>
          </div>
        </div>
        <div className="skeleton" style={{ height: 220, marginBottom: 30 }} />
        {[0, 1].map((i) => (
          <div key={i} style={{ marginBottom: 30 }}>
            <div className="skeleton" style={{ height: 16, width: 180, marginBottom: 14 }} />
            <div className="skeleton" style={{ height: 132 }} />
          </div>
        ))}
      </div>
    )
  }

  if (error) {
    return (
      <div className="scroll">
        <div className="page-head">
          <div>
            <h1>Главная</h1>
            <p>Ленту получить не удалось</p>
          </div>
        </div>
        <div className="empty">
          <b>Ошибка загрузки</b>
          {error}
        </div>
      </div>
    )
  }

  return (
    <div className="scroll" ref={scrollRef} onScroll={trackScroll}>
      <div className="page-head">
        <div>
          <h1>Главная</h1>
          <p>
            {personal
              ? (() => {
                  const tracks = sections.reduce((n, s) => n + s.items.length, 0)
                  const artists = new Set(
                    sections.flatMap((s) => s.items.map((t) => (t.artist ?? '').split(',')[0].trim()))
                  ).size
                  return `Собрано по вашим лайкам и истории · ${tracks} треков · ${artists} артистов`
                })()
              : 'Новинки и тренды · обновлено только что'}
          </p>
        </div>
        {personal ? (
          <div className="head-tools">
            {hiddenCount ? (
              <button
                className="ghost-btn"
                onClick={onRestoreHidden}
                title="Вернуть скрытые секции на главную"
              >
                вернуть секции ({hiddenCount})
              </button>
            ) : null}
            {onRefresh ? (
              <button className="ghost-btn" onClick={onRefresh} disabled={refreshing} title="Пересобрать подборку заново">
                <IconSpark width={14} height={14} />
                {refreshing ? 'собираю…' : 'обновить подборку'}
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      {sections.length > 2 ? (
        <div
          className={`chips-wrap${stuck ? ' stuck' : ''}${edges.left ? ' has-left' : ''}${
            edges.right ? ' has-right' : ''
          }`}
          ref={chipsRef}
        >
          {edges.left ? (
            <button
              className="chips-nav left"
              onClick={() => chipsNavRef.current?.scrollBy({ left: -240, behavior: 'smooth' })}
              aria-label="Предыдущие подборки"
            >
              ‹
            </button>
          ) : null}
          <nav
            className="section-chips"
            aria-label="Секции главной"
            ref={chipsNavRef}
            onScroll={syncEdges}
          >
            {sections.map((s) => (
              <button
                key={s.id}
                className={`section-chip${active === s.id ? ' active' : ''}`}
                onClick={(e) => {
                  jumpTo(s.id)
                  centerChip(e.currentTarget)
                }}
                title={s.title}
              >
                {chipLabel(s)}
              </button>
            ))}
          </nav>
          {edges.right ? (
            <button
              className="chips-nav right"
              onClick={() => chipsNavRef.current?.scrollBy({ left: 240, behavior: 'smooth' })}
              aria-label="Следующие подборки"
            >
              ›
            </button>
          ) : null}
        </div>
      ) : null}

      {heroTrack && (
        <Hero
          track={heroTrack}
          list={trending!.items}
          onPlay={onPlay}
          kicker={trending!.title}
          onOpenArtist={onOpenArtist}
          onOpenAlbum={onOpenAlbum}
        />
      )}

      {sections.map((s, idx) => {
        const isArtist = s.id.startsWith('rec-artist')
        const open = Boolean(expanded[s.id])
        const canExpand = s.layout === 'list' && s.items.length > 8
        return (
        <section
          className={`section fade-up${isArtist ? ' section-artist' : ''}`}
          key={s.id}
          ref={(el) => {
            sectionRefs.current[s.id] = el
          }}
          style={{ animationDelay: `${Math.min(idx * 45, 220)}ms` }}
        >
          <div className="section-head">
            <div className="section-title">
              {s.coverUrl ? (
                <img className="section-avatar" src={s.coverUrl} alt="" loading="lazy" />
              ) : null}
              <div>
                <h2>{s.title}</h2>
                {s.subtitle ? <div className="section-sub">{s.subtitle}</div> : null}
              </div>
            </div>
            <div className="section-tools">
              {s.layout === 'list' && s.items.length ? (
                <button
                  className="section-play"
                  title="Поставить всю подборку в очередь"
                  onClick={() => onPlay(s.items[0], s.items)}
                >
                  <IconPlay width={11} height={11} />
                  слушать всё
                </button>
              ) : null}
              {(() => {
                const target = sectionTarget(s.id)
                if (!target || !onOpenPage) return null
                return (
                  <button
                    className="section-more"
                    title={target.kind === 'artist' ? 'Открыть страницу артиста' : 'Открыть альбом'}
                    onClick={() => onOpenPage(target.kind, { ...target, title: s.title })}
                  >
                    {target.kind === 'artist' ? 'артист' : 'альбом'} →
                  </button>
                )
              })()}
              {onHideSection ? (
                <button
                  className="section-hide"
                  title="Больше не показывать эту секцию"
                  onClick={() => onHideSection(s.id)}
                >
                  <IconClose width={13} height={13} />
                </button>
              ) : null}
            </div>
          </div>

          {isArtist && onOpenAlbum ? (() => {
            const albums = sectionAlbums(s)
            if (albums.length < 2) return null
            return (
              <div className="album-strip">
                {albums.map((a) => (
                  <button
                    key={a.key}
                    className="album-thumb"
                    title={`Открыть альбом: ${a.title}`}
                    onClick={() =>
                      onOpenAlbum({
                        id: a.id,
                        title: a.title,
                        artist: a.artist,
                        trackTitle: a.trackTitle
                      })
                    }
                  >
                    <span className="album-thumb-img">
                      <img src={a.cover} alt="" loading="lazy" />
                    </span>
                    <span className="album-thumb-title">{a.title}</span>
                    {a.year ? <span className="album-thumb-year">{a.year}</span> : null}
                  </button>
                ))}
              </div>
            )
          })() : null}

          {s.layout === 'list' ? (
            <>
              <TrackList
                tracks={s.items}
                limit={open ? undefined : 8}
                currentId={currentId}
                playing={playing}
                onPlay={onPlay}
                onToggle={onToggle}
                onLocked={onLocked}
                likedIds={likedIds}
                onLike={onLike}
                onHover={onHover}
                onAddToQueue={onAddToQueue}
                onOpenArtist={onOpenArtist}
                onOpenAlbum={onOpenAlbum}
                onAddToPlaylist={onAddToPlaylist}
                onSimilar={onSimilar}
                playContext={s.items}
              />
              {canExpand ? (
                <button
                  className={`expand-btn${open ? ' open' : ''}`}
                  onClick={() => toggleSection(s.id)}
                >
                  {open ? 'свернуть' : `показать все ${s.items.length}`}
                </button>
              ) : null}
            </>
          ) : (
            <div className="cards">
              {s.items.map((item, i) => (
                <button
                  className="card"
                  key={`${item.id}-${i}`}
                  onClick={() => {
                    const album = item.id.match(/^ym-album:(\d+)$/)
                    const artist = item.id.match(/^ym-artist:(\d+)$/)
                    if (album && onOpenPage) onOpenPage('album', { id: album[1], title: item.title })
                    else if (artist && onOpenPage) onOpenPage('artist', { id: artist[1], title: item.title })
                    else if (onOpenPage && item.kind === 'artist') {
                      // YouTube-карточка: id канала нам не поможет, но имя открывается
                      const name = item.title.replace(/\s*-\s*Topic$/i, '')
                      onOpenPage('artist', { name, title: name })
                    } else if (onOpenPage && item.kind === 'album') {
                      // у YouTube Music есть настоящий id альбома — открываем его
                      const ytm = item.id.match(/^yt:(MPREb[\w-]+)$/)
                      onOpenPage('album', ytm ? { id: `yt-album:${ytm[1]}`, title: item.title } : { title: item.title })
                    } else onLocked(item)
                  }}
                >
                  <div className="card-img">
                    {item.coverUrl ? <img src={item.coverUrl} alt="" loading="lazy" /> : null}
                    <span className="card-fade">
                      {item.kind === 'album'
                        ? 'альбом'
                        : item.kind === 'artist'
                          ? 'артист'
                          : item.kind === 'playlist'
                            ? 'плейлист'
                            : item.kind === 'video'
                              ? 'видео'
                              : 'трек'}
                    </span>
                  </div>
                  <div className="card-title">{item.title}</div>
                  <div className="card-sub">{item.artist}</div>
                </button>
              ))}
            </div>
          )}
        </section>
        )
      })}

      {!sections.length && !error && (
        <div className="empty">
          <b>Пока пусто</b>Лента не вернула ни одной секции.
        </div>
      )}
    </div>
  )
}
