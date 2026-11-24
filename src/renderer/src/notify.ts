export type NoticeKind = 'info' | 'error'

type Listener = (text: string, kind: NoticeKind) => void
const listeners = new Set<Listener>()

/** Маленькая шина уведомлений: любой модуль может попросить App показать тост. */
export function notify(text: string, kind: NoticeKind = 'info'): void {
  for (const listener of listeners) listener(text, kind)
}

export function onNotify(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
