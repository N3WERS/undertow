/**
 * Обход DPI для YouTube на Windows.
 *
 * Первая версия работает с внешней папкой zapret (Flowseal/zapret-discord-youtube):
 * берём winws.exe, WinDivert и два TLS/QUIC-паттерна, но запускаем только
 * правила для YouTube/Google. Позже эти файлы можно положить в resources.
 *
 * winws требует администратора. Поэтому запускается не сама игра, а скрытый
 * elevated-супервизор: он держит winws, следит за процессом Undertow и гасит
 * обход, когда приложение закрывается. Выключение — через файл-флаг, без
 * повторного UAC.
 */
import { app, dialog } from 'electron'
import { execFile } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { join } from 'node:path'

export type DpiState = 'off' | 'on' | 'starting' | 'stopping' | 'error' | 'unavailable'

export interface DpiStatus {
  supported: boolean
  available: boolean
  running: boolean
  state: DpiState
  path: string | null
  bundled: boolean
  error: string | null
}

interface DpiConfig {
  zapretPath?: string
}

interface Install {
  root: string
  bin: string
  exe: string
  quic: string
  tls: string
  bundled: boolean
  missing: string[]
}

const HOSTS = `youtube.com
youtu.be
youtube-nocookie.com
youtubekids.com
youtubei.googleapis.com
youtube.googleapis.com
youtubeembeddedplayer.googleapis.com
googlevideo.com
redirector.googlevideo.com
ytimg.com
yt3.ggpht.com
yt4.ggpht.com
yt3.googleusercontent.com
googleusercontent.com
googleapis.com
gstatic.com
`

let busy: 'starting' | 'stopping' | null = null
let lastError: string | null = null

const configPath = (): string => join(app.getPath('userData'), 'dpi.json')
const runtimeDir = (): string => join(app.getPath('userData'), 'zapret')
const pidPath = (): string => join(runtimeDir(), 'winws.pid')
const resultPath = (): string => join(runtimeDir(), 'start.result')
const stopPath = (): string => join(runtimeDir(), 'stop.flag')
const scriptPath = (): string => join(runtimeDir(), 'supervise.ps1')
const logPath = (): string => join(runtimeDir(), 'supervise.log')

function readConfig(): DpiConfig {
  try {
    return JSON.parse(readFileSync(configPath(), 'utf8')) as DpiConfig
  } catch {
    return {}
  }
}

function writeConfig(config: DpiConfig): void {
  mkdirSync(app.getPath('userData'), { recursive: true })
  writeFileSync(configPath(), JSON.stringify(config, null, 2), 'utf8')
}

function bundledRoot(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'zapret')
    : join(app.getAppPath(), 'resources', 'zapret')
}

function candidateRoots(): string[] {
  const desktop = app.getPath('desktop')
  const downloads = app.getPath('downloads')
  const documents = app.getPath('documents')
  return [
    join(desktop, 'zprtnew'),
    join(desktop, 'zapret-discord-youtube'),
    join(downloads, 'zprtnew'),
    join(downloads, 'zapret-discord-youtube'),
    join(documents, 'zprtnew'),
    join(documents, 'zapret-discord-youtube')
  ]
}

function locate(root: string, bundled = false): Install | null {
  const bin = join(root, 'bin')
  if (!existsSync(join(bin, 'winws.exe'))) return null
  const names = ['winws.exe', 'WinDivert.dll', 'WinDivert64.sys', 'cygwin1.dll']
  const missing = names.filter((name) => !existsSync(join(bin, name)))
  const quic = join(bin, 'quic_initial_www_google_com.bin')
  const tls = join(bin, 'tls_clienthello_www_google_com.bin')
  if (!existsSync(quic)) missing.push('quic_initial_www_google_com.bin')
  if (!existsSync(tls)) missing.push('tls_clienthello_www_google_com.bin')
  return {
    root,
    bin,
    exe: join(bin, 'winws.exe'),
    quic,
    tls,
    bundled,
    missing
  }
}

function install(): Install | null {
  const configured = readConfig().zapretPath
  const bundled = bundledRoot()
  const roots = [...(configured ? [configured] : []), bundled, ...candidateRoots()]
  const seen = new Set<string>()
  let incomplete: Install | null = null

  // Сначала ищем полный набор. Если у выбранной папки чего-то не хватает,
  // пробуем встроенную копию, а уже потом показываем ошибку.
  for (const root of roots) {
    const key = root.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    const found = locate(root, key === bundled.toLowerCase())
    if (!found) continue
    if (found.missing.length === 0) return found
    if (!incomplete) incomplete = found
  }
  return incomplete
}

function psQuote(text: string): string {
  return text.replace(/'/g, "''")
}

function isPidRunning(pid: number): Promise<boolean> {
  return new Promise((resolve) => {
    execFile(
      'tasklist.exe',
      ['/FI', `PID eq ${pid}`, '/NH'],
      { windowsHide: true, timeout: 5000 },
      (error, stdout) => {
        if (error) {
          resolve(false)
          return
        }
        resolve(stdout.toLowerCase().includes('winws.exe'))
      }
    )
  })
}

async function runningPid(): Promise<number | null> {
  try {
    const pid = Number(readFileSync(pidPath(), 'utf8').replace(/^\uFEFF/, '').trim())
    if (!pid) return null
    if (await isPidRunning(pid)) return pid
    rmSync(pidPath(), { force: true })
  } catch {
    // pid-файла ещё нет или он уже удалён
  }
  return null
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitForResult(timeoutMs: number): Promise<string | null> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (existsSync(resultPath())) {
      try {
        return readFileSync(resultPath(), 'utf8').replace(/^\uFEFF/, '').trim()
      } catch {
        return null
      }
    }
    await sleep(150)
  }
  return null
}

function friendlyError(text: string): string {
  if (/canceled|cancelled|отменен|отменён/i.test(text)) {
    return 'Запуск отменён: Windows запросил права администратора.'
  }
  if (/отказано в доступе|access is denied/i.test(text)) {
    return 'Нет прав для запуска winws. Нужно подтвердить запрос администратора.'
  }
  return text.trim() || 'Не удалось запустить обход DPI.'
}

function supervisorScript(found: Install, appPid: number): string {
  const hosts = join(runtimeDir(), 'hosts.txt')
  const pid = pidPath()
  const result = resultPath()
  const stop = stopPath()
  const log = logPath()
  const args = [
    '--wf-tcp=443',
    '--wf-udp=443',
    '--filter-udp=443',
    `--hostlist="${hosts}"`,
    '--dpi-desync=fake',
    '--dpi-desync-repeats=6',
    `--dpi-desync-fake-quic="${found.quic}"`,
    '--new',
    '--filter-tcp=443',
    `--hostlist="${hosts}"`,
    '--ip-id=zero',
    '--dpi-desync=multisplit',
    '--dpi-desync-split-seqovl=681',
    '--dpi-desync-split-pos=1',
    `--dpi-desync-split-seqovl-pattern="${found.tls}"`
  ]
  const argsPs = args.map((arg) => `    '${psQuote(arg)}'`).join(',\n')

  return `$ErrorActionPreference = 'Stop'
$appPid = ${appPid}
$exe = '${psQuote(found.exe)}'
$work = '${psQuote(found.bin)}'
$pidFile = '${psQuote(pid)}'
$resultFile = '${psQuote(result)}'
$stopFlag = '${psQuote(stop)}'
$logFile = '${psQuote(log)}'

function Write-Log([string]$text) {
  "$(Get-Date -Format 'HH:mm:ss.fff') $text" | Add-Content -LiteralPath $logFile -Encoding utf8
}

try {
  if (Test-Path -LiteralPath $stopFlag) { Remove-Item -LiteralPath $stopFlag -Force }
  Remove-Item -LiteralPath $resultFile -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $pidFile -ErrorAction SilentlyContinue
  $argsList = @(
${argsPs}
  )
  Write-Log "starting winws"
  $p = Start-Process -FilePath $exe -ArgumentList $argsList -WorkingDirectory $work -WindowStyle Hidden -PassThru
  "ok $($p.Id)" | Set-Content -LiteralPath $resultFile -Encoding utf8
  $p.Id | Set-Content -LiteralPath $pidFile -Encoding utf8
  Write-Log "winws pid=$($p.Id) app pid=$appPid"
  while ($true) {
    Start-Sleep -Milliseconds 500
    if ($p.HasExited) { Write-Log "winws exited code=$($p.ExitCode)"; break }
    if (Test-Path -LiteralPath $stopFlag) { Write-Log "stop requested"; break }
    if (-not (Get-Process -Id $appPid -ErrorAction SilentlyContinue)) { Write-Log "app exited"; break }
  }
  if (-not $p.HasExited) { Stop-Process -Id $p.Id -Force }
  Write-Log "stopped"
} catch {
  $message = "error $($_.Exception.Message)"
  $message | Set-Content -LiteralPath $resultFile -Encoding utf8
  Write-Log $message
} finally {
  Remove-Item -LiteralPath $pidFile -ErrorAction SilentlyContinue
}
`
}

function startElevatedSupervisor(found: Install): Promise<void> {
  return new Promise((resolve, reject) => {
    const script = scriptPath()
    const command =
      `$p = Start-Process -FilePath 'powershell.exe' -Verb RunAs -WindowStyle Hidden -PassThru ` +
      `-ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-File','${psQuote(script)}'); ` +
      `if (-not $p) { exit 1 }`
    execFile(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', command],
      { windowsHide: true, timeout: 60000 },
      (error, _stdout, stderr) => {
        if (error) {
          reject(new Error(friendlyError(stderr || error.message)))
          return
        }
        resolve()
      }
    )
  })
}

export async function getStatus(): Promise<DpiStatus> {
  const supported = process.platform === 'win32'
  if (!supported) {
    return {
      supported,
      available: false,
      running: false,
      state: 'unavailable',
      path: null,
      bundled: false,
      error: 'Обход DPI сейчас реализован только для Windows.'
    }
  }

  const found = install()
  const pid = await runningPid()
  if (found && found.missing.length > 0) {
    return {
      supported,
      available: false,
      running: Boolean(pid),
      state: 'error',
      path: found.root,
      bundled: found.bundled,
      error: `В папке zapret не хватает: ${found.missing.join(', ')}`
    }
  }

  if (busy) {
    return {
      supported,
      available: Boolean(found),
      running: Boolean(pid),
      state: busy,
      path: found?.root ?? null,
      bundled: Boolean(found?.bundled),
      error: null
    }
  }

  return {
    supported,
    available: Boolean(found),
    running: Boolean(pid),
    state: pid ? 'on' : lastError ? 'error' : 'off',
    path: found?.root ?? readConfig().zapretPath ?? null,
    bundled: Boolean(found?.bundled),
    error: pid ? null : lastError
  }
}

export async function setEnabled(on: boolean): Promise<DpiStatus> {
  if (process.platform !== 'win32') throw new Error('Обход DPI сейчас доступен только на Windows.')
  if (busy) throw new Error('Обход уже переключается.')

  const found = install()
  if (on) {
    if (!found) throw new Error('Не найдены файлы zapret. Укажи папку в настройках.')
    if (found.missing.length > 0) {
      throw new Error(`В папке zapret не хватает: ${found.missing.join(', ')}`)
    }
    if (await runningPid()) return getStatus()

    busy = 'starting'
    lastError = null
    try {
      mkdirSync(runtimeDir(), { recursive: true })
      writeFileSync(join(runtimeDir(), 'hosts.txt'), HOSTS, 'utf8')
      // Windows PowerShell 5.1 читает -File как ANSI, если нет BOM: пути с кириллицей иначе ломаются
      writeFileSync(scriptPath(), String.fromCharCode(0xfeff) + supervisorScript(found, process.pid), 'utf8')
      rmSync(stopPath(), { force: true })
      rmSync(resultPath(), { force: true })
      await startElevatedSupervisor(found)
      const result = await waitForResult(60000)
      if (!result) {
        writeFileSync(stopPath(), 'timeout', 'utf8')
        throw new Error('Windows не подтвердил запуск. Проверь запрос администратора.')
      }
      if (!result.startsWith('ok ')) {
        throw new Error(friendlyError(result.slice(3)))
      }
      // Даём winws время упасть, если драйвер или аргументы не подошли.
      await sleep(900)
      if (!(await runningPid())) {
        let detail = ''
        try {
          detail = readFileSync(logPath(), 'utf8').trim().split('\n').slice(-3).join(' · ')
        } catch {
          // лога может не быть
        }
        throw new Error(`winws не остался запущенным${detail ? `: ${detail}` : '.'}`)
      }
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e)
      throw e
    } finally {
      busy = null
    }
    return getStatus()
  }

  busy = 'stopping'
  lastError = null
  try {
    if (!(await runningPid())) {
      rmSync(stopPath(), { force: true })
      busy = null
      return await getStatus()
    }
    mkdirSync(runtimeDir(), { recursive: true })
    writeFileSync(stopPath(), 'stop', 'utf8')
    const deadline = Date.now() + 12000
    while (Date.now() < deadline) {
      if (!(await runningPid())) break
      await sleep(200)
    }
    if (await runningPid()) {
      throw new Error('winws не остановился. Возможно, его запустил другой процесс.')
    }
    busy = null
    return await getStatus()
  } catch (e) {
    lastError = e instanceof Error ? e.message : String(e)
    throw e
  } finally {
    busy = null
  }
}

export async function chooseFolder(): Promise<DpiStatus> {
  const result = await dialog.showOpenDialog({
    title: 'Папка zapret',
    buttonLabel: 'Выбрать',
    properties: ['openDirectory']
  })
  if (result.canceled || result.filePaths.length === 0) return getStatus()
  const root = result.filePaths[0]
  const found = locate(root)
  if (!found) {
    throw new Error('В выбранной папке нет bin/winws.exe.')
  }
  if (found.missing.length > 0) {
    throw new Error(`В папке zapret не хватает: ${found.missing.join(', ')}`)
  }
  writeConfig({ ...readConfig(), zapretPath: root })
  lastError = null
  return getStatus()
}
