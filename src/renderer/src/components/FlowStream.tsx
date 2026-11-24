/** ПАРКОВКА: заготовка «реки из света». Не подключена к FlowView — оставлена как идея. */
import { useEffect, useRef } from 'react'

interface Props {
  active: boolean
  getEnergy?: () => number
}

const LANES = 6
const MOTES = 92

/** Цвета дорожек: от бирюзы к индиго и обратно — как слои воды. */
const COLORS: [number, number, number][] = [
  [94, 234, 212],
  [124, 238, 230],
  [147, 168, 255],
  [192, 132, 252],
  [94, 234, 212],
  [147, 168, 255]
]

interface Mote {
  lane: number
  u: number
  speed: number
  size: number
  bright: number
}

function rgba(c: [number, number, number], a: number): string {
  return `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${a.toFixed(3)})`
}

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

function makeMotes(): Mote[] {
  const list: Mote[] = []
  for (let i = 0; i < MOTES; i++) {
    list.push({
      lane: Math.floor(Math.random() * LANES),
      u: Math.random(),
      speed: 0.016 + Math.random() * 0.042,
      size: 0.7 + Math.random() * 1.5,
      bright: Math.random()
    })
  }
  return list
}

/**
 * «Течение» — не эквалайзер, а река из света.
 *
 * Шесть полупрозрачных лент уходят к дальней точке справа: ближние шире и
 * ярче, дальние сходятся в мягкое свечение. По лентам бегут частицы, поэтому
 * движение читается как непрерывный поток, а не как набор полос. Всё это
 * нарисовано вручную на canvas с перспективной проекцией — без three.js.
 */
export default function FlowStream({ active, getEnergy }: Props): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const activeRef = useRef(active)
  const energyRef = useRef(getEnergy)
  activeRef.current = active
  energyRef.current = getEnergy

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    let width = 1
    let height = 1
    let raf = 0
    let level = 0
    const motes = makeMotes()
    const start = performance.now()

    const resize = (): void => {
      const rect = canvas.getBoundingClientRect()
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      width = Math.max(1, rect.width)
      height = Math.max(1, rect.height)
      canvas.width = Math.round(width * dpr)
      canvas.height = Math.round(height * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }

    // точка на дорожке: u — от левого края (0) к горизонту (1)
    const point = (lane: number, u: number, t: number): { x: number; y: number; p: number; half: number } => {
      const p = 1 - 0.44 * u
      const body = 1 - 0.34 * u
      const base = (lane - (LANES - 1) / 2) * height * 0.062
      const wave =
        Math.sin(u * 6.2 + t * 0.72 + lane * 0.92) * height * 0.095 * body +
        Math.sin(u * 12.4 - t * 0.5 + lane * 1.7) * height * 0.03 * body
      const x = u * width
      const y = height * 0.53 + base * p + wave
      const twist = 0.68 + 0.32 * Math.sin(u * 4.1 + t * 0.55 + lane * 1.4)
      const half = (3.5 + 10 * Math.abs(Math.sin(lane * 1.3 + 0.4))) * p * twist
      return { x, y, p, half }
    }

    // мягкое тело реки: несколько вложенных полос создают объём и свечение
    const drawBody = (t: number, energy: number): void => {
      const layers = [
        { half: 0.23, alpha: 0.04 },
        { half: 0.165, alpha: 0.054 },
        { half: 0.1, alpha: 0.064 }
      ]
      for (const layer of layers) {
        const half = height * layer.half * (0.9 + energy * 0.18)
        ctx.fillStyle = `rgba(104, 239, 222, ${layer.alpha + energy * 0.015})`
        ctx.beginPath()
        for (let i = 0; i <= 48; i++) {
          const u = i / 48
          const x = u * width
          const y =
            height * 0.53 +
            Math.sin(u * 5.2 + t * 0.6) * height * 0.09 * (1 - 0.3 * u) +
            Math.sin(u * 9.6 - t * 0.4) * height * 0.022
          if (i === 0) ctx.moveTo(x, y - half)
          else ctx.lineTo(x, y - half)
        }
        for (let i = 48; i >= 0; i--) {
          const u = i / 48
          const x = u * width
          const y =
            height * 0.53 +
            Math.sin(u * 5.2 + t * 0.6) * height * 0.09 * (1 - 0.3 * u) +
            Math.sin(u * 9.6 - t * 0.4) * height * 0.022
          ctx.lineTo(x, y + half)
        }
        ctx.closePath()
        ctx.fill()
      }
    }

    const drawRibbon = (lane: number, t: number, energy: number): void => {
      const c = COLORS[lane]
      const alpha = (0.46 + energy * 0.18) * (0.82 + 0.18 * Math.sin(lane * 1.9))
      const grad = ctx.createLinearGradient(0, 0, width, 0)
      grad.addColorStop(0, rgba(c, 0))
      grad.addColorStop(0.1, rgba(c, alpha * 0.28))
      grad.addColorStop(0.4, rgba(c, alpha))
      grad.addColorStop(0.8, rgba(c, alpha * 0.9))
      grad.addColorStop(0.98, rgba(c, alpha * 0.28))
      grad.addColorStop(1, rgba(c, 0))
      ctx.fillStyle = grad

      const steps = 60
      ctx.beginPath()
      for (let i = 0; i <= steps; i++) {
        const q = point(lane, i / steps, t + lane * 0.42)
        if (i === 0) ctx.moveTo(q.x, q.y - q.half)
        else ctx.lineTo(q.x, q.y - q.half)
      }
      for (let i = steps; i >= 0; i--) {
        const q = point(lane, i / steps, t + lane * 0.42)
        ctx.lineTo(q.x, q.y + q.half)
      }
      ctx.closePath()
      ctx.fill()

      // светлый верхний край даёт ленте объём, как у стеклянной поверхности
      ctx.strokeStyle = rgba(c, 0.13 + energy * 0.1)
      ctx.lineWidth = 0.9
      ctx.beginPath()
      for (let i = 0; i <= steps; i++) {
        const q = point(lane, i / steps, t + lane * 0.42)
        if (i === 0) ctx.moveTo(q.x, q.y - q.half)
        else ctx.lineTo(q.x, q.y - q.half)
      }
      ctx.stroke()

      // тонкий гребень: он собирает ленту в одну светящуюся нить
      if (lane % 2 === 0) {
        ctx.strokeStyle = rgba(c, 0.16 + energy * 0.14)
        ctx.lineWidth = 1.1
        ctx.beginPath()
        for (let i = 0; i <= steps; i++) {
          const q = point(lane, i / steps, t + lane * 0.42)
          if (i === 0) ctx.moveTo(q.x, q.y)
          else ctx.lineTo(q.x, q.y)
        }
        ctx.stroke()
      }
    }

    const drawMote = (m: Mote, t: number, energy: number): void => {
      const u = (m.u + t * m.speed) % 1
      const fade = smoothstep(0, 0.05, u) * (1 - smoothstep(0.88, 1, u))
      if (fade <= 0.01) return
      const q = point(m.lane, u, t + m.lane * 0.42)
      const r = (0.65 + m.size * q.p) * (1 + energy * 0.35)
      const c = COLORS[m.lane]

      const prev = point(m.lane, Math.max(0, u - 0.014), t + m.lane * 0.42)
      ctx.strokeStyle = rgba(c, 0.16 * fade)
      ctx.lineWidth = r
      ctx.beginPath()
      ctx.moveTo(prev.x, prev.y)
      ctx.lineTo(q.x, q.y)
      ctx.stroke()

      ctx.fillStyle = rgba(c, 0.07 * fade)
      ctx.beginPath()
      ctx.arc(q.x, q.y, r * 2.6, 0, Math.PI * 2)
      ctx.fill()

      ctx.fillStyle = `rgba(236, 255, 252, ${(0.34 + m.bright * 0.4) * fade})`
      ctx.beginPath()
      ctx.arc(q.x, q.y, r, 0, Math.PI * 2)
      ctx.fill()
    }

    const paint = (now: number): void => {
      const target = activeRef.current ? Math.min(1, (energyRef.current?.() ?? 0) * 1.8) : 0
      level += (target - level) * 0.08
      const t = ((now - start) / 1000) * (1 + level * 0.9)

      ctx.clearRect(0, 0, width, height)
      ctx.globalCompositeOperation = 'lighter'

      // свет реки растекается по карточке, а не висит тонкой полосой
      const ambient = ctx.createRadialGradient(
        width * 0.64,
        height * 0.52,
        0,
        width * 0.64,
        height * 0.52,
        width * 0.62
      )
      ambient.addColorStop(0, `rgba(94, 234, 212, ${0.055 + level * 0.04})`)
      ambient.addColorStop(0.45, 'rgba(111, 140, 255, 0.035)')
      ambient.addColorStop(1, 'rgba(111, 140, 255, 0)')
      ctx.fillStyle = ambient
      ctx.fillRect(0, 0, width, height)

      const glow = ctx.createRadialGradient(
        width * 0.91,
        height * 0.5,
        0,
        width * 0.91,
        height * 0.5,
        Math.max(width, height) * 0.52
      )
      glow.addColorStop(0, `rgba(94, 234, 212, ${0.2 + level * 0.1})`)
      glow.addColorStop(0.26, 'rgba(111, 140, 255, 0.07)')
      glow.addColorStop(1, 'rgba(111, 140, 255, 0)')
      ctx.fillStyle = glow
      ctx.fillRect(0, 0, width, height)

      drawBody(t, level)
      for (let lane = 0; lane < LANES; lane++) drawRibbon(lane, t, level)
      for (const m of motes) drawMote(m, t, level)

      ctx.globalCompositeOperation = 'source-over'
      if (!reduced) raf = requestAnimationFrame(paint)
    }

    const observer = new ResizeObserver(resize)
    observer.observe(canvas)
    resize()
    paint(performance.now())

    return () => {
      cancelAnimationFrame(raf)
      observer.disconnect()
    }
  }, [])

  return <canvas className="flow-canvas" ref={canvasRef} aria-hidden="true" />
}
