import { useEffect, useState } from 'react'
import { IconPlay, IconSpark } from './Icons'

interface Genre {
  id: string
  name: string
  artists: number
  weight: number
}

interface Artist {
  name: string
  weight: number
  coverUrl?: string
  artistId?: string
}

interface Props {
  onStartGenre: (id: string) => void
  onOpenArtist: (target: { id?: string; name: string }) => void
}

/** Градиент по номеру жанра: карточки не сливаются в одно серое полотно. */
const TINTS = [
  'linear-gradient(140deg, #123740, #0d1b22)',
  'linear-gradient(140deg, #1c2a46, #111826)',
  'linear-gradient(140deg, #33243d, #191420)',
  'linear-gradient(140deg, #2c3520, #161c12)',
  'linear-gradient(140deg, #3a2a20, #1c1510)',
  'linear-gradient(140deg, #1d3230, #101c1b)'
]

function initialGradient(name: string): string {
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360
  return `linear-gradient(140deg, hsl(${h} 58% 30%), hsl(${(h + 46) % 360} 54% 20%))`
}

export default function GenresView({ onStartGenre, onOpenArtist }: Props) {
  const [items, setItems] = useState<Genre[] | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [detail, setDetail] = useState<{ genre: Genre | null; artists: Artist[] } | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    let alive = true
    void window.undertow
      .flowGenres()
      .then((r) => alive && setItems(r.items))
      .catch(() => alive && setItems([]))
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    if (!selected) {
      setDetail(null)
      return
    }
    let alive = true
    setLoading(true)
    void window.undertow
      .genreDetail(selected)
      .then((r) => alive && setDetail(r))
      .catch(() => alive && setDetail(null))
      .finally(() => alive && setLoading(false))
    return () => {
      alive = false
    }
  }, [selected])

  const current = items?.find((g) => g.id === selected) ?? null

  return (
    <div className="scroll genres-page">
      {selected ? (
        <>
          <button className="back-link" onClick={() => setSelected(null)}>
            ← все жанры
          </button>
          <div className="page-head genre-detail-head">
            <div>
              <h1>{current?.name ?? 'Жанр'}</h1>
              <p>
                {current
                  ? `${current.artists} артистов из вашей библиотеки — топ по лайкам и прослушиваниям`
                  : 'Смотрю артистов…'}
              </p>
            </div>
            <button
              className="play-btn"
              disabled={loading || !(detail?.artists.length ?? 0)}
              onClick={() => selected && onStartGenre(selected)}
            >
              <IconPlay width={15} height={15} />
              Слушать всё
            </button>
          </div>

          {loading && !detail ? (
            <div className="empty">
              <b>Собираю</b>
              Подтягиваю артистов жанра…
            </div>
          ) : detail?.artists.length ? (
            <div className="artist-cards genre-artists">
              {detail.artists.map((a) => (
                <button
                  key={a.name}
                  className="artist-card"
                  title={`Открыть страницу: ${a.name}`}
                  onClick={() => onOpenArtist({ id: a.artistId, name: a.name })}
                >
                  <div className="artist-card-img">
                    {a.coverUrl ? (
                      <img src={a.coverUrl} alt="" loading="lazy" />
                    ) : (
                      <span className="artist-card-letter" style={{ background: initialGradient(a.name) }}>
                        {a.name.slice(0, 1).toUpperCase()}
                      </span>
                    )}
                  </div>
                  <div className="artist-card-name">{a.name}</div>
                </button>
              ))}
            </div>
          ) : (
            <div className="empty">
              <b>Пока пусто</b>
              В этом жанре не нашлось артистов из библиотеки.
            </div>
          )}
        </>
      ) : (
        <>
          <div className="page-head">
            <div>
              <h1>Жанры</h1>
              <p>Жанры, которые реально есть в вашей библиотеке. Внутри — топ артистов и поток целиком.</p>
            </div>
          </div>

          {!items ? (
            <div className="genre-grid">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="genre-card skeleton" />
              ))}
            </div>
          ) : items.length ? (
            <div className="genre-grid">
              {items.map((g, i) => (
                <button
                  key={g.id}
                  className="genre-card"
                  style={{ background: TINTS[i % TINTS.length] }}
                  onClick={() => setSelected(g.id)}
                >
                  <span className="genre-card-name">{g.name}</span>
                  <span className="genre-card-sub">{g.artists} артистов</span>
                  <span className="genre-card-go">открыть →</span>
                </button>
              ))}
            </div>
          ) : (
            <div className="empty">
              <IconSpark width={24} height={24} />
              <b>Жанры пока не собраны</b>
              Поставьте лайки нескольким артистам — и жанры появятся сами.
            </div>
          )}
        </>
      )}
    </div>
  )
}
