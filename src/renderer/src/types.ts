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
  /** откуда реально пришёл звук (может отличаться от provider трека) */
  source?: 'yandex' | 'youtube'
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

export interface AlbumRef {
  id: string
  title: string
  year?: string
  coverUrl?: string
  type?: 'single' | 'ep' | 'album'
}

export interface ArtistRef {
  id: string
  name: string
  coverUrl?: string
}

export interface SearchAll {
  tracks: Track[]
  albums: AlbumRef[]
  artists: ArtistRef[]
}

export interface LyricLine {
  t: number
  text: string
}

export interface Lyrics {
  synced: boolean
  lines: LyricLine[]
  instrumental: boolean
  source: string
}

export interface PlaylistSummary {
  id: string
  title: string
  count: number
  coverUrl?: string
  updatedAt: number
}

export interface Playlist extends PlaylistSummary {
  tracks: Track[]
  createdAt: number
}

export interface ReleaseItem {
  id: string
  title: string
  artist: string
  artistId?: string
  /** id альбома YouTube Music (MPREb…) */
  albumId?: string
  date?: string
  year?: string
  type: 'single' | 'ep' | 'album'
  coverUrl?: string
  trackCount?: number
  plays?: number
  playsSource?: string
  dateSource?: string
  source: 'itunes' | 'youtube'
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
  queueSave(state: { tracks: Track[]; index: number; shuffled: boolean }): Promise<void>
  queueClear(): Promise<void>
  flowStart(genre?: string): Promise<{
    title: string
    seeds: { id?: string; name: string; coverUrl?: string }[]
    tracks: Track[]
  }>
  flowGenres(): Promise<{
    items: { id: string; name: string; artists: number; weight: number }[]
    genre?: string
  }>
  lyrics(track: Track): Promise<Lyrics | null>
  lyricsHas(track: Track): Promise<boolean>
  playlists(): Promise<PlaylistSummary[]>
  playlist(id: string): Promise<Playlist | null>
  playlistCreate(title: string): Promise<Playlist>
  playlistRename(id: string, title: string): Promise<Playlist | null>
  playlistRemove(id: string): Promise<boolean>
  playlistAdd(id: string, tracks: Track[]): Promise<number>
  playlistRemoveTrack(id: string, trackId: string): Promise<Playlist | null>
  playlistReorder(id: string, from: number, to: number): Promise<Playlist | null>
  playlistsImport(): Promise<{ created: number; skipped: number; titles: string[] }>
  playlistsExport(): Promise<string | null>
  flowMore(): Promise<Track[]>
  flowInfo(): Promise<{
    active: boolean
    seeds: { id?: string; name: string; coverUrl?: string }[]
    genre?: string
  }>
  flowSeeds(): Promise<{ name: string; weight: number }[]>
  artistRadio(ref: { id?: string; name?: string }): Promise<{ title: string; tracks: Track[] }>
  radioMore(ref: { id?: string; name?: string }): Promise<Track[]>
  radioTrack(track: Track): Promise<{ title: string; tracks: Track[] }>
  library(): Promise<LibrarySnapshot>
  like(track: Track, liked: boolean): Promise<LikeResult>
  addHistory(track: Track): Promise<void>
  clearHistory(): Promise<void>
  importYandexLikes(): Promise<ImportResult>
  versions(track: Track): Promise<TrackVersion[]>
  releases(force?: boolean): Promise<{ items: ReleaseItem[]; updatedAt: number; artists: number }>
  fallbackList(track: Track): Promise<{ pinned: boolean; items: FallbackCandidate[] }>
  fallbackUnpin(track: Track): Promise<void>
  fallbackPick(track: Track, candidate: FallbackCandidate): Promise<void>
  prewarm(track: Track): Promise<void>
  search(query: string): Promise<Track[]>
  searchAll(query: string): Promise<SearchAll>
  resolve(trackId: string, fresh?: boolean, meta?: Track): Promise<ResolvedStream>
  state(): Promise<ProviderState>
  setYandexToken(token: string): Promise<ProviderState>
  clearYandexToken(): Promise<ProviderState>
  refreshYandex(): Promise<ProviderState>
  onDurations(cb: (count: number) => void): () => void
}

declare global {
  interface Window {
    undertow: UndertowApi
  }
}
