/**
 * Обход DPI для YouTube на Windows.
 *
 * В установщик входит минимальный zapret (winws + WinDivert) и служба
 * UndertowDpi. Служба работает от SYSTEM, поэтому включение и выключение
 * обхода не требуют UAC. Она держит winws, следит за процессом Undertow и
 * гасит обход, когда приложение закрывается.
 *
 * Если службы нет (например, запуск из исходников), используется старый
 * elevated-супервизор через PowerShell: он требует UAC при каждом включении,
 * но позволяет проверить обход без установки.
 */
import { app, dialog } from 'electron'
import { execFile } from 'node:child_process'
import { connect } from 'node:net'
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
  mode: 'service' | 'uac'
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

const BS = String.fromCharCode(92)
const SERVICE_PIPE = `${BS}${BS}.${BS}pipe${BS}UndertowDpi`

interface ServiceProbe {
  installed: boolean
  reachable: boolean
  running: boolean
  pid: number | null
  appPid: number | null
}

function serviceCommand(line: string, timeoutMs = 5000): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = connect({ path: SERVICE_PIPE })
    let data = ''
    let done = false
    const timer = setTimeout(() => finish('err', new Error('Служба обхода не отвечает.')), timeoutMs)

    const finish = (kind: 'ok' | 'err', value: string | Error): void => {
      if (done) return
      done = true
      clearTimeout(timer)
      socket.destroy()
      if (kind === 'ok') resolve(String(value))
      else reject(value as Error)
    }

    socket.setEncoding('utf8')
    socket.on('connect', () => socket.write(`${line}\n`))
    socket.on('data', (chunk: string) => {
      data += chunk
      const nl = data.indexOf('\n')
      if (nl >= 0) finish('ok', data.slice(0, nl).trim())
    })
    socket.on('error', (error) => finish('err', new Error(`Служба обхода недоступна: ${error.message}`)))
    socket.on('close', () => {
      if (!done) finish('err', new Error('Служба обхода закрыла соединение.'))
    })
  })
}

function serviceInstalled(): Promise<boolean> {
  return new Promise((resolve) => {
    execFile(
      'sc.exe',
      ['query', 'UndertowDpi'],
      { windowsHide: true, timeout: 3000 },
      (error, stdout) => {
        resolve(!error && /UndertowDpi/i.test(stdout))
      }
    )
  })
}

async function serviceProbe(): Promise<ServiceProbe> {
  // при старте приложения служба может ещё подниматься: даём ей пару попыток,
  // иначе плашка DPI успевает показать ошибку и висит так до следующего опроса
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const reply = await serviceCommand('status', 1500)
      const match = /^ok running=(\d) pid=(\d+) app=(\d+)$/.exec(reply)
      if (match) {
        return {
          installed: true,
          reachable: true,
          running: match[1] === '1',
          pid: Number(match[2]) || null,
          appPid: Number(match[3]) || null
        }
      }
    } catch {
      // службы может не быть — тогда работаем через старый UAC-супервизор
    }
    if (attempt < 2) await sleep(250 + attempt * 350)
  }
  return {
    installed: await serviceInstalled(),
    reachable: false,
    running: false,
    pid: null,
    appPid: null
  }
}

async function stopLegacySupervisor(): Promise<void> {
  if (!(await runningPid())) {
    rmSync(stopPath(), { force: true })
    return
  }
  mkdirSync(runtimeDir(), { recursive: true })
  writeFileSync(stopPath(), 'stop', 'utf8')
  const deadline = Date.now() + 6000
  while (Date.now() < deadline) {
    if (!(await runningPid())) return
    await sleep(200)
  }
  throw new Error('Старый winws не остановился. Перезапусти приложение.')
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

function startElevatedSupervisor(): Promise<void> {
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
      mode: 'uac',
      error: 'Обход DPI сейчас реализован только для Windows.'
    }
  }

  const found = install()
  const service = await serviceProbe()
  const mode: 'service' | 'uac' = service.installed ? 'service' : 'uac'
  const path = found?.root ?? readConfig().zapretPath ?? null

  if (found && found.missing.length > 0) {
    return {
      supported,
      available: false,
      running: service.reachable ? service.running : Boolean(await runningPid()),
      state: 'error',
      path: found.root,
      bundled: found.bundled,
      mode,
      error: `В папке zapret не хватает: ${found.missing.join(', ')}`
    }
  }

  if (service.installed && !service.reachable) {
    return {
      supported,
      available: Boolean(found),
      running: false,
      state: 'error',
      path,
      bundled: Boolean(found?.bundled),
      mode: 'service',
      error: 'Служба UndertowDpi не отвечает. Переустанови Undertow или перезапусти службу.'
    }
  }

  if (service.reachable) {
    return {
      supported,
      available: Boolean(found),
      running: service.running,
      state: busy ?? (service.running ? 'on' : lastError ? 'error' : 'off'),
      path,
      bundled: Boolean(found?.bundled),
      mode: 'service',
      error: service.running ? null : lastError
    }
  }

  const pid = await runningPid()
  if (busy) {
    return {
      supported,
      available: Boolean(found),
      running: Boolean(pid),
      state: busy,
      path,
      bundled: Boolean(found?.bundled),
      mode: 'uac',
      error: null
    }
  }

  return {
    supported,
    available: Boolean(found),
    running: Boolean(pid),
    state: pid ? 'on' : lastError ? 'error' : 'off',
    path,
    bundled: Boolean(found?.bundled),
    mode: 'uac',
    error: pid ? null : lastError
  }
}

export async function setEnabled(on: boolean): Promise<DpiStatus> {
  if (process.platform !== 'win32') throw new Error('Обход DPI сейчас доступен только на Windows.')
  if (busy) throw new Error('Обход уже переключается.')

  const found = install()
  if (!found) throw new Error('Не найдены файлы zapret. Укажи папку в настройках.')
  if (found.missing.length > 0) {
    throw new Error(`В папке zapret не хватает: ${found.missing.join(', ')}`)
  }

  const service = await serviceProbe()
  if (service.installed) {
    if (!service.reachable) {
      throw new Error('Служба UndertowDpi не отвечает. Переустанови Undertow или перезапусти службу.')
    }
    if (on && service.running) return getStatus()

    busy = on ? 'starting' : 'stopping'
    lastError = null
    try {
      if (on) {
        // если до установки службы остался старый elevated-супервизор — гасим его
        await stopLegacySupervisor()
        const reply = await serviceCommand(`start ${process.pid}`, 15000)
        if (!reply.startsWith('ok')) throw new Error(friendlyError(reply.slice(3)))
      } else {
        await stopLegacySupervisor()
        const reply = await serviceCommand('stop', 10000)
        if (!reply.startsWith('ok')) throw new Error(friendlyError(reply.slice(3)))
      }
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e)
      throw e
    } finally {
      busy = null
    }
    return getStatus()
  }

  if (on) {
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
      await startElevatedSupervisor()
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
