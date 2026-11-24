import { useSyncExternalStore } from 'react'

export interface LiveProgress {
  time: number
  duration: number
  rms: number
}

let value: LiveProgress = { time: 0, duration: 0, rms: 0 }
const listeners = new Set<() => void>()

/**
 * Прогресс живёт отдельно от состояния App: иначе каждые 100 мс
 * перерисовывался бы весь экран, включая библиотеку на сотни строк,
 * и полоска начинала бы отставать от звука.
 */
export function setProgress(time: number, duration: number, rms: number): void {
  if (value.time === time && value.duration === duration && value.rms === rms) return
  value = { time, duration, rms }
  for (const listener of listeners) listener()
}

export function getProgress(): LiveProgress {
  return value
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useProgress(): LiveProgress {
  return useSyncExternalStore(subscribe, getProgress, getProgress)
}
