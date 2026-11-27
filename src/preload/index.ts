import { contextBridge, ipcRenderer } from 'electron'

const api = {
  home: () => ipcRenderer.invoke('home'),
  topChart: (scope: 'ru' | 'us' | 'world' = 'ru', force = false) =>
    ipcRenderer.invoke('chart:top', scope, force),
  albumsList: () => ipcRenderer.invoke('albums:list'),
  albumsSave: (page: unknown) => ipcRenderer.invoke('albums:save', page),
  albumsRemove: (id: string) => ipcRenderer.invoke('albums:remove', id),
  offlineList: () => ipcRenderer.invoke('offline:list'),
  offlineSave: (track: unknown) => ipcRenderer.invoke('offline:save', track),
  offlineRemove: (id: string) => ipcRenderer.invoke('offline:remove', id),
  offlineClear: () => ipcRenderer.invoke('offline:clear'),
  offlineReveal: () => ipcRenderer.invoke('offline:reveal'),
  queueGet: () => ipcRenderer.invoke('queue:get'),
  queueSave: (state: unknown) => ipcRenderer.invoke('queue:save', state),
  queueClear: () => ipcRenderer.invoke('queue:clear'),
  flowStart: (options?: unknown) => ipcRenderer.invoke('flow:start', options),
  flowGenres: () => ipcRenderer.invoke('flow:genres'),
  flowFeedback: (action: string, track: unknown) =>
    ipcRenderer.invoke('flow:feedback', action, track),
  flowNovelty: (value: number) => ipcRenderer.invoke('flow:novelty', value),
  flowSeed: (action: 'include' | 'exclude', name: string) =>
    ipcRenderer.invoke('flow:seed', action, name),
  flowPlayed: (track: unknown) => ipcRenderer.invoke('flow:played', track),
  genreForArtist: (name: string, yandexId?: string) =>
    ipcRenderer.invoke('genres:artist', name, yandexId),
  lyrics: (track: unknown) => ipcRenderer.invoke('lyrics:get', track),
  lyricsHas: (track: unknown) => ipcRenderer.invoke('lyrics:has', track),
  playlists: () => ipcRenderer.invoke('playlists:list'),
  playlist: (id: string) => ipcRenderer.invoke('playlists:get', id),
  playlistCreate: (title: string) => ipcRenderer.invoke('playlists:create', title),
  playlistRename: (id: string, title: string) => ipcRenderer.invoke('playlists:rename', id, title),
  playlistRemove: (id: string) => ipcRenderer.invoke('playlists:remove', id),
  playlistAdd: (id: string, tracks: unknown[]) => ipcRenderer.invoke('playlists:add', id, tracks),
  playlistRemoveTrack: (id: string, trackId: string) =>
    ipcRenderer.invoke('playlists:remove-track', id, trackId),
  playlistReorder: (id: string, from: number, to: number) =>
    ipcRenderer.invoke('playlists:reorder', id, from, to),
  playlistsImport: () => ipcRenderer.invoke('playlists:import'),
  playlistsExport: () => ipcRenderer.invoke('playlists:export'),
  flowMore: () => ipcRenderer.invoke('flow:more'),
  flowInfo: () => ipcRenderer.invoke('flow:info'),
  flowSeeds: () => ipcRenderer.invoke('flow:seeds'),
  refreshHome: () => ipcRenderer.invoke('home:refresh'),
  enrichLibrary: () => ipcRenderer.invoke('library:enrich'),
  hideSection: (id: string) => ipcRenderer.invoke('rec:hide', id),
  hiddenSections: () => ipcRenderer.invoke('rec:hidden'),
  clearHiddenSections: () => ipcRenderer.invoke('rec:clear-hidden'),
  artistPage: (ref: { id?: string; name?: string }) => ipcRenderer.invoke('page:artist', ref),
  playlistPage: (id: string) => ipcRenderer.invoke('page:playlist', id),
  albumPage: (ref: { id?: string; title?: string; artist?: string; trackTitle?: string }) =>
    ipcRenderer.invoke('page:album', ref),
  artistRadio: (ref: { id?: string; name?: string }) => ipcRenderer.invoke('radio:artist', ref),
  radioMore: (ref: { id?: string; name?: string }) => ipcRenderer.invoke('radio:more', ref),
  radioTrack: (track: unknown) => ipcRenderer.invoke('radio:track', track),
  searchAll: (query: string) => ipcRenderer.invoke('search:all', query),
  searchYoutube: (query: string, limit = 20) =>
    ipcRenderer.invoke('search:youtube', query, limit),
  soundcloudSearch: (query: string, limit = 20, offset = 0) =>
    ipcRenderer.invoke('search:soundcloud', query, limit, offset),
  searchMore: (query: string, offset: number, limit = 20) =>
    ipcRenderer.invoke('search:more', query, offset, limit),
  resolve: (trackId: string, fresh = false, meta?: unknown) => ipcRenderer.invoke('resolve', trackId, fresh, meta),
  debugFileInfo: (trackId: string) => ipcRenderer.invoke('debug:fileinfo', trackId),
  debugYm: (method: string, path: string, body?: string) => ipcRenderer.invoke('debug:ym', method, path, body),
  library: () => ipcRenderer.invoke('library'),
  like: (track: unknown, liked: boolean) => ipcRenderer.invoke('like', track, liked),
  addHistory: (track: unknown) => ipcRenderer.invoke('history:add', track),
  clearHistory: () => ipcRenderer.invoke('history:clear'),
  importYandexLikes: () => ipcRenderer.invoke('likes:import'),
  fallbackList: (track: unknown) => ipcRenderer.invoke('fallback:list', track),
  fallbackPick: (track: unknown, candidate: unknown) => ipcRenderer.invoke('fallback:pick', track, candidate),
  fallbackUnpin: (track: unknown) => ipcRenderer.invoke('fallback:unpin', track),
  versions: (track: unknown) => ipcRenderer.invoke('versions:list', track),
  releases: (force?: boolean) => ipcRenderer.invoke('releases:list', force),
  prewarm: (track: unknown) => ipcRenderer.invoke('prewarm', track),
  state: () => ipcRenderer.invoke('state'),
  setYandexToken: (token: string) => ipcRenderer.invoke('yandex:set', token),
  clearYandexToken: () => ipcRenderer.invoke('yandex:clear'),
  refreshYandex: () => ipcRenderer.invoke('yandex:refresh'),
  dpiStatus: () => ipcRenderer.invoke('dpi:status'),
  dpiSet: (on: boolean) => ipcRenderer.invoke('dpi:set', on),
  log: (message: string, data?: unknown) => ipcRenderer.send('log', message, data),
  logPath: () => ipcRenderer.invoke('log:path'),
  openLog: () => ipcRenderer.invoke('log:open'),
  updateState: () => ipcRenderer.invoke('update:state'),
  updateCheck: () => ipcRenderer.invoke('update:check'),
  updateDownload: () => ipcRenderer.invoke('update:download'),
  updateInstall: () => ipcRenderer.invoke('update:install'),
  onUpdateState: (cb: (state: unknown) => void) => {
    const handler = (_e: unknown, state: unknown) => cb(state)
    ipcRenderer.on('update:state', handler)
    return () => ipcRenderer.removeListener('update:state', handler)
  },
  miniState: () => ipcRenderer.invoke('window:mini-state'),
  setMini: (on: boolean) => ipcRenderer.invoke('window:mini', on),
  toggleMini: () => ipcRenderer.invoke('window:mini-toggle'),
  reportPlayer: (state: unknown) => ipcRenderer.send('player:state', state),
  closeAction: (action: 'tray' | 'quit' | 'cancel') =>
    ipcRenderer.send('window:close-action', action),
  onCloseRequest: (cb: () => void) => {
    const handler = () => cb()
    ipcRenderer.on('window:close-request', handler)
    return () => ipcRenderer.removeListener('window:close-request', handler)
  },
  onCloseDismiss: (cb: () => void) => {
    const handler = () => cb()
    ipcRenderer.on('window:close-dismiss', handler)
    return () => ipcRenderer.removeListener('window:close-dismiss', handler)
  },
  onMiniChange: (cb: (on: boolean) => void) => {
    const handler = (_e: unknown, on: boolean) => cb(on)
    ipcRenderer.on('window:mini-changed', handler)
    return () => ipcRenderer.removeListener('window:mini-changed', handler)
  },
  onPlayerCommand: (cb: (command: 'toggle' | 'next' | 'prev') => void) => {
    const handler = (_e: unknown, command: 'toggle' | 'next' | 'prev') => cb(command)
    ipcRenderer.on('player:command', handler)
    return () => ipcRenderer.removeListener('player:command', handler)
  },
  /** прогресс скачивания локальной копии */
  onOfflineProgress: (cb: (progress: unknown) => void) => {
    const handler = (_e: unknown, progress: unknown) => cb(progress)
    ipcRenderer.on('offline:progress', handler)
    return () => ipcRenderer.removeListener('offline:progress', handler)
  },
  /** main дозаполнил длительности старых треков — пора перечитать списки */
  onDurations: (cb: (count: number) => void) => {
    const handler = (_e: unknown, count: number) => cb(count)
    ipcRenderer.on('library:durations', handler)
    return () => ipcRenderer.removeListener('library:durations', handler)
  }
}

contextBridge.exposeInMainWorld('undertow', api)

export type UndertowApi = typeof api
