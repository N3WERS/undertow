import { app } from 'electron'
import { appendFileSync, existsSync, mkdirSync, renameSync, statSync } from 'node:fs'
import { join } from 'node:path'

let file: string | null = null

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

export function log(...parts: unknown[]): void {
  try {
    const path = logFile()
    rotate(path)
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
    appendFileSync(path, `${new Date().toISOString()} ${text}\n`, 'utf8')
  } catch {
    // молча: логирование не должно ронять приложение
  }
}
