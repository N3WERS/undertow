import type { Track } from '../types'

interface Props {
  track: Pick<Track, 'artist' | 'artistId' | 'artists'>
  /** клик по конкретному исполнителю; без обработчика список остаётся текстом */
  onOpenArtist?: (target: { id?: string; name: string }) => void
  className?: string
}

/**
 * Исполнители трека: каждый со своей ссылкой. У старых записей библиотеки
 * списка исполнителей нет — тогда показываем одну строку как раньше.
 */
export default function ArtistLine({ track, onOpenArtist, className }: Props) {
  const list: { id?: string; name: string }[] = track.artists?.length
    ? track.artists
    : [{ id: track.artistId, name: track.artist }]

  return (
    <span className={`artist-line${className ? ` ${className}` : ''}`}>
      {list.map((a, i) => (
        <span key={`${a.id ?? 'x'}-${a.name}-${i}`} className="artist-part">
          {i > 0 ? ', ' : null}
          {onOpenArtist ? (
            <button
              className="artist-link"
              title={`Открыть страницу: ${a.name}`}
              onClick={(e) => {
                e.stopPropagation()
                onOpenArtist({ id: a.id, name: a.name })
              }}
            >
              {a.name}
            </button>
          ) : (
            <span>{a.name}</span>
          )}
        </span>
      ))}
    </span>
  )
}
