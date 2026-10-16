import type { ImageLayer } from '@shared/studio'
import { canvas, ctx2d } from './assets'
import type { Pixels } from './assets'

export type Pt = [number, number]

export function baseMask(w: number, h: number, current: Pixels | null): HTMLCanvasElement {
  const c = canvas(w, h)
  const g = ctx2d(c)
  if (current) g.drawImage(current, 0, 0, w, h)
  else {
    g.fillStyle = '#fff'
    g.fillRect(0, 0, w, h)
  }
  return c
}

// Masks live in the source image's own pixels, so a canvas point has to be carried back
// through the layer's rotation, flip and scale before it can be painted.
export function toSource(layer: ImageLayer, srcW: number, srcH: number, [px, py]: Pt): Pt {
  const cx = layer.x + layer.width / 2
  const cy = layer.y + layer.height / 2
  const a = (-layer.rotation * Math.PI) / 180
  const dx = px - cx
  const dy = py - cy
  let lx = dx * Math.cos(a) - dy * Math.sin(a)
  let ly = dx * Math.sin(a) + dy * Math.cos(a)
  if (layer.flipX) lx = -lx
  if (layer.flipY) ly = -ly
  return [((lx + layer.width / 2) / layer.width) * srcW, ((ly + layer.height / 2) / layer.height) * srcH]
}

export function sourceScale(layer: ImageLayer, srcW: number): number {
  return srcW / layer.width
}

function mode(g: CanvasRenderingContext2D, show: boolean): void {
  g.globalCompositeOperation = show ? 'source-over' : 'destination-out'
  g.fillStyle = '#fff'
  g.strokeStyle = '#fff'
}

export function paintPolygon(mask: HTMLCanvasElement, pts: Pt[], show: boolean): void {
  if (pts.length < 3) return
  const g = ctx2d(mask)
  mode(g, show)
  g.beginPath()
  pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)))
  g.closePath()
  g.fill()
  g.globalCompositeOperation = 'source-over'
}

export function paintBrush(mask: HTMLCanvasElement, pts: Pt[], radius: number, show: boolean): void {
  if (!pts.length) return
  const g = ctx2d(mask)
  mode(g, show)
  g.lineWidth = radius * 2
  g.lineCap = 'round'
  g.lineJoin = 'round'
  g.beginPath()
  if (pts.length === 1) {
    g.arc(pts[0][0], pts[0][1], radius, 0, Math.PI * 2)
    g.fill()
  } else {
    pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)))
    g.stroke()
  }
  g.globalCompositeOperation = 'source-over'
}

export function featherMask(mask: HTMLCanvasElement, px: number): HTMLCanvasElement {
  const out = canvas(mask.width, mask.height)
  const g = ctx2d(out)
  g.filter = `blur(${Math.max(0.5, px / 2)}px)`
  g.drawImage(mask, 0, 0)
  return out
}

export function invertMask(mask: HTMLCanvasElement): HTMLCanvasElement {
  const out = canvas(mask.width, mask.height)
  const g = ctx2d(out)
  g.fillStyle = '#fff'
  g.fillRect(0, 0, out.width, out.height)
  g.globalCompositeOperation = 'destination-out'
  g.drawImage(mask, 0, 0)
  return out
}

// The image model paints a black-and-white matte; luminance becomes coverage, with the
// ends clipped so near-black noise and off-white haze do not leave ghosts.
export function matteToMask(matte: HTMLCanvasElement): HTMLCanvasElement {
  const g = ctx2d(matte)
  const img = g.getImageData(0, 0, matte.width, matte.height)
  const d = img.data
  for (let i = 0; i < d.length; i += 4) {
    const lum = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]
    const a = Math.max(0, Math.min(255, ((lum - 40) * 255) / 170))
    d[i] = d[i + 1] = d[i + 2] = 255
    d[i + 3] = a
  }
  g.putImageData(img, 0, 0)
  return matte
}
