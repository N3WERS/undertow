import { memo, useEffect, useState } from 'react'
import type { Track, TrackVersion } from '../types'
import { fmtTime } from './TrackList'
import { IconLayers, IconPlus } from './Icons'

interface Props {
  track: Track
  versions: { loading: boolean; list: TrackVersion[] } | null
  copyLabel: string | null
  onPick: (v: TrackVersion) => void
  onAdd: (v: TrackVersion) => void
  onRestoreOriginal: () => void
}

/** Версии трека прямо в боковой панели полноэкранного плеера. */
export default memo(function TheaterVersions({
  track,
  versions,
  copyLabel,
  onPick,
  onAdd,
  onRestoreOriginal
}: Props) {
  const [filter, setFilter] = useState<string | null>(null)

  useEffect(() => setFilter(null), [versions, track.id])

  if (!versions) return <div className="tp-note">Загружаю версии…</div>

  const counts = new Map<string, number>()
  for (const v of versions.list) counts.set(v.label, (counts.get(v.label) ?? 0) + 1)
  const chips = [...counts.entries()].sort((a, b) => b[1] - a[1])
  const shown = versions.list.filter((v) => !filter || v.label === filter)

  return (
    <div className="tp-versions">
      {copyLabel ? (
        <button className="tp-restore" onClick={onRestoreOriginal}>
          <span className="tp-restore-title">↩ вернуть исходную запись</span>
          <span className="tp-restore-meta">играть оригинал из источника, а не копию</span>
        </button>
      ) : null}

      {versions.loading ? (
        <div className="tp-note">
          <span className="spinner" /> ищу ремиксы и каверы…
        </div>
      ) : versions.list.length === 0 ? (
        <div className="tp-note">Других версий не нашлось</div>
      ) : (
        <>
          <div className="tp-chips">
            <button className={`tp-chip${filter ? '' : ' on'}`} onClick={() => setFilter(null)}>
              все <i>{versions.list.length}</i>
            </button>
            {chips.map(([label, n]) => (
              <button
                key={label}
                className={`tp-chip${filter === label ? ' on' : ''}`}
                onClick={() => setFilter(filter === label ? null : label)}
              >
                {label} <i>{n}</i>
              </button>
            ))}
          </div>

          {shown.length === 0 ? (
            <div className="tp-note">
              В этой категории пусто —{' '}
              <button className="tp-link" onClick={() => setFilter(null)}>
                показать все
              </button>
            </div>
          ) : (
            <div className="tp-version-list">
              {shown.map((v) => (
                <div key={v.videoId} className="tp-version">
                  <button className="tp-vmain" onClick={() => onPick(v)}>
                    <span className="tp-vtitle">{v.title}</span>
                    <span className="tp-vmeta">
                      <span className="version-tag">{v.label}</span>
                      {v.channel} · {fmtTime(v.durationSec ?? 0)}
                    </span>
                  </button>
                  <button className="tp-add" onClick={() => onAdd(v)} title="Добавить версию в очередь">
                    <IconPlus width={13} height={13} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {versions.list.length === 0 && !versions.loading ? (
        <div className="tp-version-foot">
          <IconLayers width={14} height={14} />
          <span>Версии ищутся по YouTube Music</span>
        </div>
      ) : null}
    </div>
  )
})
