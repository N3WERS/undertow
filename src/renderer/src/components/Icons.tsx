import type { SVGProps } from 'react'

type P = SVGProps<SVGSVGElement>

const base = (p: P) => ({
  width: 18,
  height: 18,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.7,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  ...p
})

export const IconHome = (p: P) => (
  <svg {...base(p)}>
    <path d="M3.5 10.4 12 3.6l8.5 6.8V20a1 1 0 0 1-1 1h-5v-6h-5v6h-5a1 1 0 0 1-1-1z" />
  </svg>
)

export const IconSearch = (p: P) => (
  <svg {...base(p)}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="m16 16 4.5 4.5" />
  </svg>
)

export const IconWave = (p: P) => (
  <svg {...base(p)}>
    <path d="M3 12h2l2-6 3 13 3-16 3 12 2-4h3" />
  </svg>
)

export const IconRefresh = (p: P) => (
  <svg {...base(p)}>
    <path d="M20 12a8 8 0 1 1-2.6-5.9" />
    <path d="M20 4v4.5h-4.5" />
  </svg>
)

export const IconLibrary = (p: P) => (
  <svg {...base(p)}>
    <path d="M4 5v14M8.5 4v16M13 6.5v13M17.5 9v8.5M21 11v5" />
  </svg>
)

export const IconPlay = (p: P) => (
  <svg {...base({ ...p, fill: 'currentColor', stroke: 'none' })}>
    <path d="M8 5.2a1 1 0 0 1 1.53-.85l9 6.05a1 1 0 0 1 0 1.7l-9 6.05A1 1 0 0 1 8 17.3z" />
  </svg>
)

export const IconPause = (p: P) => (
  <svg {...base({ ...p, fill: 'currentColor', stroke: 'none' })}>
    <rect x="7" y="5" width="3.6" height="14" rx="1.2" />
    <rect x="13.4" y="5" width="3.6" height="14" rx="1.2" />
  </svg>
)

export const IconPrev = (p: P) => (
  <svg {...base({ ...p, fill: 'currentColor', stroke: 'none' })}>
    <rect x="4.5" y="6" width="2.2" height="12" rx="1" />
    <path d="M19 7.1v9.8a1 1 0 0 1-1.5.85l-7.6-4.9a1 1 0 0 1 0-1.7l7.6-4.9A1 1 0 0 1 19 7.1Z" />
  </svg>
)

export const IconNext = (p: P) => (
  <svg {...base({ ...p, fill: 'currentColor', stroke: 'none' })}>
    <rect x="17.3" y="6" width="2.2" height="12" rx="1" />
    <path d="M5 7.1v9.8a1 1 0 0 0 1.5.85l7.6-4.9a1 1 0 0 0 0-1.7L6.5 6.25A1 1 0 0 0 5 7.1Z" />
  </svg>
)

export const IconVolume = (p: P) => (
  <svg {...base(p)}>
    <path d="M4 9.5h3l4.5-3.6v12.2L7 14.5H4z" />
    <path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11" />
  </svg>
)

export const IconMute = (p: P) => (
  <svg {...base(p)}>
    <path d="M4 9.5h3l4.5-3.6v12.2L7 14.5H4z" />
    <path d="m16 9.5 4 4M20 9.5l-4 4" />
  </svg>
)

export const IconNote = (p: P) => (
  <svg {...base(p)}>
    <circle cx="7" cy="17.5" r="2.6" />
    <circle cx="17.5" cy="15.5" r="2.6" />
    <path d="M9.6 17.5V7.2l10.5-2.2v10.5" />
  </svg>
)

export const IconSettings = (p: P) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="3.1" />
    <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1.03 1.56V21a2 2 0 1 1-4 0v-.11a1.7 1.7 0 0 0-1.11-1.56 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.56-1.03H3a2 2 0 1 1 0-4h.11A1.7 1.7 0 0 0 4.6 8.94a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34H9a1.7 1.7 0 0 0 1.03-1.56V3a2 2 0 1 1 4 0v.11a1.7 1.7 0 0 0 1.03 1.56 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87V9a1.7 1.7 0 0 0 1.56 1.03H21a2 2 0 1 1 0 4h-.11a1.7 1.7 0 0 0-1.49.97z" />
  </svg>
)

export const IconSpark = (p: P) => (
  <svg {...base(p)}>
    <path d="M12 3.5l1.9 5.1 5.1 1.9-5.1 1.9L12 17.5l-1.9-5.1L5 10.5l5.1-1.9zM18.5 15.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z" />
  </svg>
)

export const IconHeart = ({ filled, ...p }: P & { filled?: boolean }) => (
  <svg {...base(p)} fill={filled ? 'currentColor' : 'none'}>
    <path d="M12 20.2s-7.3-4.4-7.3-9.1A4.1 4.1 0 0 1 12 8.3a4.1 4.1 0 0 1 7.3 2.8c0 4.7-7.3 9.1-7.3 9.1z" />
  </svg>
)

export const IconTrash = (p: P) => (
  <svg {...base(p)}>
    <path d="M4 7h16M9.5 7V5.5A1.5 1.5 0 0 1 11 4h2a1.5 1.5 0 0 1 1.5 1.5V7M6.5 7l.8 12a1.6 1.6 0 0 0 1.6 1.5h6.2a1.6 1.6 0 0 0 1.6-1.5L17.5 7" />
  </svg>
)

export const IconText = (p: P) => (
  <svg {...base(p)}>
    <path d="M5 6h14M12 6v12M9 18h6" />
  </svg>
)

export const IconList = (p: P) => (
  <svg {...base(p)}>
    <path d="M4 7h16M4 12h10M4 17h13" />
    <circle cx="18.4" cy="15.6" r="2.4" />
  </svg>
)

export const IconListPlus = (p: P) => (
  <svg {...base(p)}>
    <path d="M4 6.5h11M4 11.5h11M4 16.5h7" />
    <path d="M17.5 13v6M14.5 16h6" />
  </svg>
)

export const IconX = (p: P) => (
  <svg {...base(p)}>
    <path d="M6 6l12 12M18 6L6 18" />
  </svg>
)

export const IconQueue = (p: P) => (
  <svg {...base(p)}>
    <path d="M4 7h11M4 12h11M4 17h7" />
    <path d="M19 13.5v5.2M16.8 15.6 19 13.4l2.2 2.2" />
  </svg>
)

export const IconShuffle = (p: P) => (
  <svg {...base(p)}>
    <path d="M4 6.5h3.2l9.6 11h3.2M4 17.5h3.2l3-3.4M13.6 9.8l3.2-3.3h3.2" />
    <path d="M17.4 3.9l2.6 2.6-2.6 2.6M17.4 14.9l2.6 2.6-2.6 2.6" />
  </svg>
)

export const IconClose = (p: P) => (
  <svg {...base(p)}>
    <path d="M6 6l12 12M18 6 6 18" />
  </svg>
)

export const IconPlus = (p: P) => (
  <svg {...base(p)}>
    <path d="M12 5v14M5 12h14" />
  </svg>
)

export function IconDisc(P: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(P)}>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="2.4" />
    </svg>
  )
}

export function IconRadio(P: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(P)}>
      <circle cx="12" cy="12" r="2.2" />
      <path d="M7.8 7.8a6 6 0 0 0 0 8.4M16.2 16.2a6 6 0 0 0 0-8.4" />
      <path d="M5 5a10 10 0 0 0 0 14M19 19a10 10 0 0 0 0-14" />
    </svg>
  )
}
