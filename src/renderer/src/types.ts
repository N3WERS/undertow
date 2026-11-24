export interface Track {
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
  durationSec: number | null
  coverUrl?: string
  kind: 'song' | 'video' | 'album' | 'playlist' | 'artist'
  subtitle?: string
  playable: boolean
}

export interface BrowsePage {
  kind: 'artist' | 'album'
  id: string
  title: string
  subtitle: string
  coverUrl?: string
  tracks: Track[]
  albums?: { id: string; title: string; year?: string; coverUrl?: string }[]
  /** «похожие исполнители» — есть и у Яндекса, и у YouTube Music */
  related?: { id: string; name: string; coverUrl?: string }[]
}

export interface Section {
  id: string
  title: string
  layout: 'list' | 'grid'
  items: Track[]
  subtitle?: string
  coverUrl?: string
  albums?: { id: string; title: string; year?: string; coverUrl?: string }[]
}

export interface ResolvedStream {
  url: string
  mime: string
  bitrateKbps?: number
  ttlMs: number
  fallback?: boolean
  fallbackTitle?: string
  fallbackMatched?: { title: string; artist: string }
  /** совпадение найдено приблизительно (длительность/название расходятся) */
  fallbackApprox?: boolean
  /** вариант выбран вручную: играет как самостоятельный трек (его можно лайкнуть) */
  variant?: boolean
  /** id видео выбранного варианта */
  variantVideoId?: string
}

export interface ProviderState {
  youtube: { ready: boolean; ytdlp: string | null; python: string | null }
  yandex: {
    hasToken: boolean
    valid: boolean
    login: string | null
    hasPlus: boolean
    active: boolean
    lossless: 'unknown' | 'available' | 'unavailable'
    uid: number | null
    error: string | null
  }
  primary: 'yandex' | 'youtube'
}

export interface LibrarySnapshot {
  likes: Track[]
  history: Track[]
  stats: { likes: number; history: number; updatedAt: number | null }
}

export interface LikeResult {
  liked: boolean
  syncError: string | null
}

export interface FallbackCandidate {
  videoId: string
  title: string
  channel: string
  durationSec: number | null
  delta: number
  official: boolean
  badVersion: boolean
}

export interface TrackVersion {
  track: Track
  videoId: string
  title: string
  channel: string
  durationSec: number | null
  coverUrl?: string
  label: string
}

export interface ImportResult {
  imported: number
  total: number
  localTotal: number
}

export interface UndertowApi {
  home(): Promise<Section[]>
  refreshHome(): Promise<Section[]>
  enrichLibrary(): Promise<LibrarySnapshot>
  hideSection(id: string): Promise<string[]>
  hiddenSections(): Promise<string[]>
  clearHiddenSections(): Promise<string[]>
  artistPage(ref: { id?: string; name?: string }): Promise<BrowsePage>
  albumPage(ref: { id?: string; title?: string; artist?: string; trackTitle?: string }): Promise<BrowsePage>
  queueGet(): Promise<{ tracks: Track[]; index: number; shuffled: boolean; time: number; savedAt: number } | null>
  queueSave(state: { tracks: Track[]; index: number; shuffled: boolean; time?: number }): Promise<void>
  queueTime(index: number, time: number): Promise<void>
  queueClear(): Promise<void>
  flowStart(): Promise<{ title: string; seeds: { id?: string; name: string; coverUrl?: string }[]; tracks: Track[] }>
  flowMore(): Promise<Track[]>
  flowInfo(): Promise<{ active: boolean; seeds: { id?: string; name: string; coverUrl?: string }[] }>
  flowSeeds(): Promise<{ name: string; weight: number }[]>
  artistRadio(ref: { id?: string; name?: string }): Promise<{ title: string; tracks: Track[] }>
  radioMore(ref: { id?: string; name?: string }): Promise<Track[]>
  library(): Promise<LibrarySnapshot>
  like(track: Track, liked: boolean): Promise<LikeResult>
  addHistory(track: Track): Promise<void>
  clearHistory(): Promise<void>
  importYandexLikes(): Promise<ImportResult>
  versions(track: Track): Promise<TrackVersion[]>
  fallbackList(track: Track): Promise<{ pinned: boolean; items: FallbackCandidate[] }>
  fallbackUnpin(track: Track): Promise<void>
  fallbackPick(track: Track, candidate: FallbackCandidate): Promise<void>
  prewarm(track: Track): Promise<void>
  search(query: string): Promise<Track[]>
  resolve(trackId: string, fresh?: boolean, meta?: Track): Promise<ResolvedStream>
  state(): Promise<ProviderState>
  setYandexToken(token: string): Promise<ProviderState>
  clearYandexToken(): Promise<ProviderState>
  refreshYandex(): Promise<ProviderState>
}

declare global {
  interface Window {
    undertow: UndertowApi
  }
}
