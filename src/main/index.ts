import { app, BrowserWindow, screen, shell } from 'electron'
import { join } from 'node:path'
import { startAudioProxy } from './audioProxy'
import { registerIpc } from './ipc'
import * as providers from './providers'

const BG = '#070a0e'

let win: BrowserWindow | null = null

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
      // анимации плеера не должны замедляться, когда окно не в фокусе
      backgroundThrottling: false
    }
  })

  placeOnSecondDisplay(win)
  win.once('ready-to-show', () => win?.show())

  // В dev полезно видеть консоль рендерера в терминале
  win.webContents.on('console-message', (event) => {
    const e = event as unknown as { level?: string; message?: string; lineNumber?: number }
    if (e.message) console.log(`[renderer:${e.level ?? 'log'}] ${e.message}`)
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

app.whenReady().then(async () => {
  app.setAppUserModelId('co.undertow.app')
  // аудио-прокси нужен до первого resolve, иначе плеер получит прямые URL без CORS
  await startAudioProxy()
  registerIpc()
  createWindow()

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
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
