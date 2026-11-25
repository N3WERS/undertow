import { useEffect, useRef, useState } from 'react'
import type { JSX } from 'react'

const W = 1000
const H = 316
const STEP = 6
const SHIMMER_PERIOD = 1200

/** Русло: та же кривая задаёт и впадину рельефа, и светлую линию реки. */
function valleyY(u: number): number {
  return 0.5 + 0.065 * Math.sin(u * 3.6 + 0.8) + 0.02 * Math.sin(u * 8.2 - 0.4)
}

/** Синтетический рельеф: речная впадина, два холма и лёгкая рябь. */
function heightAt(u: number, v: number): number {
  const d = (v - valleyY(u)) / 0.115
  const channel = -0.22 * Math.exp(-d * d)
  const hillA =
    0.13 * Math.exp(-(((u - 0.78) / 0.24) ** 2) - (((v - 0.18) / 0.18) ** 2))
  const hillB =
    0.1 * Math.exp(-(((u - 0.4) / 0.2) ** 2) - (((v - 0.82) / 0.2) ** 2))
  const hillC =
    0.075 * Math.exp(-(((u - 0.82) / 0.28) ** 2) - (((v - 0.9) / 0.22) ** 2))
  const ripple = 0.035 * Math.sin(u * 7.1 + v * 3.2) + 0.02 * Math.cos(u * 13.3 - v * 4.1)
  return 0.5 + channel + hillA + hillB + hillC + ripple
}

interface Pt {
  x: number
  y: number
}

function mix(a: number, b: number, level: number): number {
  const t = (level - a) / (b - a)
  return Number.isFinite(t) ? Math.max(0, Math.min(1, t)) : 0.5
}

function edgePoint(
  edge: 'top' | 'right' | 'bottom' | 'left',
  x: number,
  y: number,
  av: number,
  bv: number,
  cv: number,
  dv: number,
  level: number
): Pt {
  if (edge === 'top') return { x: x + STEP * mix(av, bv, level), y }
  if (edge === 'right') return { x: x + STEP, y: y + STEP * mix(bv, cv, level) }
  if (edge === 'bottom') return { x: x + STEP * mix(dv, cv, level), y: y + STEP }
  return { x, y: y + STEP * mix(av, dv, level) }
}

/**
 * Линии уровня настоящего (синтетического) рельефа. Считаются один раз при
 * загрузке модуля, поэтому в кадре не происходит никакой тяжёлой математики:
 * SVG только медленно сдвигается целиком.
 */
function buildContours(): string[] {
  const cols = Math.ceil(W / STEP) + 1
  const rows = Math.ceil(H / STEP) + 1
  const grid = new Float32Array(cols * rows)
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      grid[j * cols + i] = heightAt((i * STEP) / W, (j * STEP) / H)
    }
  }

  const levels: number[] = []
  for (let v = 0.24; v <= 0.721; v += 0.03) levels.push(v)

  return levels.map((level) => {
    let d = ''
    for (let j = 0; j < rows - 1; j++) {
      for (let i = 0; i < cols - 1; i++) {
        const x = i * STEP
        const y = j * STEP
        const a = grid[j * cols + i]!
        const b = grid[j * cols + i + 1]!
        const c = grid[(j + 1) * cols + i + 1]!
        const e = grid[(j + 1) * cols + i]!

        let idx = 0
        if (a > level) idx |= 1
        if (b > level) idx |= 2
        if (c > level) idx |= 4
        if (e > level) idx |= 8
        if (idx === 0 || idx === 15) continue

        const top = (): Pt => edgePoint('top', x, y, a, b, c, e, level)
        const right = (): Pt => edgePoint('right', x, y, a, b, c, e, level)
        const bottom = (): Pt => edgePoint('bottom', x, y, a, b, c, e, level)
        const left = (): Pt => edgePoint('left', x, y, a, b, c, e, level)
        const seg = (p: Pt, q: Pt): void => {
          d += `M${p.x.toFixed(1)} ${p.y.toFixed(1)}L${q.x.toFixed(1)} ${q.y.toFixed(1)}`
        }

        switch (idx) {
          case 1:
            seg(left(), top())
            break
          case 2:
            seg(top(), right())
            break
          case 3:
            seg(left(), right())
            break
          case 4:
            seg(right(), bottom())
            break
          case 5: {
            const center = (a + b + c + e) / 4
            if (center > level) {
              seg(left(), bottom())
              seg(top(), right())
            } else {
              seg(left(), top())
              seg(right(), bottom())
            }
            break
          }
          case 6:
            seg(top(), bottom())
            break
          case 7:
            seg(left(), bottom())
            break
          case 8:
            seg(bottom(), left())
            break
          case 9:
            seg(top(), bottom())
            break
          case 10: {
            const center = (a + b + c + e) / 4
            if (center > level) {
              seg(left(), top())
              seg(right(), bottom())
            } else {
              seg(left(), bottom())
              seg(top(), right())
            }
            break
          }
          case 11:
            seg(right(), bottom())
            break
          case 12:
            seg(left(), right())
            break
          case 13:
            seg(top(), right())
            break
          case 14:
            seg(left(), top())
            break
        }
      }
    }
    return d
  })
}

const CONTOURS = buildContours()

function riverPath(): string {
  let d = ''
  for (let i = 0; i <= 100; i++) {
    const u = i / 100
    const x = u * W
    const y = valleyY(u) * H
    d += `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`
  }
  return d
}

const RIVER = riverPath()

interface Props {
  /** поток уже запущен (даже если стоит на паузе) */
  started?: boolean
  /** прямо сейчас звучит: останавливаем фазу, а не перезапускаем её */
  playing?: boolean
}

export default function TopoField({ started = false, playing = false }: Props): JSX.Element {
  const svgRef = useRef<SVGSVGElement>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const [hidden, setHidden] = useState(() => typeof document !== 'undefined' && document.hidden)
  const [inView, setInView] = useState(true)

  const active = started && playing && !hidden && inView

  useEffect(() => {
    const onVisibility = () => setHidden(document.hidden)
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [])

  // «Течение» не должно рисоваться, когда герой ушёл за пределы экрана:
  // анимация остаётся на паузе и продолжается с того же места при возврате.
  useEffect(() => {
    const el = rootRef.current
    if (!el || typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver(([entry]) => setInView(entry.isIntersecting), { threshold: 0 })
    io.observe(el)
    return () => io.disconnect()
  }, [])

  // SMIL-анимация градиента не умеет animation-play-state: ставим её на паузу
  // через SVG API. Время при этом сохраняется, поэтому при resume нет прыжка.
  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    if (active) svg.unpauseAnimations()
    else svg.pauseAnimations()
  }, [active])

  return (
    <div
      ref={rootRef}
      className={`flow-topo${started ? ' is-on' : ''}${active ? ' is-playing' : ''}`}
      aria-hidden="true"
    >
      <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid slice">
        <defs>
          <linearGradient id="topo-line" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2={W} y2="0">
            <stop offset="0" stopColor="#5eead4" stopOpacity="0" />
            <stop offset="0.18" stopColor="#5eead4" stopOpacity="0.9" />
            <stop offset="0.52" stopColor="#7ceee6" stopOpacity="1" />
            <stop offset="0.82" stopColor="#93a8ff" stopOpacity="0.95" />
            <stop offset="1" stopColor="#c084fc" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="topo-river" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2={W} y2="0">
            <stop offset="0" stopColor="#5eead4" stopOpacity="0" />
            <stop offset="0.18" stopColor="#5eead4" stopOpacity="0.55" />
            <stop offset="0.6" stopColor="#b9fff7" stopOpacity="1" />
            <stop offset="0.92" stopColor="#93a8ff" stopOpacity="0.8" />
            <stop offset="1" stopColor="#93a8ff" stopOpacity="0" />
          </linearGradient>
          {/* Периодический градиент: за цикл сдвигается ровно на свою ширину,
              поэтому место сброса фазы выглядит точно как начало — без рывка. */}
          <linearGradient
            id="topo-shimmer"
            gradientUnits="userSpaceOnUse"
            spreadMethod="repeat"
            x1="0"
            y1="0"
            x2={SHIMMER_PERIOD}
            y2="0"
          >
            <stop offset="0" stopColor="#5eead4" stopOpacity="0" />
            <stop offset="0.18" stopColor="#5eead4" stopOpacity="0" />
            <stop offset="0.32" stopColor="#5eead4" stopOpacity="0.18" />
            <stop offset="0.44" stopColor="#b9fff7" stopOpacity="0.55" />
            <stop offset="0.5" stopColor="#ffffff" stopOpacity="0.95" />
            <stop offset="0.56" stopColor="#b9fff7" stopOpacity="0.55" />
            <stop offset="0.68" stopColor="#5eead4" stopOpacity="0.18" />
            <stop offset="0.82" stopColor="#5eead4" stopOpacity="0" />
            <stop offset="1" stopColor="#5eead4" stopOpacity="0" />
            <animateTransform
              attributeName="gradientTransform"
              type="translate"
              from="0 0"
              to={`${SHIMMER_PERIOD} 0`}
              dur="11.8s"
              repeatCount="indefinite"
            />
          </linearGradient>
        </defs>

        <g className="topo-drift">
          <g className="topo-contours">
            {CONTOURS.map((d, i) => (
              <path
                key={i}
                d={d}
                fill="none"
                stroke="url(#topo-line)"
                strokeWidth={i % 4 === 0 ? 1.45 : 0.9}
                strokeOpacity={i % 4 === 0 ? 0.7 : 0.46}
                strokeLinecap="round"
              />
            ))}
          </g>

          {/* река и подсветка рельефа проявляются только у запущенного потока */}
          <g className="topo-river">
            {/* 12 непустых изогипс: 6 сверху и 6 снизу от реки; тот же градиент,
                но заметно тише, чтобы главной оставалась центральная линия */}
            {CONTOURS.filter(Boolean).map((d, i) => (
              <path
                key={`shimmer-${i}`}
                d={d}
                fill="none"
                stroke="url(#topo-shimmer)"
                strokeWidth={i % 4 === 0 ? 1.45 : 0.9}
                strokeOpacity={i % 4 === 0 ? 0.72 : 0.5}
                strokeLinecap="round"
              />
            ))}
            <path d={RIVER} fill="none" stroke="#053b32" strokeWidth="40" strokeOpacity="0.15" />
            <path d={RIVER} fill="none" stroke="#064e3b" strokeWidth="18" strokeOpacity="0.13" />
            <path d={RIVER} fill="none" stroke="#047857" strokeWidth="7" strokeOpacity="0.09" />
            <path d={RIVER} fill="none" stroke="url(#topo-river)" strokeWidth="4.2" strokeOpacity="0.95" />
            <path
              className="topo-shimmer"
              d={RIVER}
              fill="none"
              stroke="url(#topo-shimmer)"
              strokeWidth="4.3"
              strokeOpacity="1"
              strokeLinecap="round"
            />
          </g>
        </g>
      </svg>
    </div>
  )
}
