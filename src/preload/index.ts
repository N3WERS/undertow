import { contextBridge, ipcRenderer } from 'electron'

const api = {
  home: () => ipcRenderer.invoke('home'),
  queueGet: () => ipcRenderer.invoke('queue:get'),
  queueSave: (state: unknown) => ipcRenderer.invoke('queue:save', state),
  queueTime: (index: number, time: number) => ipcRenderer.invoke('queue:time', index, time),
  queueClear: () => ipcRenderer.invoke('queue:clear'),
  flowStart: () => ipcRenderer.invoke('flow:start'),
  flowMore: () => ipcRenderer.invoke('flow:more'),
  flowInfo: () => ipcRenderer.invoke('flow:info'),
  flowSeeds: () => ipcRenderer.invoke('flow:seeds'),
  refreshHome: () => ipcRenderer.invoke('home:refresh'),
  enrichLibrary: () => ipcRenderer.invoke('library:enrich'),
  hideSection: (id: string) => ipcRenderer.invoke('rec:hide', id),
  hiddenSections: () => ipcRenderer.invoke('rec:hidden'),
  clearHiddenSections: () => ipcRenderer.invoke('rec:clear-hidden'),
  artistPage: (ref: { id?: string; name?: string }) => ipcRenderer.invoke('page:artist', ref),
  albumPage: (ref: { id?: string; title?: string; artist?: string; trackTitle?: string }) =>
    ipcRenderer.invoke('page:album', ref),
  artistRadio: (ref: { id?: string; name?: string }) => ipcRenderer.invoke('radio:artist', ref),
  radioMore: (ref: { id?: string; name?: string }) => ipcRenderer.invoke('radio:more', ref),
  search: (query: string) => ipcRenderer.invoke('search', query),
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
  prewarm: (track: unknown) => ipcRenderer.invoke('prewarm', track),
  state: () => ipcRenderer.invoke('state'),
  setYandexToken: (token: string) => ipcRenderer.invoke('yandex:set', token),
  clearYandexToken: () => ipcRenderer.invoke('yandex:clear'),
  refreshYandex: () => ipcRenderer.invoke('yandex:refresh')
}

contextBridge.exposeInMainWorld('undertow', api)

export type UndertowApi = typeof api
