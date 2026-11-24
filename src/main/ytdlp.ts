/**
 * Обёртка над yt-dlp: единственный компонент, который умеет получать
 * реальный аудио-URL (youtubei.js этого больше не может — SABR/PO-token).
 */
import { spawn } from 'node:child_process'

const CANDIDATES = process.platform === 'win32' ? ['python', 'py', 'python3'] : ['python3', 'python']
let resolvedPython: string | null = null
let versionCache: string | null = null

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

/** Ищет рабочий python с модулем yt_dlp. Кэширует результат. */
export async function findPython(): Promise<string> {
  if (resolvedPython) return resolvedPython
  for (const cmd of CANDIDATES) {
    try {
      const { code, out } = await runOnce(cmd, ['-m', 'yt_dlp', '--version'], 20000)
      if (code === 0) {
        resolvedPython = cmd
        versionCache = out.trim()
        return cmd
      }
    } catch {
      /* пробуем следующий */
    }
  }
  throw new Error('yt-dlp не найден. Установи: python -m pip install -U yt-dlp')
}

export async function ytdlpVersion(): Promise<string | null> {
  try {
    await findPython()
    return versionCache
  } catch {
    return null
  }
}

async function run(args: string[], timeoutMs = 90000, env?: Record<string, string>): Promise<string> {
  const cmd = await findPython()
  const { code, out, err } = await runOnce(cmd, ['-m', 'yt_dlp', ...args], timeoutMs, env)
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
  duration: number | null
  thumbnail: string | null
  isLive: boolean
}

/** Быстрый поиск: --flat-playlist не тянет форматы, ~2.4 с на 24 результата. */
export async function ytSearch(query: string, limit = 24): Promise<YtdlpEntry[]> {
  const out = await run(['--no-warnings', '--flat-playlist', '-J', `ytsearch${limit}:${query}`])
  const data = JSON.parse(out) as { entries?: Record<string, unknown>[] }
  return (data.entries ?? []).map((e) => {
    const thumbs = (e.thumbnails as { url: string; preference?: number }[] | undefined) ?? []
    const best = [...thumbs].sort((a, b) => (b.preference ?? 0) - (a.preference ?? 0))[0]
    return {
      id: String(e.id),
      title: String(e.title ?? ''),
      uploader: String(e.uploader ?? e.channel ?? ''),
      duration: typeof e.duration === 'number' ? e.duration : null,
      thumbnail: best?.url ?? null,
      isLive: e.live_status === 'is_live'
    }
  })
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
export async function ytResolve(videoId: string): Promise<YtdlpStream> {
  const out = await run([
    '--no-warnings',
    '-f',
    'bestaudio[acodec=opus]/bestaudio/best',
    '--print',
    '%(ext)s|%(abr)s|%(url)s',
    `https://music.youtube.com/watch?v=${videoId}`
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
    ['--no-warnings', '-f', 'bestaudio', '--print', fmt, `ytsearch1:${query}`],
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
