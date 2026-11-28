import { useEffect, useState, useSyncExternalStore } from 'react'

export interface LiveProgress {
  time: number
  duration: number
  rms: number
  /** трек, к которому относится время: не даёт полоске показать старый прогресс */
  trackId?: string | null
}

let value: LiveProgress = { time: 0, duration: 0, rms: 0, trackId: null }
const listeners = new Set<() => void>()

/**
 * Прогресс живёт отдельно от состояния App: иначе каждые 100 мс
 * перерисовывался бы весь экран, включая библиотеку на сотни строк,
 * и полоска начинала бы отставать от звука.
 */
export function setProgress(
  time: number,
  duration: number,
  rms: number,
  trackId?: string | null
): void {
  const nextId = trackId === undefined ? value.trackId : trackId
  if (
    value.time === time &&
    value.duration === duration &&
    value.rms === rms &&
    value.trackId === nextId
  ) {
    return
  }
  value = { time, duration, rms, trackId: nextId }
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


/** Для мини-плеера и текста: тот же прогресс, но без 10 перерисовок в секунду. */
export function useProgressSlow(stepMs = 250): LiveProgress {
  const [value, setValue] = useState(getProgress)
  useEffect(() => {
    let last = 0
    return subscribe(() => {
      const now = performance.now()
      if (now - last < stepMs) return
      last = now
      setValue(getProgress())
    })
  }, [stepMs])
  return value
}
