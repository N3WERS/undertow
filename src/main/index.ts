import { app, BrowserWindow, globalShortcut, ipcMain, Menu, nativeImage, screen, shell, Tray } from 'electron'
import type { Rectangle } from 'electron'
import { join } from 'node:path'
import { startAudioProxy, setLocalRoot } from './audioProxy'
import { registerIpc } from './ipc'
import { initUpdater } from './updater'
import * as presence from './presence'
import { warmFastClient } from './fastStream'
import * as offline from './offline'
import * as providers from './providers'
import { log, logPath } from './log'

const BG = '#070a0e'
const MINI_BG = '#0b0d12'
const MINI_W = 460
const MINI_H = 300

type PlayerCommand = 'toggle' | 'next' | 'prev'

interface PlayerReport {
  playing: boolean
  title: string | null
  artist: string | null
  source: 'yandex' | 'youtube' | 'local' | 'soundcloud' | null
  position?: number | null
}

let win: BrowserWindow | null = null
let tray: Tray | null = null
let isQuitting = false
let isMini = false
let normalBounds: Rectangle | null = null
let wasMaximized = false
let player: PlayerReport = { playing: false, title: null, artist: null, source: null }
let closePrompt = false
let pendingLink: string | null = protocolFrom(process.argv)
const startHidden = process.argv.includes('--hidden')

function protocolFrom(argv: string[]): string | null {
  return argv.find((arg) => /^undertow:\/\//i.test(arg)) ?? null
}

function thumbarDir(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'thumbar')
    : join(import.meta.dirname, '../../resources/thumbar')
}

function thumbarIcon(name: string) {
  const image = nativeImage.createFromPath(join(thumbarDir(), `${name}.png`))
  return image.isEmpty() ? nativeImage.createEmpty() : image.resize({ width: 16, height: 16 })
}

/** Кнопки плеера на панели задач Windows. */
function refreshThumbar(): void {
  if (!win || win.isDestroyed() || process.platform !== 'win32') return
  try {
    win.setThumbarButtons([
      { tooltip: 'Предыдущий трек', icon: thumbarIcon('prev'), click: () => sendCommand('prev') },
      {
        tooltip: player.playing ? 'Пауза' : 'Играть',
        icon: thumbarIcon(player.playing ? 'pause' : 'play'),
        click: () => sendCommand('toggle')
      },
      { tooltip: 'Следующий трек', icon: thumbarIcon('next'), click: () => sendCommand('next') }
    ])
  } catch {
    /* панель задач недоступна — не ломаем запуск */
  }
}

function openProtocol(raw: string): void {
  if (!win || win.isDestroyed()) {
    pendingLink = raw
    return
  }
  showWindow()
  win.webContents.send('app:link', raw)
}

function setupProtocol(): void {
  // В dev не трогаем системный реестр: ссылки проверяются через argv.
  if (app.isPackaged) app.setAsDefaultProtocolClient('undertow')
}

function setupJumpList(): void {
  if (process.platform !== 'win32' || !app.isPackaged) return
  try {
    app.setJumpList([
      {
        type: 'tasks',
        items: [
          {
            type: 'task',
            title: 'Течение',
            description: 'Запустить бесконечный поток',
            program: process.execPath,
            args: 'undertow://flow',
            iconPath: join(process.resourcesPath, 'icon.ico'),
            iconIndex: 0
          },
          {
            type: 'task',
            title: 'Поиск',
            description: 'Найти музыку',
            program: process.execPath,
            args: 'undertow://search',
            iconPath: join(process.resourcesPath, 'icon.ico'),
            iconIndex: 0
          },
          {
            type: 'task',
            title: 'Мини-плеер',
            description: 'Открыть компактный вид',
            program: process.execPath,
            args: 'undertow://mini',
            iconPath: join(process.resourcesPath, 'icon.ico'),
            iconIndex: 0
          }
        ]
      }
    ])
  } catch {
    /* jump list не критичен */
  }
}

function setupMediaKeys(): void {
  const bind = (accelerator: string, command: PlayerCommand) => {
    try {
      globalShortcut.register(accelerator, () => sendCommand(command))
    } catch {
      /* клавиша занята другим приложением */
    }
  }
  bind('MediaPlayPause', 'toggle')
  bind('MediaNextTrack', 'next')
  bind('MediaPreviousTrack', 'prev')
}

const trayIconPath = (): string =>
  app.isPackaged
    ? join(process.resourcesPath, 'icon.ico')
    : join(import.meta.dirname, '../../build/icon.ico')

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

function sendCommand(command: PlayerCommand): void {
  if (win && !win.isDestroyed()) win.webContents.send('player:command', command)
}

function windowShown(): boolean {
  return Boolean(win && win.isVisible() && !win.isMinimized())
}

function showWindow(): void {
  if (!win || win.isDestroyed()) return
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
  refreshTray()
}

function hideWindow(): void {
  if (!win || win.isDestroyed()) return
  if (closePrompt) {
    closePrompt = false
    win.webContents.send('window:close-dismiss')
  }
  win.hide()
  refreshTray()
}

function refreshTray(): void {
  if (!tray) return
  const title = player.title
    ? clip(`${player.title}${player.artist ? ` — ${player.artist}` : ''}`, 62)
    : 'Undertow'
  tray.setToolTip(title)
  refreshThumbar()

  const menu = Menu.buildFromTemplate([
    {
      label: player.title ? title : 'Ничего не играет',
      enabled: false
    },
    { type: 'separator' },
    {
      label: player.playing ? 'Пауза' : 'Играть',
      enabled: Boolean(player.title),
      click: () => sendCommand('toggle')
    },
    {
      label: 'Следующий трек',
      enabled: Boolean(player.title),
      click: () => sendCommand('next')
    },
    {
      label: 'Предыдущий трек',
      enabled: Boolean(player.title),
      click: () => sendCommand('prev')
    },
    { type: 'separator' },
    {
      label: isMini ? 'Полный вид' : 'Мини-плеер',
      click: () => {
        setMini(!isMini)
        showWindow()
      }
    },
    { label: windowShown() ? 'Скрыть' : 'Показать', click: () => (windowShown() ? hideWindow() : showWindow()) },
    { type: 'separator' },
    {
      label: 'Выход',
      click: () => {
        isQuitting = true
        app.quit()
      }
    }
  ])
  tray.setContextMenu(menu)
}

function createTray(): void {
  if (tray) return
  try {
    const image = nativeImage.createFromPath(trayIconPath())
    tray = new Tray(image.isEmpty() ? nativeImage.createEmpty() : image.resize({ width: 16, height: 16 }))
    tray.on('click', () => (windowShown() ? hideWindow() : showWindow()))
    refreshTray()
  } catch {
    tray = null
  }
}

function setMini(on: boolean): boolean {
  if (!win || win.isDestroyed() || on === isMini) return isMini

  if (on) {
    normalBounds = win.getNormalBounds()
    wasMaximized = win.isMaximized()
    if (wasMaximized) win.unmaximize()
    win.setMinimumSize(360, 200)
    win.setSize(MINI_W, MINI_H)
    const area = screen.getDisplayMatching(normalBounds).workArea
    win.setPosition(area.x + area.width - MINI_W - 18, area.y + area.height - MINI_H - 18)
    win.setResizable(false)
    win.setMaximizable(false)
    win.setAlwaysOnTop(true, 'floating')
    win.setTitleBarOverlay({ color: MINI_BG, symbolColor: '#8b9cb0', height: 46 })
  } else {
    win.setTitleBarOverlay({ color: BG, symbolColor: '#8b9cb0', height: 46 })
    win.setAlwaysOnTop(false)
    win.setResizable(true)
    win.setMaximizable(true)
    win.setMinimumSize(1000, 660)
    if (normalBounds) win.setBounds(normalBounds)
    else win.setSize(1320, 860)
    if (wasMaximized) win.maximize()
    normalBounds = null
    wasMaximized = false
  }

  isMini = on
  win.webContents.send('window:mini-changed', isMini)
  refreshTray()
  return isMini
}

function snapMiniToEdges(): void {
  if (!win || win.isDestroyed() || !isMini) return
  const bounds = win.getBounds()
  const area = screen.getDisplayMatching(bounds).workArea
  const threshold = 18
  let x = bounds.x
  let y = bounds.y
  if (Math.abs(x - area.x) < threshold) x = area.x
  else if (Math.abs(x + bounds.width - (area.x + area.width)) < threshold) x = area.x + area.width - bounds.width
  if (Math.abs(y - area.y) < threshold) y = area.y
  else if (Math.abs(y + bounds.height - (area.y + area.height)) < threshold) y = area.y + area.height - bounds.height
  if (x !== bounds.x || y !== bounds.y) win.setPosition(Math.round(x), Math.round(y))
}

function loginSettings(): { path?: string; args: string[] } {
  if (app.isPackaged) return { args: ['--hidden'] }
  return { path: process.execPath, args: [app.getAppPath(), '--hidden'] }
}

function registerWindowIpc(): void {
  ipcMain.handle('window:mini-state', () => isMini)
  ipcMain.handle('presence:get', () => presence.getConfig())
  ipcMain.handle('presence:set', async (_e, next: unknown) =>
    presence.setConfig((next ?? {}) as { enabled?: boolean })
  )
  ipcMain.handle('app:startup-get', () => {
    const settings = loginSettings()
    return app.getLoginItemSettings(settings).openAtLogin
  })
  ipcMain.handle('app:startup-set', (_e, on: unknown) => {
    const settings = { ...loginSettings(), openAtLogin: Boolean(on) }
    app.setLoginItemSettings(settings)
    return app.getLoginItemSettings(settings).openAtLogin
  })
  ipcMain.handle('window:mini', (_e, on: unknown) => setMini(Boolean(on)))
  ipcMain.handle('window:mini-toggle', () => setMini(!isMini))
  ipcMain.on('window:close-action', (_e, action: unknown) => {
    if (action === 'quit') {
      isQuitting = true
      app.quit()
      return
    }
    closePrompt = false
    if (action === 'tray') hideWindow()
    else if (win && !win.isDestroyed()) win.webContents.send('window:close-dismiss')
  })
  ipcMain.on('player:state', (_e, report: Partial<PlayerReport> | null) => {
    player = {
      playing: Boolean(report?.playing),
      title: typeof report?.title === 'string' ? report.title : null,
      artist: typeof report?.artist === 'string' ? report.artist : null,
      source:
        report?.source === 'yandex' ||
        report?.source === 'youtube' ||
        report?.source === 'local' ||
        report?.source === 'soundcloud'
          ? report.source
          : null
    }
    refreshTray()
    presence.update({
      playing: player.playing,
      title: player.title,
      artist: player.artist,
      position: typeof report?.position === 'number' ? report.position : null
    })
  })
}

/**
 * В dev кладём окно на второй монитор (если он есть), чтобы проверки и
 * скриншоты не закрывали пользователю основную работу. В собранном
 * приложении окно открывается там, где его оставили / на основном экране.
 */
function placeOnSecondDisplay(window: BrowserWindow): void {
  if (app.isPackaged) return
  try {
    const primary = screen.getPrimaryDisplay()
    const target = screen.getAllDisplays().find((d) => d.id !== primary.id)
    if (!target) return
    const area = target.workArea
    const bounds = window.getBounds()
    const width = Math.min(bounds.width, area.width)
    const height = Math.min(bounds.height, area.height)
    window.setBounds({
      x: area.x + Math.round((area.width - width) / 2),
      y: area.y + Math.round((area.height - height) / 2),
      width,
      height
    })
  } catch {
    /* один монитор или экран ещё не готов — окно откроется по умолчанию */
  }
}

function createWindow(): void {
  win = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 1000,
    minHeight: 660,
    show: false,
    backgroundColor: BG,
    title: 'Undertow',
    icon: app.isPackaged ? join(process.resourcesPath, 'icon.ico') : join(import.meta.dirname, '../../build/icon.ico'),
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: BG, symbolColor: '#8b9cb0', height: 46 },
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(import.meta.dirname, '../preload/index.cjs'),
      contextIsolation: true,
      sandbox: false,
      nodeIntegration: false,
      spellcheck: false,
      // в фоне визуал и таймеры должны засыпать; звук и медиа-события
      // продолжают работать, поэтому воспроизведение не прерывается
      backgroundThrottling: true
    }
  })

  placeOnSecondDisplay(win)
  win.once('ready-to-show', () => {
    if (startHidden) win?.hide()
    else win?.show()
  })

  // Крестик не закрывает приложение молча: показываем свой диалог в стиле
  // приложения, где можно свернуть в трей или выйти полностью.
  win.on('close', (event) => {
    if (isQuitting) return
    event.preventDefault()
    if (closePrompt) return
    closePrompt = true
    win?.webContents.send('window:close-request')
  })
  // Кнопка «свернуть» тоже убирает окно в трей, а не оставляет его на панели задач.
  win.on('minimize', () => {
    if (!isQuitting) hideWindow()
  })
  win.on('moved', () => snapMiniToEdges())
  win.on('show', refreshTray)
  win.on('hide', refreshTray)
  win.on('restore', refreshTray)

  // В dev полезно видеть консоль рендерера в терминале
  win.webContents.on('console-message', (event) => {
    const e = event as unknown as { level?: string; message?: string; lineNumber?: number }
    if (e.message) console.log(`[renderer:${e.level ?? 'log'}] ${e.message}`)
  })

  win.webContents.on('did-finish-load', () => {
    refreshThumbar()
    if (pendingLink) {
      const link = pendingLink
      pendingLink = null
      win?.webContents.send('app:link', link)
    }
  })

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) {
    void win.loadURL(devUrl)
  } else {
    void win.loadFile(join(import.meta.dirname, '../renderer/index.html'))
  }
}

// В dev открываем CDP (127.0.0.1:9222), чтобы можно было проверять состояние плеера
if (!app.isPackaged) app.commandLine.appendSwitch('remote-debugging-port', '9222')

// Второй запуск (например, клик по закреплённой иконке, когда окно спрятано
// в трее) не создаёт новое приложение, а показывает уже работающее.
const singleInstance = app.requestSingleInstanceLock()
if (!singleInstance) {
  app.quit()
} else {
  app.on('second-instance', (_event, argv) => {
    const link = protocolFrom(argv)
    if (link) openProtocol(link)
    else showWindow()
  })

  app.whenReady().then(async () => {
    app.setAppUserModelId('co.undertow.app')
    setupProtocol()
    setupJumpList()
    setupMediaKeys()
    log('--- app start', app.getVersion(), '---', 'log:', logPath())
    // аудио-прокси нужен до первого resolve, иначе плеер получит прямые URL без CORS
    await startAudioProxy()
    setLocalRoot(offline.localRoot())
    registerIpc()
    registerWindowIpc()
    createWindow()
    createTray()
    initUpdater()
    void presence.init()

    // Быстрый InnerTube-клиент греем в фоне: первый resolve не должен
    // платить за создание сессии, но и запуск окна задерживать нельзя.
    setTimeout(() => warmFastClient(), 2500)

    // Старые записи истории сохранились без длительности — подтягиваем её
    // в фоне, чтобы не задерживать запуск. Рендерер по событию перечитает
    // главную и библиотеку.
    setTimeout(() => {
      void providers.backfillDurations().then((n) => {
        if (n > 0 && win && !win.isDestroyed()) win.webContents.send('library:durations', n)
      })
    }, 2500)

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
      else showWindow()
    })
  })
}

app.on('before-quit', () => {
  isQuitting = true
  globalShortcut.unregisterAll()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
