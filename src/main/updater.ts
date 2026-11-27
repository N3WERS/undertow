/**
 * Автообновление desktop-сборки через electron-updater.
 *
 * Проверяем публичный основной репозиторий (N3WERS/undertow),
 * скачивание запускаем только по кнопке, установку — тоже.
 */
import { app, BrowserWindow } from 'electron'
import { createRequire } from 'node:module'
import type { AppUpdater } from 'electron-updater'
import { log } from './log'

// electron-updater — CommonJS. ESM named import падает в packaged-сборке.
const { autoUpdater } = createRequire(import.meta.url)('electron-updater') as {
  autoUpdater: AppUpdater
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

let state: UpdateState = {
  status: app.isPackaged ? 'idle' : 'disabled',
  currentVersion: app.getVersion(),
  version: null,
  notes: null,
  progress: 0,
  error: null
}
let initialized = false
let autoTimer: NodeJS.Timeout | null = null

function cleanNotes(value: unknown): string | null {
  if (!value) return null
  let text = ''
  if (typeof value === 'string') {
    text = value
  } else if (Array.isArray(value)) {
    text = value
      .map((item) =>
        item && typeof item === 'object' && 'note' in item ? String(item.note ?? '') : ''
      )
      .join('\n')
  }
  const clean = text
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return clean ? clean.slice(0, 2000) : null
}

function publish(next: Partial<UpdateState>): UpdateState {
  state = { ...state, ...next }
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('update:state', state)
  }
  return state
}

export function getUpdateState(): UpdateState {
  return state
}

export function initUpdater(): void {
  if (initialized) return
  initialized = true

  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = false
  autoUpdater.allowPrerelease = false

  autoUpdater.on('checking-for-update', () => {
    publish({ status: 'checking', error: null })
  })
  autoUpdater.on('update-available', (info) => {
    log('update available', info.version)
    publish({
      status: 'available',
      version: info.version,
      notes: cleanNotes(info.releaseNotes),
      progress: 0,
      error: null
    })
  })
  autoUpdater.on('update-not-available', () => {
    publish({ status: 'none', version: null, notes: null, progress: 0, error: null })
  })
  autoUpdater.on('download-progress', (progress) => {
    publish({
      status: 'downloading',
      progress: Math.max(0, Math.min(100, Math.round(progress.percent)))
    })
  })
  autoUpdater.on('update-downloaded', (info) => {
    log('update downloaded', info.version)
    publish({ status: 'downloaded', version: info.version, progress: 100, error: null })
  })
  autoUpdater.on('error', (error) => {
    log('update error', error.message)
    publish({
      status: 'error',
      error: error.message || 'Не удалось проверить обновление',
      progress: 0
    })
  })

  if (!app.isPackaged) {
    publish({
      status: 'disabled',
      error: null,
      currentVersion: app.getVersion()
    })
    return
  }

  // Не тормозим запуск и не дёргаем сеть в первую секунду.
  autoTimer = setTimeout(() => {
    autoTimer = null
    void checkForUpdates()
  }, 12_000)
  autoTimer.unref?.()

  const periodic = setInterval(() => {
    if (state.status === 'idle' || state.status === 'none' || state.status === 'error') {
      void checkForUpdates()
    }
  }, 4 * 60 * 60_000)
  periodic.unref?.()
}

export async function checkForUpdates(): Promise<UpdateState> {
  if (!app.isPackaged) return getUpdateState()
  if (state.status === 'checking' || state.status === 'downloading') return getUpdateState()
  publish({ status: 'checking', error: null })
  try {
    await autoUpdater.checkForUpdates()
  } catch (e) {
    publish({
      status: 'error',
      error: e instanceof Error ? e.message : String(e),
      progress: 0
    })
  }
  return getUpdateState()
}

export async function downloadUpdate(): Promise<UpdateState> {
  if (!app.isPackaged) return getUpdateState()
  if (state.status !== 'available' && state.status !== 'error') return getUpdateState()
  publish({ status: 'downloading', progress: 0, error: null })
  try {
    await autoUpdater.downloadUpdate()
  } catch (e) {
    publish({
      status: 'error',
      error: e instanceof Error ? e.message : String(e),
      progress: 0
    })
  }
  return getUpdateState()
}

export function installUpdate(): void {
  if (!app.isPackaged || state.status !== 'downloaded') return
  // false — не тихо, true — запустить приложение после установки
  autoUpdater.quitAndInstall(false, true)
}
