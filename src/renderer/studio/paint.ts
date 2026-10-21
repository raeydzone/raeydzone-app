import type { Layer } from '@shared/studio'
import { colorize, intersect } from './alpha'
import { canvas, ctx2d } from './assets'
import type { Studio } from './engine'
import { findLayer, makeImage } from './doc'
import { renderDoc } from './render'
import { docToLayer } from './warp'

export type Pt = [number, number]
export type PaintMode = 'brush' | 'erase' | 'clone' | 'heal'

export interface Stroke {
  mode: PaintMode
  points: Pt[]
  radius: number
  color: string
  opacity: number
  hardness: number
  source?: Pt | null
}

export async function newPaintLayer(studio: Studio, variantId: string): Promise<Layer> {
  const doc = studio.doc(variantId)
  const info = await studio.assets.addCanvas(canvas(doc.width, doc.height), 'Paint', 'paint')
  studio.addAsset(info)
  const layer = { ...makeImage(doc, info, 'cover'), name: 'Paint' }
  studio.addLayer(variantId, layer)
  studio.select(variantId, layer.id)
  return layer
}

// Dabs at a quarter of the radius make a continuous line; hardness sets where the soft
// falloff of each dab begins.
function coverage(w: number, h: number, s: Stroke): HTMLCanvasElement {
  const c = canvas(w, h)
  const g = ctx2d(c)
  const r = Math.max(0.5, s.radius)
  const dab = (x: number, y: number): void => {
    if (s.hardness >= 0.99) g.fillStyle = '#fff'
    else {
      const grad = g.createRadialGradient(x, y, r * s.hardness, x, y, r)
      grad.addColorStop(0, 'rgba(255,255,255,1)')
      grad.addColorStop(1, 'rgba(255,255,255,0)')
      g.fillStyle = grad
    }
    g.beginPath()
    g.arc(x, y, r, 0, Math.PI * 2)
    g.fill()
  }
  const step = Math.max(1, r * 0.25)
  s.points.forEach((p, i) => {
    if (i === 0) return dab(p[0], p[1])
    const q = s.points[i - 1]
    const n = Math.max(1, Math.ceil(Math.hypot(p[0] - q[0], p[1] - q[1]) / step))
    for (let k = 1; k <= n; k++) dab(q[0] + ((p[0] - q[0]) * k) / n, q[1] + ((p[1] - q[1]) * k) / n)
  })
  return c
}

function shifted(src: HTMLCanvasElement, dx: number, dy: number): HTMLCanvasElement {
  const c = canvas(src.width, src.height)
  ctx2d(c).drawImage(src, dx, dy)
  return c
}

function meanColor(px: HTMLCanvasElement, where: HTMLCanvasElement): [number, number, number] {
  const a = ctx2d(px).getImageData(0, 0, px.width, px.height).data
  const m = ctx2d(where).getImageData(0, 0, where.width, where.height).data
  let r = 0
  let g = 0
  let b = 0
  let n = 0
  for (let i = 0; i < a.length; i += 4) {
    const k = (m[i + 3] / 255) * (a[i + 3] / 255)
    if (k <= 0) continue
    r += a[i] * k
    g += a[i + 1] * k
    b += a[i + 2] * k
    n += k
  }
  return n ? [r / n, g / n, b / n] : [0, 0, 0]
}

// Healing is cloning that takes on the colour of where it lands: the patch keeps the source
// texture but is shifted to the average tone around the destination.
function tone(px: HTMLCanvasElement, from: [number, number, number], to: [number, number, number]): HTMLCanvasElement {
  const g = ctx2d(px)
  const img = g.getImageData(0, 0, px.width, px.height)
  const d = img.data
  for (let i = 0; i < d.length; i += 4) {
    if (!d[i + 3]) continue
    d[i] += to[0] - from[0]
    d[i + 1] += to[1] - from[1]
    d[i + 2] += to[2] - from[2]
  }
  g.putImageData(img, 0, 0)
  return px
}

// A stroke is built in canvas space — where the creator sees it — clipped by any active
// selection, then carried into the layer's own pixels and saved as a new version, so undo
// simply points the layer back at the previous one.
export async function paint(
  studio: Studio,
  variantId: string,
  layerId: string,
  stroke: Stroke,
  selection: HTMLCanvasElement | null
): Promise<void> {
  const doc = studio.doc(variantId)
  const layer = findLayer(doc, layerId)
  if (layer.kind !== 'image') throw new Error(`${layer.name} is a ${layer.kind} layer — paint on an image or a paint layer.`)
  if (!stroke.points.length) throw new Error('A stroke needs at least one point.')
  const src = await studio.assets.get(layer.asset)

  let area = coverage(doc.width, doc.height, stroke)
  if (selection) area = intersect(area, selection)

  let marks: HTMLCanvasElement
  if (stroke.mode === 'brush') marks = colorize(area, stroke.color)
  else if (stroke.mode === 'erase') marks = area
  else {
    const from = stroke.source
    if (!from) throw new Error('Set a clone source first — Alt-click where to copy from.')
    const composite = renderDoc(doc, studio.assets)
    const [ox, oy] = [from[0] - stroke.points[0][0], from[1] - stroke.points[0][1]]
    marks = intersect(shifted(composite, -ox, -oy), area)
    if (stroke.mode === 'heal') marks = tone(marks, meanColor(marks, area), meanColor(composite, area))
  }

  const local = docToLayer(layer, marks, src.width, src.height)
  const out = canvas(src.width, src.height)
  const g = ctx2d(out)
  g.drawImage(src, 0, 0)
  g.globalAlpha = Math.max(0, Math.min(1, stroke.opacity))
  g.globalCompositeOperation = stroke.mode === 'erase' ? 'destination-out' : 'source-over'
  g.drawImage(local, 0, 0)

  const info = await studio.assets.addCanvas(out, layer.name, 'paint')
  studio.addAsset(info)
  studio.update(
    variantId,
    (d) => ({ ...d, layers: d.layers.map((l) => (l.id === layer.id ? ({ ...l, asset: info.id } as Layer) : l)) }),
    { touched: layer.id }
  )
}
