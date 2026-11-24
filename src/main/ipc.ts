import { ipcMain } from 'electron'
import { proxify } from './audioProxy'
import * as providers from './providers'
import type { Track } from './providers/types'
import * as queueStore from './queueStore'
import * as versions from './versions'
import * as releases from './releases'

export function registerIpc(): void {
  ipcMain.handle('home', async () => providers.home())
  // пересобрать личные подборки, минуя кэш
  ipcMain.handle('home:refresh', async () => providers.home(true))
  ipcMain.handle('search', async (_e, query: string) => providers.search(String(query ?? '')))
  ipcMain.handle('resolve', async (_e, id: string, fresh: boolean, meta?: Track) => {
    const stream = await providers.resolveStream(String(id), Boolean(fresh), meta)
    // через локальный прокси: он добавляет CORS, без которого Web Audio молчит
    return { ...stream, url: proxify(stream.url, stream.mime) }
  })

  ipcMain.handle('queue:get', async () => queueStore.load())
  ipcMain.handle(
    'queue:save',
    async (_e, state: { tracks: Track[]; index: number; shuffled: boolean; time?: number }) => {
      queueStore.save(state ?? { tracks: [], index: 0, shuffled: false })
    }
  )
  ipcMain.handle('queue:time', async (_e, index: number, time: number) => {
    queueStore.touch(Number(index) || 0, Number(time) || 0)
  })
  ipcMain.handle('queue:clear', async () => queueStore.clear())

  ipcMain.handle('flow:start', async () => providers.flowStart())
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
