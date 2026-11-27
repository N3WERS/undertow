/**
 * Обёртка над yt-dlp: единственный компонент, который умеет получать
 * реальный аудио-URL (youtubei.js этого больше не может — SABR/PO-token).
 */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'

const PYTHON_CANDIDATES = process.platform === 'win32' ? ['python', 'py', 'python3'] : ['python3', 'python']

type RunnerKind = 'bundled' | 'system' | 'python'

interface Runner {
  cmd: string
  prefix: string[]
  kind: RunnerKind
  version: string
  path: string
}

let resolvedRunner: Runner | null = null

function runOnce(
  cmd: string,
  args: string[],
  timeoutMs = 90000,
  extraEnv?: Record<string, string>
): Promise<{ code: number; out: string; err: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { windowsHide: true, env: extraEnv ? { ...process.env, ...extraEnv } : process.env })
    let out = ''
    let err = ''
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error(`yt-dlp timeout after ${timeoutMs}ms`))
    }, timeoutMs)

    child.stdout.on('data', (d) => (out += d.toString()))
    child.stderr.on('data', (d) => (err += d.toString()))
    child.on('error', (e) => {
      clearTimeout(timer)
      reject(e)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ code: code ?? -1, out, err })
    })
  })
}

/**
 * Ищет yt-dlp: сначала встроенный exe рядом с приложением, потом системный,
 * и только в конце Python-модуль. Встроенный бинарник — основной путь,
 * поэтому после установки Python не нужен.
 */
async function resolveRunner(): Promise<Runner> {
  if (resolvedRunner) return resolvedRunner

  const exeName = process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp'
  const bundled = app.isPackaged
    ? [join(process.resourcesPath, 'bin', exeName)]
    : [join(app.getAppPath(), 'resources', 'bin', exeName)]

  for (const candidate of bundled) {
    if (!existsSync(candidate)) continue
    try {
      const { code, out } = await runOnce(candidate, ['--version'], 20_000)
      if (code === 0) {
        resolvedRunner = {
          cmd: candidate,
          prefix: [],
          kind: 'bundled',
          version: out.trim(),
          path: candidate
        }
        return resolvedRunner
      }
    } catch {
      /* встроенный файл не запустился — пробуем системный */
    }
  }

  for (const candidate of ['yt-dlp', exeName]) {
    try {
      const { code, out } = await runOnce(candidate, ['--version'], 20_000)
      if (code === 0) {
        resolvedRunner = {
          cmd: candidate,
          prefix: [],
          kind: 'system',
          version: out.trim(),
          path: candidate
        }
        return resolvedRunner
      }
    } catch {
      /* пробуем следующий */
    }
  }

  for (const cmd of PYTHON_CANDIDATES) {
    try {
      const { code, out } = await runOnce(cmd, ['-m', 'yt_dlp', '--version'], 20_000)
      if (code === 0) {
        resolvedRunner = {
          cmd,
          prefix: ['-m', 'yt_dlp'],
          kind: 'python',
          version: out.trim(),
          path: `${cmd} -m yt_dlp`
        }
        return resolvedRunner
      }
    } catch {
      /* пробуем следующий */
    }
  }

  throw new Error(
    'yt-dlp не найден: встроенный файл отсутствует, системный yt-dlp и Python-модуль недоступны'
  )
}

export async function ytdlpVersion(): Promise<string | null> {
  try {
    return (await resolveRunner()).version
  } catch {
    return null
  }
}

export async function ytdlpInfo(): Promise<Runner | null> {
  try {
    return await resolveRunner()
  } catch {
    return null
  }
}

async function run(args: string[], timeoutMs = 90000, env?: Record<string, string>): Promise<string> {
  const runner = await resolveRunner()
  const { code, out, err } = await runOnce(runner.cmd, [...runner.prefix, ...args], timeoutMs, env)
  if (code !== 0) {
    const tail = err.trim().split('\n').slice(-2).join(' ')
    throw new Error(`yt-dlp: ${tail || `exit ${code}`}`)
  }
  return out
}

export interface YtdlpEntry {
  id: string
  title: string
  uploader: string
  /** канал загрузки и его верификация — нужны, чтобы отличить официальный трек */
  channelId: string | null
  verified: boolean
  duration: number | null
  thumbnail: string | null
  isLive: boolean
  /** просмотры из выдачи поиска — для страницы «Новинки» */
  views: number | null
}

/** Быстрый поиск: --flat-playlist не тянет форматы, ~2.4 с на 24 результата. */
export async function ytSearch(query: string, limit = 24): Promise<YtdlpEntry[]> {
  const out = await run(['--no-warnings', '--force-ipv4', '--socket-timeout', '4', '--flat-playlist', '-J', `ytsearch${limit}:${query}`])
  const data = JSON.parse(out) as { entries?: Record<string, unknown>[] }
  return (data.entries ?? []).map((e) => {
    const thumbs = (e.thumbnails as { url: string; preference?: number }[] | undefined) ?? []
    const best = [...thumbs].sort((a, b) => (b.preference ?? 0) - (a.preference ?? 0))[0]
    return {
      id: String(e.id),
      title: String(e.title ?? ''),
      uploader: String(e.uploader ?? e.channel ?? ''),
      channelId: typeof e.channel_id === 'string' ? e.channel_id : null,
      verified: e.channel_is_verified === true,
      duration: typeof e.duration === 'number' ? e.duration : null,
      thumbnail: best?.url ?? null,
      isLive: e.live_status === 'is_live',
      views: typeof e.view_count === 'number' ? e.view_count : null
    }
  })
}

/**
 * Фоновый прогрев yt-dlp: первый запуск после старта приложения иногда
 * тратит 10–20 с на player JS/сеть. К моменту первого клика всё уже горячее.
 */
export async function ytWarmup(): Promise<void> {
  try {
    await run(
      [
        '--no-warnings',
        '--force-ipv4',
        '--simulate',
        '--skip-download',
        '--print',
        '%(id)s',
        'https://www.youtube.com/watch?v=dQw4w9WgXcQ'
      ],
      60_000
    )
  } catch {
    /* прогрев необязателен */
  }
}

export interface YtdlpCandidate {
  url: string
  ext: string
  abr: number | null
  formatId: string
  acodec: string
}

interface RawFormat {
  url?: string
  ext?: string
  abr?: number | null
  tbr?: number | null
  format_id?: string
  acodec?: string
  vcodec?: string
  protocol?: string
  format_note?: string
}

function candidateRank(f: RawFormat): number {
  const ext = (f.ext || '').toLowerCase()
  const acodec = (f.acodec || '').toLowerCase()
  if (ext === 'm4a' || acodec.startsWith('mp4a')) return 0
  if (acodec.startsWith('opus') || acodec === 'opus') return 1
  return 2
}

/**
 * Один запуск yt-dlp, который возвращает сразу несколько независимых
 * аудио-URL. Все они подписаны и могут указывать на разные CDN-узлы:
 * проверяем пачкой и берём первый живой, не запуская Python заново.
 */
export async function ytFormats(videoId: string, playerClient?: string): Promise<YtdlpCandidate[]> {
  const args = [
    '--no-warnings',
    '--force-ipv4',
    '--socket-timeout',
    '4',
    '--no-playlist',
    '-J',
    `https://www.youtube.com/watch?v=${videoId}`
  ]
  if (playerClient) args.push('--extractor-args', `youtube:player_client=${playerClient}`)
  const out = await run(args, 45_000)
  const data = JSON.parse(out) as { formats?: RawFormat[]; requested_formats?: RawFormat[]; url?: string; ext?: string }
  const raw = [...(data.formats ?? []), ...(data.requested_formats ?? [])]
  if (data.url) raw.push({ url: data.url, ext: data.ext, format_id: 'selected', acodec: 'audio' })

  const seen = new Set<string>()
  const list: RawFormat[] = []
  for (const f of raw) {
    if (!f.url || !/^https?:/i.test(f.url)) continue
    if ((f.vcodec ?? 'none') !== 'none') continue
    if ((f.acodec ?? 'none') === 'none') continue
    if (!['m4a', 'webm', 'mp4', 'mp3', 'opus'].includes((f.ext || '').toLowerCase())) continue
    if (seen.has(f.url)) continue
    seen.add(f.url)
    list.push(f)
  }
  list.sort((a, b) => candidateRank(a) - candidateRank(b) || (b.abr ?? b.tbr ?? 0) - (a.abr ?? a.tbr ?? 0))
  return list.slice(0, 6).map((f) => ({
    url: f.url as string,
    ext: (f.ext || 'm4a').toLowerCase(),
    abr: typeof f.abr === 'number' ? f.abr : typeof f.tbr === 'number' ? f.tbr : null,
    formatId: String(f.format_id ?? ''),
    acodec: String(f.acodec ?? '')
  }))
}

export interface YtdlpStream {
  url: string
  ext: string
  abr: number | null
}

/**
 * Разрешает прямой URL аудио. Ссылки googlevideo живут часами, но привязаны
 * к IP и содержат подпись — поэтому кэшируем недолго (см. providers/youtube.ts).
 */
const AUDIO_FORMATS = [
  'bestaudio[ext=m4a]/bestaudio/best',
  'bestaudio[acodec=opus]/bestaudio/best',
  'bestaudio[abr<=70]/bestaudio/best',
  'bestaudio/best'
]

export async function ytResolve(videoId: string, attempt = 0): Promise<YtdlpStream> {
  const format = AUDIO_FORMATS[Math.abs(attempt) % AUDIO_FORMATS.length]
  const out = await run([
    '--no-warnings',
    '--force-ipv4',
    '--socket-timeout',
    '4',
    '-f',
    format,
    '--print',
    '%(ext)s|%(abr)s|%(url)s',
    `https://www.youtube.com/watch?v=${videoId}`
  ])
  const line = out.trim().split('\n').filter(Boolean).pop()
  if (!line) throw new Error('yt-dlp вернул пустой ответ')
  const first = line.indexOf('|')
  const second = line.indexOf('|', first + 1)
  const ext = line.slice(0, first)
  const abr = Number(line.slice(first + 1, second))
  const url = line.slice(second + 1)
  if (!url.startsWith('http')) throw new Error('yt-dlp не отдал ссылку')
  return { url, ext, abr: Number.isFinite(abr) ? abr : null }
}

export interface YtdlpSearchResolve {
  videoId: string
  title: string
  uploader: string
  duration: number | null
  ext: string
  abr: number | null
  url: string
}

/**
 * Поиск и ссылка за ОДИН запуск yt-dlp.
 *
 * Обычный путь «поиск → выбор → resolve» — это два процесса, то есть ~2.5 с
 * на старт каждого. Здесь `ytsearch1:` сразу разрешает первый результат,
 * поэтому подмена укладывается в ~3.7 с вместо ~5 с.
 *
 * PYTHONIOENCODING=utf-8 обязателен: без него русские названия приходят
 * в консольной кодировке Windows и превращаются в мусор.
 */
export async function ytSearchResolve(query: string): Promise<YtdlpSearchResolve | null> {
  const fmt = '%(id)s\t%(title)s\t%(duration)s\t%(uploader)s\t%(ext)s\t%(abr)s\t%(url)s'
  const out = await run(
    [
      '--no-warnings',
      '--force-ipv4',
      '--socket-timeout',
      '4',
      '-f',
      'bestaudio',
      '--print',
      fmt,
      `ytsearch1:${query}`
    ],
    60000,
    { PYTHONIOENCODING: 'utf-8' }
  )
  const line = out
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.split('\t').length >= 7 && /^https?:/.test(l.split('\t')[6] ?? ''))
  if (!line) return null

  const [videoId, title, duration, uploader, ext, abr, url] = line.split('\t')
  if (!videoId || !url) return null

  return {
    videoId,
    title,
    uploader,
    duration: duration && duration !== 'NA' ? Number(duration) : null,
    ext,
    abr: abr && abr !== 'NA' ? Number(abr) : null,
    url
  }
}

/**
 * Скачивает лучший аудиопоток прямо в файл.
 *
 * Зачем не качать по ссылке из ytResolve: googlevideo режет одиночное
 * соединение до ~50 КБ/с, поэтому обычный fetch для сохранения слишком
 * медленный. yt-dlp с `--http-chunk-size` тянет кусками и укладывается
 * в несколько секунд.
 */
export async function ytDownload(
  videoId: string,
  dir: string,
  baseName: string,
  onPercent?: (percent: number) => void,
  format = 'bestaudio[acodec=opus]/bestaudio/best',
  timeoutMs = 300_000,
  retries = 10
): Promise<{ file: string; bytes: number }> {
  const { readdir, stat, rm } = await import('node:fs/promises')
  const path = await import('node:path')
  const runner = await resolveRunner()
  const template = path.join(dir, `${baseName}.%(ext)s`)
  const args = [
    ...runner.prefix,
    '--no-warnings',
    '--force-ipv4',
    '--newline',
    '--no-part',
    '--no-playlist',
    '--force-overwrites',
    '--http-chunk-size',
    '1M',
    '--socket-timeout',
    '4',
    '--retries',
    String(retries),
    '-f',
    format,
    '-o',
    template,
    `https://www.youtube.com/watch?v=${videoId}`
  ]

  await new Promise<void>((resolve, reject) => {
    const child = spawn(runner.cmd, args, { windowsHide: true, env: { ...process.env, PYTHONIOENCODING: 'utf-8' } })
    let err = ''
    let last = -1
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error('yt-dlp: скачивание заняло слишком много времени'))
    }, timeoutMs)

    child.stdout.on('data', (d) => {
      const text = d.toString()
      const m = /\[download\]\s+([\d.]+)%/.exec(text)
      if (m) {
        const pct = Math.round(Number(m[1]))
        if (pct !== last) {
          last = pct
          onPercent?.(pct)
        }
      }
    })
    child.stderr.on('data', (d) => {
      err += d.toString()
    })
    child.on('error', (e) => {
      clearTimeout(timer)
      reject(e)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (code === 0) resolve()
      else reject(new Error(`yt-dlp: ${err.trim().split('\n').slice(-2).join(' ') || `exit ${code}`}`))
    })
  })

  const files = (await readdir(dir)).filter((f) => f.startsWith(`${baseName}.`) && !f.endsWith('.part'))
  if (!files.length) throw new Error('yt-dlp не оставил файл')
  let best = ''
  let size = 0
  for (const f of files) {
    const full = path.join(dir, f)
    const s = await stat(full)
    if (s.size > size) {
      best = full
      size = s.size
    }
  }
  if (!best || size < 20_000) {
    await Promise.all(files.map((f) => rm(path.join(dir, f), { force: true }).catch(() => undefined)))
    throw new Error('yt-dlp скачал пустой файл')
  }
  return { file: best, bytes: size }
}
