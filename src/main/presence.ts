/**
 * Discord Rich Presence — необязательная интеграция.
 * Client ID приложения Undertow зашит в сборку, пользователю остаётся тумблер.
 */
import { app } from 'electron'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { Client } from 'discord-rpc'

interface PresenceConfig {
  enabled: boolean
}

/** Публичный Application ID приложения Undertow в Discord. */
const DEFAULT_CLIENT_ID = '1575881202261426216'

interface PresenceTrack {
  playing: boolean
  title: string | null
  artist: string | null
  /** позиция внутри трека в секундах на момент отчёта */
  position?: number | null
}

let config: PresenceConfig = { enabled: false }
let loaded = false
let client: Client | null = null
let connecting = false
let connected = false
let lastKey = ''
let lastUpdate = 0
let current: PresenceTrack = { playing: false, title: null, artist: null }
/** стабильная точка старта: Discord сам считает время от неё */
let startedAt = 0
let lastTrackKey = ''

function configPath(): string {
  return path.join(app.getPath('userData'), 'discord.json')
}

function load(): void {
  if (loaded) return
  loaded = true
  try {
    const raw = JSON.parse(fs.readFileSync(configPath(), 'utf8')) as Partial<PresenceConfig>
    config = { enabled: Boolean(raw.enabled) }
  } catch {
    config = { enabled: false }
  }
}

function persist(): void {
  const tmp = `${configPath()}.tmp`
  void fsp
    .writeFile(tmp, JSON.stringify(config), 'utf8')
    .then(() => fsp.rename(tmp, configPath()))
    .catch(() => undefined)
}

export function getConfig(): PresenceConfig & { connected: boolean } {
  load()
  return { ...config, connected }
}

export async function setConfig(next: Partial<PresenceConfig>): Promise<PresenceConfig & { connected: boolean }> {
  load()
  config = { enabled: Boolean(next.enabled ?? config.enabled) }
  persist()
  if (!config.enabled) {
    await disconnect()
  } else {
    await connect()
  }
  return { ...getConfig(), connected }
}

export async function init(): Promise<void> {
  load()
  if (config.enabled) void connect()
}

function activity(): Record<string, unknown> | null {
  if (!current.title) return null
  const details = current.title.slice(0, 128)
  const state = current.artist ? current.artist.slice(0, 128) : undefined
  return {
    details,
    state,
    instance: false,
    largeImageKey: 'undertow',
    ...(current.playing && startedAt > 0 ? { startTimestamp: startedAt } : {})
  }
}

export function update(track: PresenceTrack): void {
  const trackKey = `${track.title ?? ''}|${track.artist ?? ''}`
  const now = Date.now()
  const wasPlaying = current.playing

  // новый трек или продолжение после паузы: фиксируем реальную точку старта.
  // Дальше startTimestamp не пересчитывается, поэтому Discord считает время ровно.
  if (trackKey !== lastTrackKey) {
    // новый трек всегда начинается с нуля; позиция из прошлого отчёта не нужна
    startedAt = now
    lastTrackKey = trackKey
  } else if (!wasPlaying && track.playing) {
    // продолжение после паузы: учитываем место, на котором остановились
    const position = Math.max(0, Number(track.position) || 0)
    startedAt = now - position * 1000
  }
  current = track

  if (!config.enabled || !connected || !client) return
  const key = `${track.title}|${track.artist}|${track.playing}`
  if (key === lastKey && now - lastUpdate < 15_000) return
  lastKey = key
  const payload = activity()
  lastUpdate = now
  if (!payload) void client.clearActivity().catch(() => undefined)
  else void setListening(payload).catch((e) => console.log('[presence]', e instanceof Error ? e.message : String(e)))
}

/** discord-rpc не пропускает type в SET_ACTIVITY, поэтому отправляем сами. */
async function setListening(payload: Record<string, unknown>): Promise<void> {
  if (!client) return
  const start = payload.startTimestamp
  await client.request('SET_ACTIVITY', {
    pid: process.pid,
    activity: {
      type: 2,
      details: payload.details,
      state: payload.state,
      instance: false,
      ...(payload.largeImageKey
        ? { assets: { large_image: payload.largeImageKey, large_text: payload.largeImageText } }
        : {}),
      ...(typeof start === 'number' ? { timestamps: { start } } : {})
    }
  })
}

async function connect(): Promise<void> {
  if (connecting || connected) return
  connecting = true
  try {
    if (!client) {
      client = new Client({ transport: 'ipc' })
      client.on('ready', () => {
        connected = true
        lastKey = ''
        update(current)
      })
      client.on('disconnected', () => {
        connected = false
      })
    }
    await client.login({ clientId: DEFAULT_CLIENT_ID })
    connected = true
  } catch {
    connected = false
  } finally {
    connecting = false
  }
}

async function disconnect(): Promise<void> {
  if (!client) return
  try {
    await client.clearActivity()
  } catch {
    /* уже отключён */
  }
  try {
    await client.destroy()
  } catch {
    /* уже отключён */
  }
  client = null
  connected = false
  lastKey = ''
}
