import { useSyncExternalStore } from 'react'
import type { OfflineEntry, OfflineProgress, Track } from './types'
import { notify } from './notify'

export interface OfflineState {
  ready: boolean
  items: OfflineEntry[]
  ids: Set<string>
  bytes: number
  /** id → текущий прогресс скачивания */
  progress: Record<string, OfflineProgress>
  error: string | null
}

let state: OfflineState = {
  ready: false,
  items: [],
  ids: new Set(),
  bytes: 0,
  progress: {},
  error: null
}

const listeners = new Set<() => void>()

function emit(next: OfflineState): void {
  state = next
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function getSnapshot(): OfflineState {
  return state
}

export function useOffline(): OfflineState {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

let loading: Promise<void> | null = null

export function refreshOffline(): Promise<void> {
  if (loading) return loading
  loading = window.undertow
    .offlineList()
    .then((snap) => {
      emit({
        ...state,
        ready: true,
        items: snap.items,
        ids: new Set(snap.items.map((e) => e.track.id)),
        bytes: snap.bytes,
        error: null
      })
    })
    .catch((e: unknown) => {
      emit({ ...state, ready: true, error: e instanceof Error ? e.message : String(e) })
    })
    .finally(() => {
      loading = null
    })
  return loading
}

// прогресс приходит из main даже если список треков ещё не открывали
window.undertow.onOfflineProgress((p) => {
  const progress = { ...state.progress }
  if (p.status === 'error') {
    delete progress[p.id]
    emit({ ...state, progress, error: p.error ?? 'Не удалось сохранить трек' })
    return
  }
  if (p.status === 'done') {
    delete progress[p.id]
    emit({ ...state, progress })
    void refreshOffline()
    return
  }
  progress[p.id] = p
  emit({ ...state, progress })
})

/** Сохраняет трек локально. Бросает ошибку, чтобы вызывающий показал её в тосте. */
export async function saveTrack(track: Track): Promise<OfflineEntry> {
  emit({
    ...state,
    progress: {
      ...state.progress,
      [track.id]: { id: track.id, received: 0, total: 0, percent: null, status: 'downloading' }
    }
  })
  try {
    const entry = await window.undertow.offlineSave(track)
    const progress = { ...state.progress }
    delete progress[track.id]
    emit({ ...state, progress })
    await refreshOffline()
    notify(`Сохранено локально: ${track.artist} — ${track.title}`)
    return entry
  } catch (e) {
    const progress = { ...state.progress }
    delete progress[track.id]
    const message = e instanceof Error ? e.message : String(e)
    emit({ ...state, progress, error: message })
    notify(`Не удалось сохранить: ${message}`, 'error')
    throw e
  }
}

export async function removeOffline(id: string): Promise<boolean> {
  const ok = await window.undertow.offlineRemove(id)
  await refreshOffline()
  if (ok) notify('Локальная копия удалена')
  return ok
}

export async function clearOffline(): Promise<number> {
  const n = await window.undertow.offlineClear()
  await refreshOffline()
  if (n) notify(`Удалено копий: ${n}`)
  return n
}

export function fmtBytes(bytes: number): string {
  if (!bytes) return '0 МБ'
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} КБ`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} ГБ`
}

void refreshOffline()
