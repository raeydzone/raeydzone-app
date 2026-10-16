import type { Adjust, Layer, ShapeLayer, StudioDoc } from '@shared/studio'
import { canvas, ctx2d } from './assets'
import type { AssetStore } from './assets'
import { drawText } from './text'

interface Raster {
  canvas: HTMLCanvasElement
  pad: number
}

const CACHE_LIMIT = 160
const cache = new Map<string, Raster>()

function cached(key: string, build: () => Raster | null): Raster | null {
  const hit = cache.get(key)
  if (hit) {
    cache.delete(key)
    cache.set(key, hit)
    return hit
  }
  const made = build()
  if (!made) return null
  cache.set(key, made)
  if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value!)
  return made
}

function contentKey(l: Layer): string {
  const { x, y, opacity, blend, visible, name, locked, rotation, ...rest } = l
  return JSON.stringify(rest) + (l.shadow ? '@' + rotation : '')
}

function padFor(l: Layer): number {
  const stroke = l.stroke?.width ?? 0
  let p = 2 + stroke
  if (l.glow) p = Math.max(p, l.glow.size * 1.6 + stroke)
  if (l.shadow) p = Math.max(p, l.shadow.blur * 1.6 + Math.hypot(l.shadow.x, l.shadow.y) + stroke)
  if (l.kind === 'shape') p = Math.max(p, l.feather * 1.6 + 2)
  if (l.kind === 'text') p = Math.max(p, l.size * 0.25 + stroke)
  if (l.adjust.blur) p = Math.max(p, l.adjust.blur * 3)
  return Math.ceil(p)
}

function filterOf(a: Adjust): string {
  const parts: string[] = []
  if (a.brightness !== 100) parts.push(`brightness(${a.brightness}%)`)
  if (a.contrast !== 100) parts.push(`contrast(${a.contrast}%)`)
  if (a.saturation !== 100) parts.push(`saturate(${a.saturation}%)`)
  if (a.hue) parts.push(`hue-rotate(${a.hue}deg)`)
  if (a.blur > 0) parts.push(`blur(${a.blur}px)`)
  return parts.join(' ')
}

function shapePath(g: CanvasRenderingContext2D, l: ShapeLayer, w: number, h: number): void {
  g.beginPath()
  if (l.shape === 'ellipse') g.ellipse(w / 2, h / 2, w / 2, h / 2, 0, 0, Math.PI * 2)
  else if (l.shape === 'polygon' && l.points.length >= 3) {
    l.points.forEach(([px, py], i) => (i ? g.lineTo(px * w, py * h) : g.moveTo(px * w, py * h)))
    g.closePath()
  } else g.roundRect(0, 0, w, h, Math.min(l.radius, w / 2, h / 2))
}

function shapeFill(g: CanvasRenderingContext2D, l: ShapeLayer, w: number, h: number): string | CanvasGradient {
  const gr = l.gradient
  if (!gr) return l.fill
  let grad: CanvasGradient
  if (gr.type === 'radial') {
    grad = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, Math.hypot(w, h) / 2)
  } else {
    const a = (gr.angle * Math.PI) / 180
    const r = (Math.abs(w * Math.cos(a)) + Math.abs(h * Math.sin(a))) / 2
    grad = g.createLinearGradient(w / 2 - Math.cos(a) * r, h / 2 - Math.sin(a) * r, w / 2 + Math.cos(a) * r, h / 2 + Math.sin(a) * r)
  }
  grad.addColorStop(0, gr.from)
  grad.addColorStop(1, gr.to)
  return grad
}

function drawContent(l: Layer, assets: AssetStore, w: number, h: number, pad: number): HTMLCanvasElement | null {
  const out = canvas(w + pad * 2, h + pad * 2)
  const g = ctx2d(out)
  g.translate(pad, pad)
  if (l.flipX || l.flipY) {
    g.translate(l.flipX ? w : 0, l.flipY ? h : 0)
    g.scale(l.flipX ? -1 : 1, l.flipY ? -1 : 1)
  }
  if (l.kind === 'image') {
    const px = assets.peek(l.asset)
    const mask = l.mask ? assets.peek(l.mask) : null
    if (!px || (l.mask && !mask)) return null
    g.imageSmoothingQuality = 'high'
    g.drawImage(px, 0, 0, w, h)
    if (mask) {
      g.globalCompositeOperation = 'destination-in'
      g.drawImage(mask, 0, 0, w, h)
    }
  } else if (l.kind === 'text') {
    drawText(g, l, 0, 0)
  } else {
    if (l.feather > 0) g.filter = `blur(${l.feather / 2}px)`
    g.fillStyle = shapeFill(g, l, w, h)
    shapePath(g, l, w, h)
    g.fill()
  }

  const filter = filterOf(l.adjust)
  let result = out
  if (filter) {
    result = canvas(out.width, out.height)
    const f = ctx2d(result)
    f.filter = filter
    f.drawImage(out, 0, 0)
  }
  if (l.tint && l.tint.amount > 0) {
    const t = ctx2d(result)
    t.globalCompositeOperation = 'source-atop'
    t.globalAlpha = l.tint.amount
    t.fillStyle = l.tint.color
    t.fillRect(0, 0, result.width, result.height)
  }
  return result
}

function colorize(src: HTMLCanvasElement, color: string): HTMLCanvasElement {
  const out = canvas(src.width, src.height)
  const g = ctx2d(out)
  g.drawImage(src, 0, 0)
  g.globalCompositeOperation = 'source-in'
  g.fillStyle = color
  g.fillRect(0, 0, out.width, out.height)
  return out
}

function dilate(src: HTMLCanvasElement, radius: number): HTMLCanvasElement {
  const out = canvas(src.width, src.height)
  const g = ctx2d(out)
  const rings = radius > 6 ? [radius, radius * 0.66, radius * 0.33] : [radius]
  for (const r of rings) {
    const steps = Math.min(72, Math.max(12, Math.ceil((Math.PI * 2 * r) / 2)))
    for (let i = 0; i < steps; i++) {
      const a = (i / steps) * Math.PI * 2
      g.drawImage(src, Math.cos(a) * r, Math.sin(a) * r)
    }
  }
  g.drawImage(src, 0, 0)
  return out
}

function buildRaster(l: Layer, assets: AssetStore): Raster | null {
  const w = Math.max(1, Math.round(l.width))
  const h = Math.max(1, Math.round(l.height))
  const pad = padFor(l)
  const content = drawContent(l, assets, w, h, pad)
  if (!content) return null
  if (!l.shadow && !l.glow && !l.stroke) return { canvas: content, pad }

  const out = canvas(content.width, content.height)
  const g = ctx2d(out)
  const outline = l.stroke && l.stroke.width > 0 ? dilate(colorize(content, l.stroke.color), l.stroke.width) : null
  const body = outline ?? content

  if (l.shadow) {
    const a = (-l.rotation * Math.PI) / 180
    const dx = l.shadow.x * Math.cos(a) - l.shadow.y * Math.sin(a)
    const dy = l.shadow.x * Math.sin(a) + l.shadow.y * Math.cos(a)
    g.save()
    g.globalAlpha = l.shadow.opacity
    if (l.shadow.blur > 0) g.filter = `blur(${l.shadow.blur / 2}px)`
    g.drawImage(colorize(body, l.shadow.color), dx, dy)
    g.restore()
  }
  if (l.glow && l.glow.size > 0) {
    const lit = colorize(body, l.glow.color)
    g.save()
    g.globalAlpha = l.glow.opacity
    g.filter = `blur(${l.glow.size / 2}px)`
    g.drawImage(lit, 0, 0)
    g.filter = `blur(${l.glow.size / 5}px)`
    g.drawImage(lit, 0, 0)
    g.restore()
  }
  if (outline && l.stroke) {
    g.globalAlpha = l.stroke.opacity
    g.drawImage(outline, 0, 0)
    g.globalAlpha = 1
  }
  g.drawImage(content, 0, 0)
  return { canvas: out, pad }
}

export function raster(l: Layer, assets: AssetStore): Raster | null {
  return cached(contentKey(l), () => buildRaster(l, assets))
}

export function drawLayer(g: CanvasRenderingContext2D, l: Layer, assets: AssetStore): void {
  const r = raster(l, assets)
  if (!r) return
  g.save()
  g.globalAlpha = l.opacity
  g.globalCompositeOperation = l.blend === 'normal' ? 'source-over' : l.blend
  g.translate(l.x + l.width / 2, l.y + l.height / 2)
  if (l.rotation) g.rotate((l.rotation * Math.PI) / 180)
  g.drawImage(r.canvas, -Math.round(l.width) / 2 - r.pad, -Math.round(l.height) / 2 - r.pad)
  g.restore()
}

export function drawChecker(g: CanvasRenderingContext2D, w: number, h: number): void {
  const size = 16
  g.fillStyle = '#1a1a1a'
  g.fillRect(0, 0, w, h)
  g.fillStyle = '#262626'
  for (let y = 0; y < h; y += size) {
    for (let x = (y / size) % 2 ? size : 0; x < w; x += size * 2) g.fillRect(x, y, size, size)
  }
}

export function drawDoc(
  g: CanvasRenderingContext2D,
  doc: StudioDoc,
  assets: AssetStore,
  only: string | null = null
): void {
  g.save()
  g.globalCompositeOperation = 'source-over'
  if (only) drawChecker(g, doc.width, doc.height)
  else {
    g.fillStyle = doc.background
    g.fillRect(0, 0, doc.width, doc.height)
  }
  for (const l of doc.layers) {
    if (only ? l.id !== only : !l.visible) continue
    drawLayer(g, l, assets)
  }
  g.restore()
}

export function renderDoc(doc: StudioDoc, assets: AssetStore, only: string | null = null): HTMLCanvasElement {
  const out = canvas(doc.width, doc.height)
  drawDoc(ctx2d(out), doc, assets, only)
  return out
}

export function toLocal(l: Layer, x: number, y: number): [number, number] {
  const cx = l.x + l.width / 2
  const cy = l.y + l.height / 2
  const a = (-l.rotation * Math.PI) / 180
  const dx = x - cx
  const dy = y - cy
  return [dx * Math.cos(a) - dy * Math.sin(a), dx * Math.sin(a) + dy * Math.cos(a)]
}

export function hitLayer(doc: StudioDoc, assets: AssetStore, x: number, y: number): Layer | null {
  for (let i = doc.layers.length - 1; i >= 0; i--) {
    const l = doc.layers[i]
    if (!l.visible || l.locked) continue
    const [lx, ly] = toLocal(l, x, y)
    if (Math.abs(lx) > l.width / 2 || Math.abs(ly) > l.height / 2) continue
    const r = raster(l, assets)
    if (!r) return l
    const px = Math.floor(lx + Math.round(l.width) / 2 + r.pad)
    const py = Math.floor(ly + Math.round(l.height) / 2 + r.pad)
    const alpha = r.canvas.getContext('2d')!.getImageData(px, py, 1, 1).data[3]
    if (alpha > 24 || l.kind === 'text') return l
  }
  return null
}

export function isReady(doc: StudioDoc, assets: AssetStore): boolean {
  return doc.layers.every((l) => l.kind !== 'image' || (assets.peek(l.asset) && (!l.mask || assets.peek(l.mask))))
}

