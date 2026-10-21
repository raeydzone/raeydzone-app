import type { Layer, StudioDoc } from '@shared/studio'
import {
  boundsOfAlpha, colorize, dilate, erode, intersect, invertAlpha, isEmpty, smoothEdge, softened, subtract, union
} from './alpha'
import { canvas, ctx2d } from './assets'
import type { Studio } from './engine'
import { maskCanvasFor, saveMask } from './ai'
import { makeImage } from './doc'
import { drawLayer, renderDoc } from './render'
import { docToLayer } from './warp'

export type Pt = [number, number]
export type SelectShape = 'rect' | 'ellipse' | 'lasso' | 'wand' | 'color'
export type Combine = 'replace' | 'add' | 'subtract' | 'intersect'

// A selection is a canvas-sized coverage map, white where selected. It is a working tool,
// not part of the document, so it lives beside the history rather than in it.
export function blank(doc: StudioDoc): HTMLCanvasElement {
  return canvas(doc.width, doc.height)
}

export function combine(current: HTMLCanvasElement | null, next: HTMLCanvasElement, mode: Combine): HTMLCanvasElement | null {
  const result =
    !current || mode === 'replace'
      ? next
      : mode === 'add'
        ? union(current, next)
        : mode === 'subtract'
          ? subtract(current, next)
          : intersect(current, next)
  return isEmpty(result) ? null : result
}

export function boxSelection(doc: StudioDoc, box: { x: number; y: number; width: number; height: number }, ellipse: boolean): HTMLCanvasElement {
  const c = blank(doc)
  const g = ctx2d(c)
  g.fillStyle = '#fff'
  g.beginPath()
  if (ellipse) g.ellipse(box.x + box.width / 2, box.y + box.height / 2, box.width / 2, box.height / 2, 0, 0, Math.PI * 2)
  else g.rect(box.x, box.y, box.width, box.height)
  g.fill()
  return c
}

export function lassoSelection(doc: StudioDoc, pts: Pt[]): HTMLCanvasElement {
  const c = blank(doc)
  const g = ctx2d(c)
  g.fillStyle = '#fff'
  g.beginPath()
  pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)))
  g.closePath()
  g.fill()
  return c
}

// Magic wand and colour range both compare against the colour under the click on the
// visible composite; the wand only spreads through touching pixels, colour range takes
// every match on the canvas.
export function colorSelection(
  composite: HTMLCanvasElement,
  x: number,
  y: number,
  tolerance: number,
  contiguous: boolean
): HTMLCanvasElement {
  const { width: w, height: h } = composite
  const src = ctx2d(composite).getImageData(0, 0, w, h).data
  const out = canvas(w, h)
  const og = ctx2d(out)
  const img = og.createImageData(w, h)
  const d = img.data
  const sx = Math.max(0, Math.min(w - 1, Math.floor(x)))
  const sy = Math.max(0, Math.min(h - 1, Math.floor(y)))
  const at = (sy * w + sx) * 4
  const [r, g, b] = [src[at], src[at + 1], src[at + 2]]
  const near = (i: number): boolean =>
    Math.max(Math.abs(src[i] - r), Math.abs(src[i + 1] - g), Math.abs(src[i + 2] - b)) <= tolerance
  const mark = (p: number): void => {
    d[p * 4] = d[p * 4 + 1] = d[p * 4 + 2] = 255
    d[p * 4 + 3] = 255
  }
  if (!contiguous) {
    for (let p = 0; p < w * h; p++) if (near(p * 4)) mark(p)
  } else {
    const seen = new Uint8Array(w * h)
    const stack: number[] = []
    const visit = (p: number): void => {
      if (seen[p]) return
      seen[p] = 1
      stack.push(p)
    }
    visit(sy * w + sx)
    while (stack.length) {
      const p = stack.pop()!
      if (!near(p * 4)) continue
      mark(p)
      const px = p % w
      const py = (p - px) / w
      if (px > 0) visit(p - 1)
      if (px < w - 1) visit(p + 1)
      if (py > 0) visit(p - w)
      if (py < h - 1) visit(p + w)
    }
  }
  og.putImageData(img, 0, 0)
  return out
}

export type Refine = 'feather' | 'grow' | 'shrink' | 'smooth' | 'invert'

export function refine(sel: HTMLCanvasElement, op: Refine, px: number): HTMLCanvasElement {
  switch (op) {
    case 'feather':
      return softened(sel, px)
    case 'grow':
      return dilate(sel, px)
    case 'shrink':
      return erode(sel, px)
    case 'smooth':
      return smoothEdge(sel, px)
    case 'invert':
      return invertAlpha(sel)
  }
}

export function selectionOverlay(sel: HTMLCanvasElement, dim: string, edge: string): HTMLCanvasElement {
  const out = canvas(sel.width, sel.height)
  const g = ctx2d(out)
  g.fillStyle = dim
  g.fillRect(0, 0, out.width, out.height)
  g.globalCompositeOperation = 'destination-out'
  g.drawImage(sel, 0, 0)
  g.globalCompositeOperation = 'source-over'
  const ring = subtract(dilate(sel, 1.5), erode(sel, 1))
  g.drawImage(colorize(ring, edge), 0, 0)
  return out
}

function layerPixels(doc: StudioDoc, layer: Layer, studio: Studio): HTMLCanvasElement {
  const c = blank(doc)
  drawLayer(ctx2d(c), { ...layer, visible: true, opacity: 1, blend: 'normal' } as Layer, studio.assets, doc)
  return c
}

// Hiding through a selection only ever narrows what was visible, so an earlier cut-out on
// the layer survives being combined with it.
export async function maskWithSelection(
  studio: Studio,
  variantId: string,
  layer: Layer,
  sel: HTMLCanvasElement,
  keep: 'inside' | 'outside'
): Promise<void> {
  const { width, height } = await maskCanvasFor(studio, layer)
  const shape = docToLayer(layer, sel, width, height)
  const current = layer.mask ? await studio.assets.get(layer.mask) : null
  const base = canvas(width, height)
  const g = ctx2d(base)
  if (current) g.drawImage(current, 0, 0, width, height)
  else {
    g.fillStyle = '#fff'
    g.fillRect(0, 0, width, height)
  }
  await saveMask(studio, variantId, layer, keep === 'inside' ? intersect(base, shape) : subtract(base, shape))
}

// A group mask lives in canvas space, so a selection applies to it as drawn; like a layer
// mask it only narrows what was already showing.
export async function maskGroup(
  studio: Studio,
  variantId: string,
  groupId: string,
  sel: HTMLCanvasElement | null,
  keep: 'inside' | 'outside'
): Promise<void> {
  const doc = studio.doc(variantId)
  const group = doc.groups.find((g) => g.id === groupId)
  if (!group) throw new Error(`No group with id ${groupId}`)
  let mask: string | null = null
  if (sel) {
    const current = group.mask ? await studio.assets.get(group.mask) : null
    const base = blank(doc)
    const g = ctx2d(base)
    if (current) g.drawImage(current, 0, 0, doc.width, doc.height)
    else {
      g.fillStyle = '#fff'
      g.fillRect(0, 0, doc.width, doc.height)
    }
    const info = await studio.assets.addCanvas(keep === 'inside' ? intersect(base, sel) : subtract(base, sel), group.name + ' mask', 'mask')
    studio.addAsset(info)
    mask = info.id
  }
  studio.update(variantId, (d) => ({ ...d, groups: d.groups.map((g) => (g.id === groupId ? { ...g, mask } : g)) }))
}

async function placeCrop(
  studio: Studio,
  variantId: string,
  pixels: HTMLCanvasElement,
  label: string
): Promise<string | null> {
  const doc = studio.doc(variantId)
  const b = boundsOfAlpha(pixels)
  if (!b) return null
  const crop = canvas(b.width, b.height)
  ctx2d(crop).drawImage(pixels, -b.x, -b.y)
  const info = await studio.assets.addCanvas(crop, label, 'paint')
  studio.addAsset(info)
  const layer = { ...makeImage(doc, info, 'contain'), x: b.x, y: b.y, width: b.width, height: b.height, name: label }
  studio.addLayer(variantId, layer)
  studio.select(variantId, layer.id)
  return layer.id
}

// With an image selected, only its pixels are copied; otherwise everything visible is.
export async function layerFromSelection(
  studio: Studio,
  variantId: string,
  sel: HTMLCanvasElement,
  from: Layer | null
): Promise<string | null> {
  const doc = studio.doc(variantId)
  const source = from && from.kind === 'image' ? layerPixels(doc, from, studio) : renderDoc(doc, studio.assets)
  return placeCrop(studio, variantId, intersect(source, sel), from ? from.name + ' piece' : 'Selection')
}

export function fillSelection(studio: Studio, variantId: string, sel: HTMLCanvasElement, color: string): Promise<string | null> {
  return placeCrop(studio, variantId, colorize(sel, color), 'Fill')
}
