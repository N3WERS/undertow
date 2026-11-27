export interface Track {
  id: string
  provider: 'youtube' | 'yandex' | 'soundcloud'
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
  /** официальный каталожный трек или загрузка с канала исполнителя */
  official?: boolean
  /** результат каталога YouTube Music (а не обычной выдачи YouTube) */
  catalog?: boolean
  /** исходный порядок результата в каталоге YouTube Music */
  catalogRank?: number
  /** обычная загрузка с верифицированного канала */
  verified?: boolean
}

export interface BrowsePage {
  kind: 'artist' | 'album' | 'playlist'
  id: string
  title: string
  subtitle: string
  coverUrl?: string
  tracks: Track[]
  albums?: { id: string; title: string; year?: string; coverUrl?: string }[]
  /** «похожие исполнители» — есть и у Яндекса, и у YouTube Music */
  related?: { id: string; name: string; coverUrl?: string }[]
}

export type ChartScope = 'ru' | 'us' | 'world'

export interface TopChart {
  title: string
  subtitle: string
  scope: ChartScope
  updatedAt: number
  items: Track[]
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
  source?: 'yandex' | 'youtube' | 'local' | 'soundcloud'
  fallback?: boolean
  fallbackTitle?: string
  fallbackMatched?: { title: string; artist: string }
  /** совпадение найдено приблизительно (длительность/название расходятся) */
  fallbackApprox?: boolean
  /** вариант выбран вручную: играет как самостоятельный трек (его можно лайкнуть) */
  variant?: boolean
  /** id видео выбранного варианта */
  variantVideoId?: string
  /** id YouTube-видео, если звук пришёл с YouTube */
  videoId?: string
  hls?: boolean
}

export type UpdateStatus =
  | 'disabled'
  | 'idle'
  | 'checking'
  | 'available'
  | 'downloading'
  | 'downloaded'
  | 'none'
  | 'error'

export interface UpdateState {
  status: UpdateStatus
  currentVersion: string
  version: string | null
  notes: string | null
  progress: number
  error: string | null
}

export interface ProviderState {
  youtube: {
    ready: boolean
    ytdlp: string | null
    python: string | null
    engine: 'bundled' | 'system' | 'python' | null
  }
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

export interface DpiStatus {
  supported: boolean
  available: boolean
  running: boolean
  state: 'off' | 'on' | 'starting' | 'stopping' | 'error' | 'unavailable'
  path: string | null
  bundled: boolean
  mode: 'service' | 'uac'
  error: string | null
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

export interface SavedAlbum {
  id: string
  title: string
  artist: string
  year?: string
  coverUrl?: string
  type?: 'album' | 'single' | 'ep'
  tracks: Track[]
  savedAt: number
}

export interface OfflineEntry {
  track: Track
  /** имя файла внутри папки offline */
  file: string
  mime: string
  bytes: number
  bitrateKbps?: number
  savedAt: number
  source: 'yandex' | 'youtube' | 'soundcloud'
}

export interface OfflineSnapshot {
  items: OfflineEntry[]
  count: number
  bytes: number
}

export interface OfflineProgress {
  id: string
  received: number
  total: number
  /** 0..100 или null, если сервер не отдал размер */
  percent: number | null
  status: 'downloading' | 'done' | 'error'
  error?: string
}

export type DownloadStatus = 'queued' | 'downloading' | 'done' | 'error' | 'canceled'

export interface DownloadItem {
  id: string
  track: Track
  status: DownloadStatus
  received: number
  total: number
  percent: number | null
  bytes?: number
  error?: string
  addedAt: number
  finishedAt?: number
}

export interface DownloadsSnapshot {
  items: DownloadItem[]
  paused: boolean
  active: number
  queued: number
  errors: number
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

export interface PlaylistRef {
  id: string
  title: string
  subtitle?: string
  coverUrl?: string
}

export interface SearchAll {
  tracks: Track[]
  albums: AlbumRef[]
  artists: ArtistRef[]
  playlists: PlaylistRef[]
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

export type PlayerCommand = 'toggle' | 'next' | 'prev'

export interface PlayerReport {
  playing: boolean
  title: string | null
  artist: string | null
  source: 'yandex' | 'youtube' | 'local' | 'soundcloud' | null
  position?: number | null
}

export interface FlowOptions {
  genres?: string[]
  excludeGenres?: string[]
  novelty?: number
  includeSeeds?: string[]
  excludeSeeds?: string[]
  startArtists?: string[]
  sourceTitle?: string
}

export interface FlowRoute {
  seed: string
  via?: string
  library?: boolean
}

export interface FlowStats {
  tracks: number
  seconds: number
  newArtists: number
}

export interface FlowInfo {
  active: boolean
  seeds: { id?: string; name: string; coverUrl?: string; weight?: number }[]
  genres: string[]
  excludeGenres: string[]
  novelty: number
  routes: Record<string, FlowRoute>
  stats: FlowStats
}

export interface UndertowApi {
  home(): Promise<Section[]>
  topChart(scope?: ChartScope, force?: boolean): Promise<TopChart>
  refreshHome(): Promise<Section[]>
  enrichLibrary(): Promise<LibrarySnapshot>
  hideSection(id: string): Promise<string[]>
  hiddenSections(): Promise<string[]>
  clearHiddenSections(): Promise<string[]>
  artistPage(ref: { id?: string; name?: string }): Promise<BrowsePage>
  playlistPage(id: string): Promise<BrowsePage>
  albumPage(ref: { id?: string; title?: string; artist?: string; trackTitle?: string }): Promise<BrowsePage>
  albumsList(): Promise<SavedAlbum[]>
  albumsSave(page: BrowsePage): Promise<SavedAlbum[]>
  albumsRemove(id: string): Promise<SavedAlbum[]>
  offlineList(): Promise<OfflineSnapshot>
  offlineSave(track: Track): Promise<OfflineEntry>
  offlineRemove(id: string): Promise<boolean>
  offlineClear(): Promise<number>
  offlineReveal(): Promise<void>
  downloadsList(): Promise<DownloadsSnapshot>
  downloadsEnqueue(tracks: Track[]): Promise<DownloadsSnapshot>
  downloadsPause(): Promise<DownloadsSnapshot>
  downloadsResume(): Promise<DownloadsSnapshot>
  downloadsRetry(id: string): Promise<DownloadsSnapshot>
  downloadsRemove(id: string): Promise<DownloadsSnapshot>
  downloadsClearFinished(): Promise<DownloadsSnapshot>
  onDownloadsState(cb: (state: DownloadsSnapshot) => void): () => void
  onOfflineProgress(cb: (progress: OfflineProgress) => void): () => void
  queueGet(): Promise<{ tracks: Track[]; index: number; shuffled: boolean; time: number; savedAt: number } | null>
  queueSave(state: { tracks: Track[]; index: number; shuffled: boolean }): Promise<void>
  queueClear(): Promise<void>
  flowStart(options?: FlowOptions): Promise<{
    title: string
    seeds: { id?: string; name: string; coverUrl?: string; weight?: number }[]
    tracks: Track[]
  }>
  flowGenres(): Promise<{
    items: { id: string; name: string; artists: number; weight: number }[]
    genre?: string
  }>
  genreForArtist(name: string, yandexId?: string): Promise<{ id: string; name: string }[]>
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
  flowInfo(): Promise<FlowInfo>
  flowFeedback(action: 'more' | 'less' | 'skipArtist', track: Track): Promise<{ tracks: Track[] }>
  flowNovelty(value: number): Promise<FlowInfo>
  flowSeed(action: 'include' | 'exclude', name: string): Promise<FlowInfo>
  flowPlayed(track: Track): Promise<void>
  flowSeeds(): Promise<{ name: string; weight: number }[]>
  flowTracks(): Promise<Track[]>
  flowDiscoveries(): Promise<{ name: string; coverUrl?: string; at: number }[]>
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
  searchAll(query: string): Promise<SearchAll>
  searchYoutube(query: string, limit?: number): Promise<Track[]>
  soundcloudSearch(query: string, limit?: number, offset?: number): Promise<Track[]>
  searchMore(query: string, offset: number, limit?: number): Promise<Track[]>
  resolve(trackId: string, fresh?: boolean, meta?: Track): Promise<ResolvedStream>
  state(): Promise<ProviderState>
  setYandexToken(token: string): Promise<ProviderState>
  clearYandexToken(): Promise<ProviderState>
  refreshYandex(): Promise<ProviderState>
  dpiStatus(): Promise<DpiStatus>
  dpiSet(on: boolean): Promise<DpiStatus>
  log(message: string, data?: unknown): void
  logPath(): Promise<string>
  openLog(): Promise<string>
  updateState(): Promise<UpdateState>
  updateCheck(): Promise<UpdateState>
  updateDownload(): Promise<UpdateState>
  updateInstall(): Promise<boolean>
  onUpdateState(cb: (state: UpdateState) => void): () => void
  miniState(): Promise<boolean>
  presenceGet(): Promise<{ enabled: boolean; connected: boolean }>
  presenceSet(next: { enabled?: boolean }): Promise<{
    enabled: boolean
    connected: boolean
  }>
  startupGet(): Promise<boolean>
  startupSet(on: boolean): Promise<boolean>
  onLink(cb: (url: string) => void): () => void
  setMini(on: boolean): Promise<boolean>
  toggleMini(): Promise<boolean>
  reportPlayer(state: PlayerReport): void
  closeAction(action: 'tray' | 'quit' | 'cancel'): void
  onCloseRequest(cb: () => void): () => void
  onCloseDismiss(cb: () => void): () => void
  onMiniChange(cb: (on: boolean) => void): () => void
  onPlayerCommand(cb: (command: PlayerCommand) => void): () => void
  onDurations(cb: (count: number) => void): () => void
}

declare global {
  interface Window {
    undertow: UndertowApi
  }
}
