import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'

/**
 * Что пользователь попросил не показывать на главной. Хранится отдельно от
 * библиотеки: это настройка ленты, а не музыка, и сбросить её можно одной
 * кнопкой, не трогая лайки.
 */

interface Prefs {
  version: 1
  hidden: string[]
}

const FILE_VERSION = 1 as const

let cache: Prefs | null = null

function file(): string {
  return path.join(app.getPath('userData'), 'rec-prefs.json')
}

function load(): Prefs {
  if (cache) return cache
  try {
    const parsed = JSON.parse(fs.readFileSync(file(), 'utf8')) as Partial<Prefs>
    cache = {
      version: FILE_VERSION,
      hidden: Array.isArray(parsed.hidden) ? parsed.hidden.filter((x) => typeof x === 'string') : []
    }
  } catch {
    cache = { version: FILE_VERSION, hidden: [] }
  }
  return cache
}

function save(next: Prefs): void {
  cache = next
  try {
    const target = file()
    fs.writeFileSync(`${target}.tmp`, JSON.stringify(next), 'utf8')
    fs.renameSync(`${target}.tmp`, target)
  } catch {
    /* настройка не критична для работы плеера */
  }
}

export function hidden(): string[] {
  return [...load().hidden]
}

export function hide(sectionId: string): string[] {
  const id = String(sectionId ?? '')
  if (!id) return hidden()
  const current = load()
  if (current.hidden.includes(id)) return [...current.hidden]
  const next: Prefs = { version: FILE_VERSION, hidden: [...current.hidden, id] }
  save(next)
  return [...next.hidden]
}

export function unhide(sectionId: string): string[] {
  const current = load()
  const next: Prefs = { version: FILE_VERSION, hidden: current.hidden.filter((x) => x !== String(sectionId)) }
  save(next)
  return [...next.hidden]
}

/** Вернуть все скрытые секции. */
export function clearHidden(): string[] {
  save({ version: FILE_VERSION, hidden: [] })
  return []
}
