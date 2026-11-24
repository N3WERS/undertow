/**
 * Хранилище секретов: %APPDATA%/Undertow/secrets.json
 * Токен Яндекса шифруем через safeStorage (на Windows это DPAPI),
 * чтобы он не лежал в открытом виде на диске.
 */
import { app, safeStorage } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

interface SecretsFile {
  /** base64 от safeStorage.encryptString(token) */
  yandexTokenEnc?: string
  /** запасной вариант, если шифрование недоступно */
  yandexTokenPlain?: string
}

function secretsPath(): string {
  return join(app.getPath('userData'), 'secrets.json')
}

function read(): SecretsFile {
  try {
    const raw = readFileSync(secretsPath(), 'utf8')
    return JSON.parse(raw) as SecretsFile
  } catch {
    return {}
  }
}

function write(data: SecretsFile): void {
  const file = secretsPath()
  const dir = dirname(file)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(file, JSON.stringify(data, null, 2), { encoding: 'utf8', mode: 0o600 })
}

export function getYandexToken(): string | null {
  const data = read()
  if (data.yandexTokenEnc) {
    try {
      return safeStorage.decryptString(Buffer.from(data.yandexTokenEnc, 'base64'))
    } catch {
      return null
    }
  }
  return data.yandexTokenPlain ?? null
}

export function setYandexToken(token: string | null): void {
  const data = read()
  delete data.yandexTokenEnc
  delete data.yandexTokenPlain
  if (token) {
    if (safeStorage.isEncryptionAvailable()) {
      data.yandexTokenEnc = safeStorage.encryptString(token).toString('base64')
    } else {
      data.yandexTokenPlain = token
    }
  }
  write(data)
}
