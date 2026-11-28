import { app } from 'electron'
import { existsSync, mkdirSync, renameSync, statSync } from 'node:fs'
import { appendFile } from 'node:fs/promises'
import { join } from 'node:path'

let file: string | null = null
let buffer: string[] = []
let timer: ReturnType<typeof setTimeout> | null = null
let writeChain: Promise<void> = Promise.resolve()

function logFile(): string {
  if (file) return file
  const dir = app.getPath('userData')
  mkdirSync(dir, { recursive: true })
  file = join(dir, 'app.log')
  return file
}

export function logPath(): string {
  return logFile()
}

function rotate(path: string): void {
  try {
    if (existsSync(path) && statSync(path).size > 2 * 1024 * 1024) {
      renameSync(path, `${path}.1`)
    }
  } catch {
    // лог не должен мешать работе приложения
  }
}

function flush(): void {
  if (!buffer.length) return
  const text = buffer.join('')
  buffer = []
  const path = logFile()
  writeChain = writeChain
    .then(async () => {
      rotate(path)
      await appendFile(path, text, 'utf8')
    })
    .catch(() => {
      // молча: логирование не должно ронять приложение
    })
}

function schedule(): void {
  if (timer) return
  timer = setTimeout(() => {
    timer = null
    flush()
  }, 500)
}

export function log(...parts: unknown[]): void {
  try {
    const text = parts
      .map((p) => {
        if (typeof p === 'string') return p
        try {
          return JSON.stringify(p)
        } catch {
          return String(p)
        }
      })
      .join(' ')
    buffer.push(`${new Date().toISOString()} ${text}\n`)
    if (buffer.length >= 120) flush()
    else schedule()
  } catch {
    // молча: логирование не должно ронять приложение
  }
}
