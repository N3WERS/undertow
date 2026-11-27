import { useSyncExternalStore } from 'react'
import type { DownloadsSnapshot, Track } from './types'

let state: DownloadsSnapshot = { items: [], paused: false, active: 0, queued: 0, errors: 0 }
const listeners = new Set<() => void>()
let loading: Promise<void> | null = null

function emit(next: DownloadsSnapshot): void {
  state = next
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function getSnapshot(): DownloadsSnapshot {
  return state
}

export function useDownloads(): DownloadsSnapshot {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

window.undertow.onDownloadsState((next) => emit(next))

export function refreshDownloads(): Promise<void> {
  if (loading) return loading
  loading = window.undertow
    .downloadsList()
    .then(emit)
    .catch(() => undefined)
    .finally(() => {
      loading = null
    })
  return loading
}

export function enqueueDownloads(tracks: Track[]): Promise<DownloadsSnapshot> {
  return window.undertow.downloadsEnqueue(tracks).then((snapshot) => {
    emit(snapshot)
    return snapshot
  })
}

export function pauseDownloads(): Promise<DownloadsSnapshot> {
  return window.undertow.downloadsPause().then((snapshot) => {
    emit(snapshot)
    return snapshot
  })
}

export function resumeDownloads(): Promise<DownloadsSnapshot> {
  return window.undertow.downloadsResume().then((snapshot) => {
    emit(snapshot)
    return snapshot
  })
}

export function retryDownload(id: string): Promise<DownloadsSnapshot> {
  return window.undertow.downloadsRetry(id).then((snapshot) => {
    emit(snapshot)
    return snapshot
  })
}

export function removeDownload(id: string): Promise<DownloadsSnapshot> {
  return window.undertow.downloadsRemove(id).then((snapshot) => {
    emit(snapshot)
    return snapshot
  })
}

export function clearFinishedDownloads(): Promise<DownloadsSnapshot> {
  return window.undertow.downloadsClearFinished().then((snapshot) => {
    emit(snapshot)
    return snapshot
  })
}
