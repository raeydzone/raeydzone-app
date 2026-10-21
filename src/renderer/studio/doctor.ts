import { SAFE_ZONES } from '@shared/studio'
import type { Layer, StudioDoc, TextLayer } from '@shared/studio'
import { boundsOfAlpha, dilate, erode, subtract } from './alpha'
import { canvas, ctx2d } from './assets'
import type { AssetStore } from './assets'
import { boundsOf } from './doc'
import type { Bounds } from './doc'
import { drawLayer, renderDoc } from './render'

export interface Issue {
  id: string
  level: 'warn' | 'tip'
  layer: string | null
  title: string
  detail: string
}

// The narrowest place a thumbnail shows up: the sidebar of the watch page.
export const SMALLEST = 210

const channel = (v: number): number => {
  const c = v / 255
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
}
const luminance = ([r, g, b]: number[]): number => 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)

export function contrastRatio(a: number[], b: number[]): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

function alone(doc: StudioDoc, l: Layer, assets: AssetStore): HTMLCanvasElement {
  const out = canvas(doc.width, doc.height)
  drawLayer(ctx2d(out), { ...l, opacity: 1, blend: 'normal' } as Layer, assets, doc)
  return out
}

function meanWhere(px: HTMLCanvasElement, where: HTMLCanvasElement, box: Bounds): number[] | null {
  const x = Math.max(0, Math.floor(box.x))
  const y = Math.max(0, Math.floor(box.y))
  const w = Math.min(px.width - x, Math.ceil(box.width))
  const h = Math.min(px.height - y, Math.ceil(box.height))
  if (w <= 0 || h <= 0) return null
  const a = ctx2d(px).getImageData(x, y, w, h).data
  const m = ctx2d(where).getImageData(x, y, w, h).data
  const sum = [0, 0, 0]
  let n = 0
  for (let i = 0; i < a.length; i += 4) {
    const k = (m[i + 3] / 255) * (a[i + 3] / 255)
    if (k < 0.5) continue
    sum[0] += a[i] * k
    sum[1] += a[i + 1] * k
    sum[2] += a[i + 2] * k
    n += k
  }
  return n > 20 ? sum.map((v) => v / n) : null
}

const grown = (b: Bounds, by: number): Bounds => ({ x: b.x - by, y: b.y - by, width: b.width + by * 2, height: b.height + by * 2 })

function overlap(a: Bounds, b: Bounds): number {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)
  return w > 0 && h > 0 ? w * h : 0
}

const label = (l: Layer): string => (l.kind === 'text' ? `“${l.text.replace(/\*/g, '').slice(0, 24)}”` : l.name)

// What a text's outermost pixels sit on decides whether it reads: its outer edge (an
// outline if it has one) is compared with the scene just outside it.
function textContrast(doc: StudioDoc, t: TextLayer, assets: AssetStore): number | null {
  const index = doc.layers.indexOf(t)
  const below = renderDoc({ ...doc, layers: doc.layers.slice(0, index) }, assets)
  const mine = alone(doc, t, assets)
  const box = boundsOfAlpha(mine)
  if (!box) return null
  const edge = subtract(mine, erode(mine, 3))
  const ring = subtract(dilate(mine, 8), mine)
  const fg = meanWhere(mine, edge, box)
  const bg = meanWhere(below, ring, grown(box, 10))
  return fg && bg ? contrastRatio(fg, bg) : null
}

function coverIn(px: HTMLCanvasElement, zone: Bounds): number {
  const x = Math.max(0, Math.floor(zone.x))
  const y = Math.max(0, Math.floor(zone.y))
  const w = Math.min(px.width - x, Math.ceil(zone.width))
  const h = Math.min(px.height - y, Math.ceil(zone.height))
  if (w <= 0 || h <= 0) return 0
  const d = ctx2d(px).getImageData(x, y, w, h).data
  let n = 0
  for (let i = 3; i < d.length; i += 4) if (d[i] > 64) n++
  return n / (w * h)
}

function flatness(doc: StudioDoc, assets: AssetStore): number {
  const small = canvas(160, 90)
  const g = ctx2d(small)
  g.drawImage(renderDoc(doc, assets), 0, 0, 160, 90)
  const d = g.getImageData(0, 0, 160, 90).data
  const ls: number[] = []
  for (let i = 0; i < d.length; i += 4) ls.push((0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) / 255)
  const mean = ls.reduce((a, b) => a + b, 0) / ls.length
  return Math.sqrt(ls.reduce((a, b) => a + (b - mean) ** 2, 0) / ls.length)
}

export function diagnose(doc: StudioDoc, assets: AssetStore): Issue[] {
  const issues: Issue[] = []
  const add = (level: Issue['level'], layer: Layer | null, key: string, title: string, detail: string): void => {
    issues.push({ id: key + (layer?.id ?? ''), level, layer: layer?.id ?? null, title, detail })
  }
  const visible = doc.layers.filter((l) => l.visible && l.kind !== 'adjust')
  const texts = visible.filter((l): l is TextLayer => l.kind === 'text')
  const zone = (id: string): Bounds => {
    const z = SAFE_ZONES.find((s) => s.id === id)!
    return { x: z.x * doc.width, y: z.y * doc.height, width: z.w * doc.width, height: z.h * doc.height }
  }

  const words = texts.reduce((n, t) => n + t.text.replace(/\*/g, '').split(/\s+/).filter(Boolean).length, 0)
  if (words > 6) add('tip', null, 'words', `${words} words of text`, 'Thumbnails read best with five words or fewer — the title already says the rest.')

  for (const t of texts) {
    const b = boundsOf([t])
    const shown = (t.size * SMALLEST) / doc.width
    if (shown < 12) {
      add('warn', t, 'small', `${label(t)} is too small to read`, `It is ${shown.toFixed(1)}px tall at ${SMALLEST}px wide, where YouTube shows suggested videos. Aim for 12px or more there.`)
    }
    if (b.x < -2 || b.y < -2 || b.x + b.width > doc.width + 2 || b.y + b.height > doc.height + 2) {
      add('warn', t, 'cut', `${label(t)} runs off the canvas`, 'Part of the text is cut off at the edge.')
    }
    if (overlap(b, zone('length')) > b.width * b.height * 0.03) {
      add('warn', t, 'badge', `${label(t)} sits under the video length`, 'YouTube covers the bottom-right corner with the length badge.')
    }
    const ratio = textContrast(doc, t, assets)
    if (ratio !== null && ratio < 1.8) {
      add('warn', t, 'contrast', `${label(t)} blends into the background`, `Contrast is ${ratio.toFixed(1)}:1 at its edge. An outline, a shadow or a darker area behind it makes it pop.`)
    }
  }

  // A cut-out person's face sits in the upper part of the cut-out, so that is where
  // anything stacked above it is checked.
  visible.forEach((subject) => {
    if (subject.kind !== 'image' || !subject.mask) return
    const box = boundsOfAlpha(alone(doc, subject, assets))
    if (!box) return
    const face = { x: box.x + box.width * 0.2, y: box.y, width: box.width * 0.6, height: box.height * 0.38 }
    for (const l of doc.layers.slice(doc.layers.indexOf(subject) + 1)) {
      if (!l.visible || (l.kind !== 'text' && l.kind !== 'shape')) continue
      if (!overlap(boundsOf([l]), face)) continue
      if (coverIn(alone(doc, l, assets), face) > 0.12) {
        add('warn', l, 'face' + subject.id, `${label(l)} may cover the face of ${subject.name}`, 'Faces sell a thumbnail; keep text and shapes off them.')
      }
    }
  })

  if (visible.length && flatness(doc, assets) < 0.12) {
    add('tip', null, 'flat', 'The thumbnail looks flat', 'Little contrast between light and dark. Try a look, curves or a stronger background.')
  }
  return issues
}
