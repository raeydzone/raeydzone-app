import type {
  Adjust, Clip, Contact, Glow, Gradient, Layer, Outline, Shadow, ShapeLayer, StudioDoc
} from '@shared/studio'
import { boundsOfAlpha, colorize, dilate, erode, intersect, invertAlpha, lumaToAlpha, softened, subtract } from './alpha'
import { canvas, ctx2d } from './assets'
import type { AssetStore } from './assets'
import { applyBlur, blurReach } from './blurfx'
import { assetsOf, chainOf, docAssets, inGroup } from './doc'
import { applyFinish } from './finish'
import { drawText } from './text'
import { applyTone, isNeutral, toneReady } from './tone'
import { distort, isDistorted, overflow } from './warp'

interface Box {
  x: number
  y: number
  w: number
  h: number
}

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
  const { x, y, opacity, blend, visible, name, locked, rotation, group, clip, ...rest } = l
  return JSON.stringify(rest) + (l.shadows.length ? '@' + rotation : '')
}

// A clip depends on where both layers sit, so it is keyed and cached apart from the
// content raster — moving the source must not rebuild the layer itself.
function placeKey(l: Layer): string {
  return [l.x, l.y, l.rotation, l.opacity].join(',')
}

function groupMasks(doc: StudioDoc, l: Layer): string[] {
  return chainOf(doc, l.group).flatMap((g) => (g.mask ? [g.mask] : []))
}

function clipKey(doc: StudioDoc, l: Layer, clip: Clip | null): string {
  const sources = clip ? clipSources(doc, clip.from) : []
  const src = sources.map((s) => contentKey(s) + '@' + placeKey(s)).join('|')
  return [contentKey(l), placeKey(l), JSON.stringify(clip), src, doc.width, ...groupMasks(doc, l)].join('~')
}

const masked = (doc: StudioDoc | null, l: Layer): boolean => !!doc && (!!l.clip || groupMasks(doc, l).length > 0)

function clipSources(doc: StudioDoc, from: string): Layer[] {
  const layer = doc.layers.find((l) => l.id === from)
  if (layer) return [layer]
  return doc.layers.filter((l) => inGroup(doc, l, from))
}

// Outside strokes nest, so the room an effect needs is the whole stack, not one entry.
function spreadOf(strokes: Outline[]): number {
  return strokes.reduce(
    (n, s) => n + (s.position === 'inside' || s.width <= 0 ? 0 : s.position === 'center' ? s.width / 2 : s.width),
    0
  )
}

function padFor(l: Layer): number {
  const spread = spreadOf(l.strokes) + (l.kind === 'shape' && l.line ? l.line.width / 2 : 0)
  let p = 2 + spread
  for (const glow of l.glows) {
    if (!glow.inner) p = Math.max(p, glow.size * 1.6 + spread)
  }
  for (const shadow of l.shadows) {
    if (shadow.inner) continue
    p = Math.max(p, shadow.blur * 1.6 + Math.hypot(shadow.x, shadow.y) + spread)
  }
  if (l.kind === 'shape') p = Math.max(p, l.feather * 1.6 + 2)
  if (l.kind === 'text') p = Math.max(p, l.size * 0.25 + spread)
  if (l.contact) p = Math.max(p, l.contact.blur * 1.6 + Math.abs(l.contact.y) + 2)
  if (l.adjust.blur) p = Math.max(p, l.adjust.blur * 3)
  return Math.ceil(p + overflow(l) + blurReach(l.blurFx, l.width, l.height))
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

type Pt = [number, number]

function vertices(l: ShapeLayer, w: number, h: number): Pt[] | null {
  if (l.shape === 'polygon') return l.points.length >= 3 ? l.points.map(([x, y]) => [x * w, y * h]) : null
  if (l.shape === 'star') {
    const out: Pt[] = []
    for (let i = 0; i < l.sides * 2; i++) {
      const a = -Math.PI / 2 + (i * Math.PI) / l.sides
      const k = i % 2 ? l.inset : 1
      out.push([w / 2 + (Math.cos(a) * w * k) / 2, h / 2 + (Math.sin(a) * h * k) / 2])
    }
    return out
  }
  if (l.shape === 'arrow') {
    const shaft = h * l.inset
    const head = Math.min(w * 0.45, h * 0.9)
    const top = (h - shaft) / 2
    return [[0, top], [w - head, top], [w - head, 0], [w, h / 2], [w - head, h], [w - head, h - top], [0, h - top]]
  }
  return null
}

// Corner rounding: each corner is cut back along both of its edges and bridged with a curve.
// At 1 the cuts meet at the edge midpoints and a polygon turns into a smooth blob.
function tracePoints(g: CanvasRenderingContext2D, pts: Pt[], smooth: number): void {
  if (smooth <= 0) {
    pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)))
    g.closePath()
    return
  }
  const t = smooth / 2
  const n = pts.length
  const lerp = (a: Pt, b: Pt, k: number): Pt => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k]
  const start = lerp(pts[0], pts[1], t)
  g.moveTo(start[0], start[1])
  for (let i = 1; i <= n; i++) {
    const prev = pts[i - 1]
    const at = pts[i % n]
    const next = pts[(i + 1) % n]
    const into = lerp(at, prev, t)
    const out = lerp(at, next, t)
    g.lineTo(into[0], into[1])
    g.quadraticCurveTo(at[0], at[1], out[0], out[1])
  }
  g.closePath()
}

function bubblePath(g: CanvasRenderingContext2D, l: ShapeLayer, w: number, h: number): void {
  const body = h * (1 - l.inset * 0.5)
  const r = Math.min(l.radius, w / 2, body / 2)
  g.moveTo(r, 0)
  g.lineTo(w - r, 0)
  g.arcTo(w, 0, w, r, r)
  g.lineTo(w, body - r)
  g.arcTo(w, body, w - r, body, r)
  g.lineTo(Math.max(r, w * 0.36), body)
  g.lineTo(w * 0.12, h)
  g.lineTo(Math.max(r, w * 0.22), body)
  g.lineTo(r, body)
  g.arcTo(0, body, 0, body - r, r)
  g.lineTo(0, r)
  g.arcTo(0, 0, r, 0, r)
  g.closePath()
}

function shapePath(g: CanvasRenderingContext2D, l: ShapeLayer, w: number, h: number): void {
  g.beginPath()
  const pts = vertices(l, w, h)
  if (pts) tracePoints(g, pts, l.smooth)
  else if (l.shape === 'ellipse') g.ellipse(w / 2, h / 2, w / 2, h / 2, 0, 0, Math.PI * 2)
  else if (l.shape === 'bubble') bubblePath(g, l, w, h)
  else g.roundRect(0, 0, w, h, Math.min(l.radius, w / 2, h / 2))
}

function paintOf(g: CanvasRenderingContext2D, fill: string, gr: Gradient | null | undefined, w: number, h: number): string | CanvasGradient {
  if (!gr) return fill
  let grad: CanvasGradient
  if (gr.type === 'radial') {
    grad = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, Math.hypot(w, h) / 2)
  } else if (gr.type === 'conic') {
    grad = g.createConicGradient(((gr.angle - 90) * Math.PI) / 180, w / 2, h / 2)
  } else {
    const a = (gr.angle * Math.PI) / 180
    const r = (Math.abs(w * Math.cos(a)) + Math.abs(h * Math.sin(a))) / 2
    grad = g.createLinearGradient(w / 2 - Math.cos(a) * r, h / 2 - Math.sin(a) * r, w / 2 + Math.cos(a) * r, h / 2 + Math.sin(a) * r)
  }
  const stops = gr.stops?.length >= 2 ? gr.stops : [{ at: 0, color: gr.from }, { at: 1, color: gr.to }]
  for (const stop of stops) grad.addColorStop(stop.at, stop.color)
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
  const mask = l.mask ? assets.peek(l.mask) : null
  if (l.mask && !mask) return null
  if (!toneReady(l.tone, assets)) return null

  if (l.kind === 'adjust') {
    g.fillStyle = '#fff'
    g.fillRect(0, 0, w, h)
  } else if (l.kind === 'image') {
    const px = assets.peek(l.asset)
    if (!px) return null
    g.imageSmoothingQuality = 'high'
    g.drawImage(px, 0, 0, w, h)
  } else if (l.kind === 'text') {
    drawText(g, l, 0, 0, paintOf(g, l.fill, l.gradient, w, h))
  } else {
    if (l.feather > 0) g.filter = `blur(${l.feather / 2}px)`
    g.fillStyle = paintOf(g, l.fill, l.gradient, w, h)
    shapePath(g, l, w, h)
    g.fill()
    if (l.line && l.line.width > 0 && l.line.opacity > 0) {
      g.save()
      g.globalAlpha = l.line.opacity
      g.strokeStyle = l.line.color
      g.lineWidth = l.line.width
      g.lineJoin = 'round'
      g.lineCap = 'round'
      g.setLineDash(l.line.dash > 0 ? [l.line.dash, l.line.dash * 0.8] : [])
      g.stroke()
      g.restore()
    }
  }

  if (mask) {
    g.filter = 'none'
    g.globalCompositeOperation = 'destination-in'
    g.drawImage(mask, 0, 0, w, h)
    g.globalCompositeOperation = 'source-over'
  }

  // Distortion bends the content itself, before any effect, so outlines and shadows trace
  // the bent shape at an even width instead of being stretched with it.
  const shaped = isDistorted(l) ? distort(out, l, w, h, pad) : out
  if (l.kind === 'adjust') return shaped
  return processed(shaped, l, assets, { x: pad, y: pad, w, h }, -l.rotation)
}

// The pixel work an adjustment does, shared by a layer on its own content and by an
// adjustment layer on everything below it.
function processed(shaped: HTMLCanvasElement, l: Layer, assets: AssetStore, box: Box, turn: number): HTMLCanvasElement {
  const filter = filterOf(l.adjust)
  let result = shaped
  if (filter) {
    result = canvas(shaped.width, shaped.height)
    const f = ctx2d(result)
    f.filter = filter
    f.drawImage(shaped, 0, 0)
  }
  if (l.tint && l.tint.amount > 0) {
    const t = ctx2d(result)
    t.globalCompositeOperation = 'source-atop'
    t.globalAlpha = l.tint.amount
    t.fillStyle = l.tint.color
    t.fillRect(0, 0, result.width, result.height)
  }
  if (l.tone && !isNeutral(l.tone)) result = applyTone(result, l.tone, assets)
  if (l.blurFx && l.blurFx.amount > 0) result = applyBlur(result, l.blurFx, box, turn)
  return result
}

// The raster is built before the layer is rotated, so an offset the creator set in canvas
// terms has to be turned back into the layer's own frame.
function offsetIn(l: Layer, x: number, y: number): [number, number] {
  const a = (-l.rotation * Math.PI) / 180
  return [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a)]
}

function drawDropShadow(
  g: CanvasRenderingContext2D,
  body: HTMLCanvasElement,
  shadow: Shadow,
  l: Layer
): void {
  const [dx, dy] = offsetIn(l, shadow.x, shadow.y)
  g.save()
  g.globalAlpha = shadow.opacity
  if (shadow.blur > 0) g.filter = `blur(${shadow.blur / 2}px)`
  g.drawImage(colorize(body, shadow.color), dx, dy)
  g.restore()
}

function drawOuterGlow(g: CanvasRenderingContext2D, body: HTMLCanvasElement, glow: Glow): void {
  const lit = colorize(body, glow.color)
  g.save()
  g.globalAlpha = glow.opacity
  g.filter = `blur(${glow.size / 2}px)`
  g.drawImage(lit, 0, 0)
  g.filter = `blur(${glow.size / 5}px)`
  g.drawImage(lit, 0, 0)
  g.restore()
}

// Fill the layer, erase the shape to leave only what is beyond its edge, then keep the part
// that lands back on the shape: a soft band inside the outline.
function inwardBand(
  content: HTMLCanvasElement,
  color: string,
  blur: number,
  dx: number,
  dy: number
): HTMLCanvasElement {
  const out = canvas(content.width, content.height)
  const g = ctx2d(out)
  g.fillStyle = color
  g.fillRect(0, 0, out.width, out.height)
  g.globalCompositeOperation = 'destination-out'
  if (blur > 0) g.filter = `blur(${blur / 2}px)`
  g.drawImage(content, dx, dy)
  g.filter = 'none'
  g.globalCompositeOperation = 'destination-in'
  g.drawImage(content, 0, 0)
  return out
}

// Squashed towards the lowest point of the silhouette, where the layer meets the ground.
function drawContact(g: CanvasRenderingContext2D, content: HTMLCanvasElement, c: Contact): void {
  const box = boundsOfAlpha(content)
  if (!box || c.opacity <= 0) return
  const floor = box.y + box.height
  g.save()
  g.globalAlpha = c.opacity
  if (c.blur > 0) g.filter = `blur(${c.blur / 2}px)`
  g.translate(0, floor + c.y)
  g.scale(1, c.squash)
  g.translate(0, -floor)
  g.drawImage(colorize(content, c.color), 0, 0)
  g.restore()
}

function buildRaster(l: Layer, assets: AssetStore): Raster | null {
  const w = Math.max(1, Math.round(l.width))
  const h = Math.max(1, Math.round(l.height))
  const pad = padFor(l)
  const content = drawContent(l, assets, w, h, pad)
  if (!content) return null
  if (l.kind === 'adjust' || (!l.shadows.length && !l.glows.length && !l.strokes.length && !l.contact)) return { canvas: content, pad }

  const out = canvas(content.width, content.height)
  const g = ctx2d(out)
  if (l.contact) drawContact(g, content, l.contact)
  const live = l.strokes.filter((s) => s.width > 0 && s.opacity > 0)
  const outward = live.filter((s) => s.position !== 'inside')
  const spread = spreadOf(live)
  const silhouette = colorize(content, '#ffffff')
  const body = spread > 0 ? dilate(silhouette, spread) : content

  for (const shadow of l.shadows) {
    if (!shadow.inner) drawDropShadow(g, body, shadow, l)
  }
  for (const glow of l.glows) {
    if (!glow.inner && glow.size > 0) drawOuterGlow(g, body, glow)
  }

  // Outside strokes are rings around the silhouette, the widest painted first so the ones
  // nearer the content stay on top: white-then-black outlines nest the way they are listed.
  let radius = spread
  for (let i = outward.length - 1; i >= 0; i--) {
    const stroke = outward[i]
    g.globalAlpha = stroke.opacity
    g.drawImage(dilate(colorize(content, stroke.color), radius), 0, 0)
    radius -= stroke.position === 'center' ? stroke.width / 2 : stroke.width
  }
  g.globalAlpha = 1
  g.drawImage(content, 0, 0)

  // An inside stroke eats into the shape instead of growing out of it, so it is drawn over
  // the content as a ring hugging the edge.
  let depth = 0
  for (const stroke of live) {
    if (stroke.position === 'outside') continue
    const width = stroke.position === 'center' ? stroke.width / 2 : stroke.width
    const outer = depth > 0 ? erode(silhouette, depth) : silhouette
    const ring = subtract(outer, erode(silhouette, depth + width))
    g.globalAlpha = stroke.opacity
    g.drawImage(colorize(ring, stroke.color), 0, 0)
    depth += width
  }
  g.globalAlpha = 1

  for (const glow of l.glows) {
    if (!glow.inner || glow.size <= 0) continue
    const band = inwardBand(content, glow.color, glow.size, 0, 0)
    g.globalAlpha = glow.opacity
    g.drawImage(band, 0, 0)
    g.drawImage(band, 0, 0)
  }
  for (const shadow of l.shadows) {
    if (!shadow.inner) continue
    const [dx, dy] = offsetIn(l, shadow.x, shadow.y)
    g.globalAlpha = shadow.opacity
    g.drawImage(inwardBand(content, shadow.color, shadow.blur, dx, dy), 0, 0)
  }
  g.globalAlpha = 1
  return { canvas: out, pad }
}

export function raster(l: Layer, assets: AssetStore): Raster | null {
  return cached(contentKey(l), () => buildRaster(l, assets))
}

function clipCoverage(doc: StudioDoc, clip: Clip, assets: AssetStore): HTMLCanvasElement | null {
  const sources = clipSources(doc, clip.from)
  if (!sources.length) return null
  let cov = canvas(doc.width, doc.height)
  const g = ctx2d(cov)
  for (const s of sources) drawLayer(g, s, assets)
  if (clip.mode === 'luma') cov = lumaToAlpha(cov)
  if (clip.invert) cov = invertAlpha(cov)
  if (clip.feather > 0) cov = softened(cov, clip.feather)
  return cov
}

// A clip and the masks of every group around the layer all cut it, in canvas space.
function coverage(doc: StudioDoc, l: Layer, assets: AssetStore): HTMLCanvasElement | null | 'wait' {
  let cov = l.clip ? clipCoverage(doc, l.clip, assets) : null
  for (const id of groupMasks(doc, l)) {
    const m = assets.peek(id)
    if (!m) return 'wait'
    const sheet = canvas(doc.width, doc.height)
    ctx2d(sheet).drawImage(m, 0, 0, doc.width, doc.height)
    cov = cov ? intersect(cov, sheet) : sheet
  }
  return cov
}

function clipped(doc: StudioDoc, l: Layer, assets: AssetStore): Raster | null {
  const base = raster(l, assets)
  if (!base || !masked(doc, l)) return base
  return cached('clip~' + clipKey(doc, l, l.clip), () => {
    const cov = coverage(doc, l, assets)
    if (cov === 'wait') return null
    if (!cov) return base
    const out = canvas(base.canvas.width, base.canvas.height)
    const g = ctx2d(out)
    g.drawImage(base.canvas, 0, 0)
    g.globalCompositeOperation = 'destination-in'
    g.translate(base.pad + Math.round(l.width) / 2, base.pad + Math.round(l.height) / 2)
    g.rotate((-l.rotation * Math.PI) / 180)
    g.translate(-(l.x + l.width / 2), -(l.y + l.height / 2))
    g.drawImage(cov, 0, 0)
    return { canvas: out, pad: base.pad }
  })
}

export function drawLayer(
  g: CanvasRenderingContext2D,
  l: Layer,
  assets: AssetStore,
  doc: StudioDoc | null = null
): void {
  const r = doc && masked(doc, l) ? clipped(doc, l, assets) : raster(l, assets)
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
  // Adjustments and light wrap read back what is already painted, and the finish reworks
  // the whole picture; the caller's context may be scaled or offset, so such documents are
  // composited on a canvas of their own first.
  const backdrop = doc.layers.some((l) => l.visible && (l.kind === 'adjust' || l.lightWrap))
  if (!only && (backdrop || doc.finish)) {
    let work = canvas(doc.width, doc.height)
    const w = ctx2d(work)
    w.fillStyle = doc.background
    w.fillRect(0, 0, doc.width, doc.height)
    doc.layers.forEach((l, i) => {
      if (!l.visible) return
      if (l.kind === 'adjust') return adjustBelow(w, doc, i, assets)
      const below = l.lightWrap && l.lightWrap.amount > 0 ? snapshot(work) : null
      drawLayer(w, l, assets, doc)
      if (below) wrapLight(w, doc, i, below, assets)
    })
    if (doc.finish) work = applyFinish(work, doc.finish)
    g.drawImage(work, 0, 0)
  } else {
    for (const l of doc.layers) {
      if (only ? l.id !== only : !l.visible) continue
      drawLayer(g, l, assets, doc)
    }
  }
  g.restore()
}

const backdrops = new Map<string, HTMLCanvasElement>()

function snapshot(c: HTMLCanvasElement): HTMLCanvasElement {
  const out = canvas(c.width, c.height)
  ctx2d(out).drawImage(c, 0, 0)
  return out
}

function remember(key: string, out: HTMLCanvasElement): void {
  backdrops.set(key, out)
  if (backdrops.size > 8) backdrops.delete(backdrops.keys().next().value!)
}

// The blurred scene behind a cut-out, kept only in a band just inside its edge and screened
// over it: the rim light a real photo of someone standing there would have.
function wrapLight(w: CanvasRenderingContext2D, doc: StudioDoc, index: number, below: HTMLCanvasElement, assets: AssetStore): void {
  const l = doc.layers[index]
  const lw = l.lightWrap!
  const ready = doc.layers.slice(0, index + 1).every((x) => !x.visible || layerReady(x, assets))
  const key = 'wrap~' + backdropKey(doc, index) + '#' + contentKey(l) + placeKey(l)
  let out = ready ? backdrops.get(key) : undefined
  if (!out) {
    const body = canvas(doc.width, doc.height)
    const bare = { ...l, shadows: [], glows: [], strokes: [], contact: null, opacity: 1, blend: 'normal' } as Layer
    drawLayer(ctx2d(body), bare, assets, doc)
    const band = intersect(softened(subtract(body, erode(body, lw.size)), lw.size / 2), body)
    out = intersect(softened(below, lw.size * 2), band)
    if (ready) remember(key, out)
  }
  w.save()
  w.globalAlpha = lw.amount * l.opacity
  w.globalCompositeOperation = 'screen'
  w.drawImage(out, 0, 0)
  w.restore()
}

function backdropKey(doc: StudioDoc, index: number): string {
  const below = doc.layers.slice(0, index).filter((l) => l.visible)
  return [doc.width, doc.height, doc.background, ...below.map((l) => contentKey(l) + '@' + placeKey(l) + l.blend + JSON.stringify(l.clip))].join('|')
}

function adjustBelow(w: CanvasRenderingContext2D, doc: StudioDoc, index: number, assets: AssetStore): void {
  const l = doc.layers[index]
  const ready = doc.layers.slice(0, index + 1).every((x) => !x.visible || layerReady(x, assets))
  const key = backdropKey(doc, index) + '#' + contentKey(l) + placeKey(l) + JSON.stringify(l.clip)
  let out = ready ? backdrops.get(key) : undefined
  if (!out) {
    const below = canvas(doc.width, doc.height)
    ctx2d(below).drawImage(w.canvas, 0, 0)
    const changed = processed(below, l, assets, { x: l.x, y: l.y, w: l.width, h: l.height }, 0)
    const area = canvas(doc.width, doc.height)
    drawLayer(ctx2d(area), { ...l, opacity: 1, blend: 'normal' }, assets, doc)
    out = intersect(changed, area)
    if (ready) remember(key, out)
  }
  w.save()
  w.globalAlpha = l.opacity
  w.globalCompositeOperation = l.blend === 'normal' ? 'source-over' : l.blend
  w.drawImage(out, 0, 0)
  w.restore()
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
    if (!l.visible || l.locked || l.kind === 'adjust') continue
    const [lx, ly] = toLocal(l, x, y)
    const reach = overflow(l)
    if (Math.abs(lx) > l.width / 2 + reach || Math.abs(ly) > l.height / 2 + reach) continue
    // A clipped layer is only where it shows; the rest of its box must let clicks through.
    const r = masked(doc, l) ? clipped(doc, l, assets) : raster(l, assets)
    if (!r) return l
    const px = Math.floor(lx + Math.round(l.width) / 2 + r.pad)
    const py = Math.floor(ly + Math.round(l.height) / 2 + r.pad)
    const alpha = r.canvas.getContext('2d')!.getImageData(px, py, 1, 1).data[3]
    if (alpha > 24 || (l.kind === 'text' && !l.clip)) return l
  }
  return null
}

function layerReady(l: Layer, assets: AssetStore): boolean {
  return assetsOf(l).every((id) => !!assets.peek(id))
}

export function isReady(doc: StudioDoc, assets: AssetStore): boolean {
  return docAssets(doc).every((id) => !!assets.peek(id))
}

export async function loadDocAssets(assets: AssetStore, doc: StudioDoc): Promise<void> {
  await Promise.all(docAssets(doc).map((id) => assets.load(id)))
}
