/** Общие типы для main-процесса. UI получает их же через preload. */

export interface Track {
  /** `yt:<videoId>` — пока единственный провайдер */
  id: string
  provider: 'youtube' | 'yandex'
  title: string
  artist: string
  /** id исполнителя в провайдере (если известен) — чтобы открыть его страницу */
  artistId?: string
  /** все исполнители трека: у каждого свой id, чтобы клик вёл на нужного */
  artists?: { id?: string; name: string }[]
  album?: string
  /** год выпуска, если провайдер его отдал: «2019» */
  year?: string
  /** id альбома в провайдере — чтобы открыть его страницу из трека */
  albumId?: string
  /** null у прямых эфиров и трансляций */
  durationSec: number | null
  coverUrl?: string
  /** song | video | album | playlist | artist */
  kind: 'song' | 'video' | 'album' | 'playlist' | 'artist'
  /** строка-подпись из ответа YouTube Music, если есть */
  subtitle?: string
  playable: boolean
}

/** Страница артиста или альбома (пока только Яндекс). */
export interface BrowsePage {
  kind: 'artist' | 'album' | 'playlist'
  id: string
  title: string
  subtitle: string
  coverUrl?: string
  tracks: Track[]
  /** только для артиста: его альбомы, чтобы можно было уйти дальше */
  albums?: { id: string; title: string; year?: string; coverUrl?: string }[]
  /** «похожие исполнители»: есть и у Яндекса, и у YouTube Music */
  related?: { id: string; name: string; coverUrl?: string }[]
}

export interface Section {
  id: string
  title: string
  layout: 'list' | 'grid'
  items: Track[]
  /** подпись под заголовком («14 альбомов · 100 треков») */
  subtitle?: string
  /** аватар для секций-артистов */
  coverUrl?: string
  /** альбомы артиста для полоски-ярлыков под шапкой секции */
  albums?: { id: string; title: string; year?: string; coverUrl?: string }[]
}

export interface ResolvedStream {
  url: string
  mime: string
  bitrateKbps?: number
  /** сколько миллисекунд можно переиспользовать ссылку */
  ttlMs: number
  /** true — играем не из исходного сервиса, а найденную копию на YouTube */
  fallback?: boolean
  /** подпись найденной копии («Artist — Title»), чтобы показать её в интерфейсе */
  fallbackTitle?: string
  /** название и канал выбранной копии — показываем их в плеере вместо оригинала */
  fallbackMatched?: { title: string; artist: string }
  /** вариант выбран вручную: играет как самостоятельный трек (его можно лайкнуть) */
  variant?: boolean
  /** откуда реально пришёл звук (может отличаться от provider трека) */
  source?: 'yandex' | 'youtube' | 'local'
  /** id видео выбранного варианта */
  variantVideoId?: string
  /** id YouTube-видео, если звук пришёл с YouTube (для локального сохранения) */
  videoId?: string
  /** ссылка получена быстрым InnerTube-путём: первые 1 МиБ, дальше fallback */
  fast?: boolean
  /** найдена не точная копия, а близкий вариант */
  fallbackApprox?: boolean
}

export interface Capabilities {
  python: string | null
  ytdlp: string | null
  ffmpeg: boolean
}
