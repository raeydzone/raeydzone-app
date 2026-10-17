import { BUNDLED_FONTS } from '@shared/studio'
import './fonts.css'

export interface FontFamily {
  name: string
  weights: number[]
  bundled: boolean
}

interface LocalFace {
  family: string
  style: string
}

const BUNDLED_WEIGHTS: Record<string, number[]> = {
  Montserrat: [100, 200, 300, 400, 500, 600, 700, 800, 900],
  Oswald: [200, 300, 400, 500, 600, 700]
}

const FALLBACK_SYSTEM = ['Impact', 'Arial Black', 'Segoe UI', 'Arial']

const STYLE_WEIGHTS: [RegExp, number][] = [
  [/thin|hairline/, 100],
  [/(extra|ultra)\s*light/, 200],
  [/(semi|demi)\s*light/, 350],
  [/light/, 300],
  [/medium/, 500],
  [/(semi|demi)\s*bold/, 600],
  [/(extra|ultra)\s*bold/, 800],
  [/black|heavy/, 900],
  [/bold/, 700]
]

export const WEIGHT_NAMES: Record<number, string> = {
  100: 'Thin', 200: 'Extra light', 300: 'Light', 350: 'Semilight', 400: 'Regular', 500: 'Medium',
  600: 'Semibold', 700: 'Bold', 800: 'Extra bold', 900: 'Black'
}

function weightOf(style: string): number {
  const s = style.toLowerCase()
  return STYLE_WEIGHTS.find(([re]) => re.test(s))?.[1] ?? 400
}

let families: FontFamily[] = BUNDLED_FONTS.map((name) => ({
  name, weights: BUNDLED_WEIGHTS[name] ?? [400], bundled: true
}))
let byName = new Map(families.map((f) => [f.name.toLowerCase(), f]))
let loading: Promise<void> | null = null

async function systemFaces(): Promise<LocalFace[]> {
  const query = (window as unknown as { queryLocalFonts?: () => Promise<LocalFace[]> }).queryLocalFonts
  if (!query) return FALLBACK_SYSTEM.map((family) => ({ family, style: 'Regular' }))
  try {
    return await query()
  } catch {
    return FALLBACK_SYSTEM.map((family) => ({ family, style: 'Regular' }))
  }
}

export function loadFonts(): Promise<void> {
  loading ??= (async () => {
    await Promise.all(BUNDLED_FONTS.map((f) => document.fonts.load(`400 100px "${f}"`).catch(() => [])))
    const system = new Map<string, Set<number>>()
    for (const face of await systemFaces()) {
      if (byName.has(face.family.toLowerCase())) continue
      const set = system.get(face.family) ?? new Set<number>()
      set.add(weightOf(face.style))
      system.set(face.family, set)
    }
    const installed = [...system.entries()]
      .map(([name, set]) => ({ name, weights: [...set].sort((a, b) => a - b), bundled: false }))
      .sort((a, b) => a.name.localeCompare(b.name))
    families = [...families.filter((f) => f.bundled), ...installed]
    byName = new Map(families.map((f) => [f.name.toLowerCase(), f]))
  })()
  return loading
}

export function fontFamilies(): FontFamily[] {
  return families
}

export function findFont(name: string): FontFamily | null {
  return byName.get(name.trim().toLowerCase()) ?? null
}

// Asking for a weight a family does not have makes Chromium smear a synthetic bold, so
// snap to the closest real face instead.
export function nearestWeight(name: string, weight: number): number {
  const weights = findFont(name)?.weights
  if (!weights?.length) return weight
  return weights.reduce((best, w) => (Math.abs(w - weight) < Math.abs(best - weight) ? w : best))
}
