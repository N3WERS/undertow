import { useEffect, useRef } from 'react'
import type { JSX } from 'react'
import { IconClose, IconShrink, IconWave, IconX } from './Icons'

interface Props {
  onTray: () => void
  onQuit: () => void
  onCancel: () => void
}

export default function CloseDialog({ onTray, onQuit, onCancel }: Props): JSX.Element {
  const primary = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    primary.current?.focus()
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopPropagation()
      onCancel()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onCancel])

  return (
    <div
      className="close-layer"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCancel()
      }}
    >
      <div
        className="close-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="close-title"
        aria-describedby="close-copy"
      >
        <div className="close-halo" aria-hidden="true" />

        <div className="close-top">
          <span className="close-brand">
            <span className="close-dot" />
            Undertow
          </span>
          <button className="close-x" onClick={onCancel} title="Остаться" aria-label="Остаться">
            <IconClose width={14} height={14} />
          </button>
        </div>

        <div className="close-mark" aria-hidden="true">
          <IconWave width={22} height={22} />
        </div>
        <h2 className="close-title" id="close-title">
          Закрыть Undertow?
        </h2>
        <p className="close-copy" id="close-copy">
          Музыка продолжит играть, если свернуть в трей. Полный выход остановит воспроизведение.
        </p>

        <div className="close-actions">
          <button ref={primary} className="close-primary" onClick={onTray}>
            <IconShrink width={15} height={15} />
            Свернуть в трей
          </button>
          <button className="close-danger" onClick={onQuit}>
            <IconX width={14} height={14} />
            Закрыть приложение
          </button>
        </div>
        <button className="close-cancel" onClick={onCancel}>
          Остаться
        </button>

        <div className="close-hint">
          <span>Esc</span> — вернуться в плеер
        </div>
      </div>
    </div>
  )
}
