/**
 * 10-полосный эквалайзер Undertow.
 *
 * Частоты — стандартная сетка графического EQ. Настройки живут в
 * localStorage и применяются к общему тракту Web Audio: и Яндекс, и YouTube,
 * и локальные копии звучат через одни и те же фильтры.
 */
export const EQ_BANDS = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000] as const
export const EQ_MIN = -12
export const EQ_MAX = 12
export const EQ_DEFAULT_PREAMP = 0

export interface EqSettings {
  enabled: boolean
  /** запас по громкости перед фильтрами, дБ: 0…−12 */
  preamp: number
  /** усиление каждой полосы, дБ: −12…+12 */
  gains: number[]
}

export interface EqPreset {
  id: string
  label: string
  gains: number[]
}

export const EQ_PRESETS: EqPreset[] = [
  { id: 'flat', label: 'Ровно', gains: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
  { id: 'bass', label: 'Бас', gains: [6, 5, 3, 1, 0, 0, 0, 0, 0, 0] },
  { id: 'vocal', label: 'Вокал', gains: [-2, -1, 0, 1, 3, 4, 3, 1, 0, -1] },
  { id: 'rock', label: 'Рок', gains: [4, 3, 1, -1, -1, 1, 2, 3, 4, 4] },
  { id: 'electronic', label: 'Электроника', gains: [5, 4, 2, 0, -1, 1, 2, 4, 5, 4] }
]

export const DEFAULT_EQ: EqSettings = {
  enabled: false,
  preamp: EQ_DEFAULT_PREAMP,
  gains: EQ_BANDS.map(() => 0)
}

export function clampEq(input: Partial<EqSettings> | null | undefined): EqSettings {
  const preamp = Number(input?.preamp)
  const gains = Array.isArray(input?.gains) ? input.gains : []
  return {
    enabled: Boolean(input?.enabled),
    preamp: Number.isFinite(preamp) ? Math.max(-12, Math.min(0, Math.round(preamp))) : 0,
    gains: EQ_BANDS.map((_, i) => {
      const value = Number(gains[i])
      return Number.isFinite(value) ? Math.max(EQ_MIN, Math.min(EQ_MAX, Math.round(value))) : 0
    })
  }
}

export function loadEq(): EqSettings {
  try {
    const raw = localStorage.getItem('undertow.eq')
    if (!raw) return clampEq(DEFAULT_EQ)
    return clampEq(JSON.parse(raw) as Partial<EqSettings>)
  } catch {
    return clampEq(DEFAULT_EQ)
  }
}

export function saveEq(eq: EqSettings): void {
  try {
    localStorage.setItem('undertow.eq', JSON.stringify(eq))
  } catch {
    /* приватный режим или переполненное хранилище — настройки просто не запомнятся */
  }
}

export function presetFor(gains: number[]): EqPreset | null {
  return (
    EQ_PRESETS.find((preset) => preset.gains.every((value, i) => value === (gains[i] ?? 0))) ?? null
  )
}

export function bandLabel(hz: number): string {
  return hz >= 1000 ? `${hz / 1000}к` : String(hz)
}
