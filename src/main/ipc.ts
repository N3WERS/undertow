import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { proxify } from './audioProxy'
import * as providers from './providers'
import type { BrowsePage, Track } from './providers/types'
import * as queueStore from './queueStore'
import * as versions from './versions'
import * as releases from './releases'
import * as offline from './offline'
import * as savedAlbums from './savedAlbums'
import * as genres from './genres'

export function registerIpc(): void {
  ipcMain.handle('home', async () => providers.home())
  // пересобрать личные подборки, минуя кэш
  ipcMain.handle('home:refresh', async () => providers.home(true))
  ipcMain.handle('search', async (_e, query: string) => providers.search(String(query ?? '')))
  ipcMain.handle('search:all', async (_e, query: string) => providers.searchAll(String(query ?? '')))
  ipcMain.handle('resolve', async (_e, id: string, fresh: boolean, meta?: Track) => {
    const stream = await providers.resolveStream(String(id), Boolean(fresh), meta)
    // локальная копия уже отдаётся прокси (endpoint /f) — второй раз не оборачиваем
    if (stream.source === 'local') return stream
    // через локальный прокси: он добавляет CORS, без которого Web Audio молчит
    return { ...stream, url: proxify(stream.url, stream.mime) }
  })

  // локальные копии: скачивание идёт в main, чтобы не зависеть от сети рендерера
  ipcMain.handle('offline:list', async () => offline.list())
  ipcMain.handle('offline:save', async (e, track: Track) => {
    const existing = await offline.entryFor(track.id)
    if (existing) return existing
    const stream = await providers.resolveStream(track.id, false, track)
    if (stream.source === 'local') {
      const local = await offline.entryFor(track.id)
      if (local) return local
    }
    const win = BrowserWindow.fromWebContents(e.sender)
    return offline.save(track, stream, (progress) => {
      if (win && !win.isDestroyed()) win.webContents.send('offline:progress', progress)
    })
  })
  ipcMain.handle('offline:remove', async (_e, id: string) => offline.remove(String(id)))
  ipcMain.handle('offline:clear', async () => offline.clearAll())
  ipcMain.handle('offline:reveal', async () => {
    await shell.openPath(offline.localRoot())
  })

  ipcMain.handle('albums:list', async () => savedAlbums.list())
  ipcMain.handle('albums:save', async (_e, page: BrowsePage) => savedAlbums.save(page))
  ipcMain.handle('albums:remove', async (_e, id: string) => savedAlbums.remove(String(id)))

  ipcMain.handle('queue:get', async () => queueStore.load())
  ipcMain.handle(
    'queue:save',
    async (_e, state: { tracks: Track[]; index: number; shuffled: boolean }) => {
      queueStore.save(state ?? { tracks: [], index: 0, shuffled: false })
    }
  )
  ipcMain.handle('queue:clear', async () => queueStore.clear())

  ipcMain.handle('flow:start', async (_e, genre?: string) => providers.flowStart(genre))
  ipcMain.handle('flow:genres', async () => providers.flowGenres())
  ipcMain.handle('genres:artist', async (_e, name: string, yandexId?: string) =>
    genres.forArtist(String(name ?? ''), yandexId ? String(yandexId) : undefined)
  )

  ipcMain.handle('lyrics:get', async (_e, track: Track) => providers.lyricsOf(track))
  ipcMain.handle('lyrics:has', async (_e, track: Track) => providers.lyricsHas(track))

  ipcMain.handle('playlists:list', async () => providers.playlistList())
  ipcMain.handle('playlists:get', async (_e, id: string) => providers.playlistGet(id))
  ipcMain.handle('playlists:create', async (_e, title: string) => providers.playlistCreate(title))
  ipcMain.handle('playlists:rename', async (_e, id: string, title: string) =>
    providers.playlistRename(id, title)
  )
  ipcMain.handle('playlists:remove', async (_e, id: string) => providers.playlistRemove(id))
  ipcMain.handle('playlists:add', async (_e, id: string, tracks: Track[]) =>
    providers.playlistAdd(id, tracks)
  )
  ipcMain.handle('playlists:remove-track', async (_e, id: string, trackId: string) =>
    providers.playlistRemoveTrack(id, trackId)
  )
  ipcMain.handle('playlists:reorder', async (_e, id: string, from: number, to: number) =>
    providers.playlistReorder(id, from, to)
  )
  ipcMain.handle('playlists:import', async () => providers.importYandexPlaylists())
  ipcMain.handle('playlists:export', async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    const stamp = new Date().toISOString().slice(0, 10)
    const res = await dialog.showSaveDialog(win ?? undefined!, {
      title: 'Экспорт плейлистов',
      defaultPath: path.join(app.getPath('documents'), `undertow-playlists-${stamp}.json`),
      filters: [{ name: 'JSON', extensions: ['json'] }]
    })
    if (res.canceled || !res.filePath) return null
    fs.writeFileSync(res.filePath, providers.playlistExport(), 'utf8')
    return res.filePath
  })
  ipcMain.handle('flow:more', async () => providers.flowMore())
  ipcMain.handle('flow:info', async () => providers.flowInfo())
  ipcMain.handle('flow:seeds', async () => providers.flowSeeds())

  ipcMain.handle('state', async () => providers.getState())
  ipcMain.handle('library:enrich', async () => providers.enrichLibrary())

  ipcMain.handle('rec:hide', async (_e, id: string) => providers.hideSection(String(id)))
  ipcMain.handle('rec:hidden', async () => providers.hiddenSections())
  ipcMain.handle('rec:clear-hidden', async () => providers.clearHiddenSections())

  ipcMain.handle('page:artist', async (_e, ref: { id?: string; name?: string }) => providers.artistPage(ref ?? {}))
  ipcMain.handle(
    'page:album',
    async (_e, ref: { id?: string; title?: string; artist?: string; trackTitle?: string }) =>
      providers.albumPage(ref ?? {})
  )
  ipcMain.handle('radio:artist', async (_e, ref: { id?: string; name?: string }) => providers.artistRadio(ref ?? {}))
  ipcMain.handle('radio:more', async (_e, ref: { id?: string; name?: string }) => providers.radioMore(ref ?? {}))
  ipcMain.handle('radio:track', async (_e, track: Track) => providers.trackSimilar(track))

  // библиотека: лайки и история живут в main-процессе, UI получает готовые списки
  ipcMain.handle('library', async () => providers.getLibrary())
  ipcMain.handle('like', async (_e, track: Track, liked: boolean) => providers.likeTrack(track, Boolean(liked)))
  ipcMain.handle('history:add', async (_e, track: Track) => providers.addHistory(track))
  ipcMain.handle('history:clear', async () => providers.clearHistory())
  ipcMain.handle('likes:import', async () => providers.importYandexLikes())

  // подмена треков на YouTube: варианты, ручной выбор и прогрев по наведению
  ipcMain.handle('fallback:list', async (_e, track: Track) => ({
    // закреплён ли за треком выбранный вариант — от этого зависит «вернуть оригинал»
    pinned: providers.isPinned(track.id),
    items: await providers.fallbackCandidates(track)
  }))
  ipcMain.handle('fallback:pick', async (_e, track: Track, candidate: unknown) =>
    providers.pickFallback(track, candidate as never)
  )
  ipcMain.handle('fallback:unpin', async (_e, track: Track) => providers.restoreOriginal(track))
  ipcMain.handle('releases:list', async (_e, force?: boolean) => releases.list(Boolean(force)))
  ipcMain.handle('versions:list', async (_e, track: Track) => versions.listVersions(track))
  ipcMain.handle('prewarm', async (_e, track: Track) => providers.prewarm(track))
  ipcMain.handle('yandex:set', async (_e, token: string) => providers.saveYandexToken(String(token ?? '')))
  ipcMain.handle('yandex:clear', async () => providers.clearYandexToken())
  ipcMain.handle('yandex:refresh', async () => {
    await providers.refreshYandex()
    return providers.getState()
  })

  // Диагностика только в dev: показывает, что именно отдаёт сервер про lossless
  ipcMain.handle('debug:fileinfo', async (_e, id: string) => providers.debugFileInfo(String(id)))

  // Временный пробник API: позволяет проверять эндпоинты, не вынимая токен наружу
  ipcMain.handle('debug:ym', async (_e, method: string, path: string, body?: string) => {
    const { getYandexToken } = await import('./store')
    const token = getYandexToken()
    if (!token) return { status: 0, body: 'нет токена' }
    const res = await fetch(`https://api.music.yandex.net${path}`, {
      method: String(method || 'GET'),
      body: body ?? undefined,
      headers: {
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        Authorization: `OAuth ${token}`,
        'X-Yandex-Music-Client': 'YandexMusicDesktopAppWindows/5.13.2',
        Accept: 'application/json'
      }
    })
    const text = await res.text()
    let json: unknown = null
    try {
      json = JSON.parse(text)
    } catch {
      // не JSON — вернём текст
    }
    return { status: res.status, len: text.length, json, body: text.slice(0, 400) }
  })
}
