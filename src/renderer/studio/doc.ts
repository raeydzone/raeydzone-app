import { BLEND_MODES, CANVAS_H, CANVAS_W, FONTS } from '@shared/studio'
import type {
  Adjust, AssetInfo, BlendMode, Glow, Gradient, ImageLayer, Layer, Outline, Shadow,
  ShapeLayer, StudioDoc, TextLayer, Tint
} from '@shared/studio'
import { measureText } from './text'

export const NEUTRAL: Adjust = { brightness: 100, contrast: 100, saturation: 100, hue: 0, blur: 0 }

const EFFECT_DEFAULTS = {
  shadow: { color: '#000000', opacity: 0.7, blur: 24, x: 0, y: 12 } as Shadow,
  glow: { color: '#ff2a2a', opacity: 0.9, size: 32 } as Glow,
  stroke: { color: '#ffffff', width: 8, opacity: 1 } as Outline,
  tint: { color: '#ff1a1a', amount: 0.35 } as Tint,
  gradient: { type: 'radial', from: '#ff2a2a', to: '#00000000', angle: 90 } as Gradient
}

export const emptyDoc = (): StudioDoc => ({
  width: CANVAS_W,
  height: CANVAS_H,
  background: '#0a0a0a',
  layers: []
})

export function newId(doc: StudioDoc): string {
  const taken = new Set(doc.layers.map((l) => l.id))
  let id = ''
  do id = 'L' + Math.random().toString(36).slice(2, 7)
  while (taken.has(id))
  return id
}

function base(doc: StudioDoc, name: string) {
  return {
    id: newId(doc),
    name,
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    rotation: 0,
    flipX: false,
    flipY: false,
    opacity: 1,
    blend: 'normal' as BlendMode,
    visible: true,
    locked: false,
    shadow: null,
    glow: null,
    stroke: null,
    tint: null,
    adjust: { ...NEUTRAL }
  }
}

export function makeImage(doc: StudioDoc, asset: AssetInfo, fit: 'cover' | 'contain' = 'contain'): ImageLayer {
  const scale =
    fit === 'cover'
      ? Math.max(doc.width / asset.w, doc.height / asset.h)
      : Math.min(doc.width / asset.w, doc.height / asset.h, 1)
  const width = Math.round(asset.w * scale)
  const height = Math.round(asset.h * scale)
  return {
    ...base(doc, asset.label || 'Image'),
    kind: 'image',
    asset: asset.id,
    mask: null,
    width,
    height,
    x: Math.round((doc.width - width) / 2),
    y: Math.round((doc.height - height) / 2)
  }
}

export function makeText(doc: StudioDoc, text = 'YOUR TEXT'): TextLayer {
  const layer: TextLayer = {
    ...base(doc, text.replace(/\*/g, '').slice(0, 24) || 'Text'),
    kind: 'text',
    text,
    font: 'Montserrat',
    size: 120,
    weight: 900,
    italic: false,
    uppercase: false,
    fill: '#ffffff',
    highlight: '#ff2a2a',
    align: 'center',
    letterSpacing: 0,
    lineHeight: 1
  }
  const box = measureText(layer)
  return { ...layer, ...box, x: Math.round((doc.width - box.width) / 2), y: Math.round((doc.height - box.height) / 2) }
}

export function makeShape(doc: StudioDoc, shape: ShapeLayer['shape'] = 'rect'): ShapeLayer {
  return {
    ...base(doc, shape === 'polygon' ? 'Shape' : shape === 'ellipse' ? 'Ellipse' : 'Rectangle'),
    kind: 'shape',
    shape,
    fill: '#ff2a2a',
    gradient: null,
    radius: 0,
    feather: 0,
    points: [],
    x: doc.width / 2 - 150,
    y: doc.height / 2 - 100,
    width: 300,
    height: 200
  }
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v))
const COLOR = /^(#[0-9a-f]{3,8}|rgba?\([^)]*\)|hsla?\([^)]*\)|[a-z]+)$/i

function asNumber(v: unknown, key: string): number {
  const n = typeof v === 'string' ? Number(v) : v
  if (typeof n !== 'number' || !Number.isFinite(n)) throw new Error(`${key} must be a number`)
  return n
}

export function asColor(v: unknown, key: string): string {
  if (typeof v !== 'string' || !COLOR.test(v.trim())) throw new Error(`${key} must be a CSS colour`)
  return v.trim()
}

function mergeEffect<T extends object>(
  current: T | null,
  value: unknown,
  fallback: T,
  key: string
): T | null {
  if (value === null || value === false) return null
  if (typeof value !== 'object') throw new Error(`${key} must be an object or null`)
  const next = { ...(current ?? fallback) } as Record<string, unknown>
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (!(k in fallback)) continue
    const sample = (fallback as Record<string, unknown>)[k]
    if (typeof sample === 'number') next[k] = asNumber(v, `${key}.${k}`)
    else if (k === 'type') next[k] = v === 'linear' ? 'linear' : 'radial'
    else next[k] = asColor(v, `${key}.${k}`)
  }
  for (const k of ['opacity', 'amount']) {
    if (typeof next[k] === 'number') next[k] = clamp(next[k] as number, 0, 1)
  }
  return next as T
}

const COMMON = new Set([
  'name', 'x', 'y', 'width', 'height', 'rotation', 'flipX', 'flipY', 'opacity', 'blend',
  'visible', 'locked', 'shadow', 'glow', 'stroke', 'tint', 'adjust'
])
const BY_KIND: Record<Layer['kind'], Set<string>> = {
  image: new Set(),
  text: new Set(['text', 'font', 'size', 'weight', 'italic', 'uppercase', 'fill', 'highlight', 'align', 'letterSpacing', 'lineHeight']),
  shape: new Set(['shape', 'fill', 'gradient', 'radius', 'feather', 'points'])
}

export interface PatchResult {
  layer: Layer
  ignored: string[]
}

export function patchLayer(layer: Layer, patch: Record<string, unknown>): PatchResult {
  const next = { ...layer } as Record<string, unknown>
  const ignored: string[] = []
  const allowed = BY_KIND[layer.kind]
  const aspect = layer.width / Math.max(1, layer.height)

  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue
    if (!COMMON.has(key) && !allowed.has(key)) {
      ignored.push(key)
      continue
    }
    switch (key) {
      case 'name':
      case 'text':
        next[key] = String(value)
        break
      case 'font':
        next[key] = FONTS.includes(value as (typeof FONTS)[number]) ? value : layer.kind === 'text' ? layer.font : 'Montserrat'
        break
      case 'blend':
        if (!BLEND_MODES.includes(value as BlendMode)) throw new Error('Unknown blend mode ' + value)
        next[key] = value
        break
      case 'align':
        next[key] = value === 'left' || value === 'right' ? value : 'center'
        break
      case 'shape':
        next[key] = value === 'ellipse' || value === 'polygon' ? value : 'rect'
        break
      case 'flipX':
      case 'flipY':
      case 'visible':
      case 'locked':
      case 'italic':
      case 'uppercase':
        next[key] = !!value
        break
      case 'fill':
      case 'highlight':
        next[key] = asColor(value, key)
        break
      case 'shadow':
      case 'glow':
      case 'stroke':
      case 'tint':
      case 'gradient':
        next[key] = mergeEffect(next[key] as object | null, value, EFFECT_DEFAULTS[key], key)
        break
      case 'adjust': {
        const adjust = { ...(next.adjust as Adjust) }
        for (const [k, v] of Object.entries((value ?? {}) as Record<string, unknown>)) {
          if (k in NEUTRAL) adjust[k as keyof Adjust] = asNumber(v, 'adjust.' + k)
        }
        next.adjust = adjust
        break
      }
      case 'points': {
        if (!Array.isArray(value) || value.length < 3) throw new Error('points needs at least 3 [x, y] pairs')
        const pts = value.map((p, i) => {
          if (!Array.isArray(p)) throw new Error(`points[${i}] must be [x, y]`)
          return [asNumber(p[0], 'x'), asNumber(p[1], 'y')] as [number, number]
        })
        const xs = pts.map((p) => p[0])
        const ys = pts.map((p) => p[1])
        const x = Math.min(...xs)
        const y = Math.min(...ys)
        const w = Math.max(1, Math.max(...xs) - x)
        const h = Math.max(1, Math.max(...ys) - y)
        Object.assign(next, { x, y, width: w, height: h, rotation: 0, shape: 'polygon' })
        next.points = pts.map(([px, py]) => [(px - x) / w, (py - y) / h])
        break
      }
      default:
        next[key] = asNumber(value, key)
    }
  }

  if (typeof next.opacity === 'number') next.opacity = clamp(next.opacity, 0, 1)
  if (layer.kind === 'image' && ('width' in patch) !== ('height' in patch)) {
    if ('width' in patch) next.height = (next.width as number) / aspect
    else next.width = (next.height as number) * aspect
  }
  next.width = Math.max(1, next.width as number)
  next.height = Math.max(1, next.height as number)
  if (layer.kind === 'text') {
    next.size = clamp(next.size as number, 6, 900)
    next.weight = clamp(Math.round((next.weight as number) / 100) * 100, 100, 900)
  }
  if (layer.kind === 'shape') {
    next.feather = clamp(next.feather as number, 0, 400)
    next.radius = Math.max(0, next.radius as number)
  }

  let result = next as unknown as Layer
  if (result.kind === 'text') result = fitText(layer as TextLayer, result, patch)
  return { layer: result, ignored }
}

// Text boxes size themselves; keep the edge the alignment hangs from still while the
// content changes, unless the caller placed the box explicitly.
function fitText(before: TextLayer, after: TextLayer, patch: Record<string, unknown>): TextLayer {
  const box = measureText(after)
  let x = after.x
  if ('x' in patch && 'width' in patch) {
    const span = after.width
    if (after.align === 'center') x += (span - box.width) / 2
    else if (after.align === 'right') x += span - box.width
  } else if (!('x' in patch)) {
    if (after.align === 'center') x = before.x + before.width / 2 - box.width / 2
    else if (after.align === 'right') x = before.x + before.width - box.width
  }
  return { ...after, x, width: box.width, height: box.height }
}

export function refitText(layer: Layer): Layer {
  if (layer.kind !== 'text') return layer
  const box = measureText(layer)
  if (Math.abs(box.width - layer.width) < 0.5 && Math.abs(box.height - layer.height) < 0.5) return layer
  return fitText(layer, layer, {})
}

export const findLayer = (doc: StudioDoc, id: string): Layer => {
  const layer = doc.layers.find((l) => l.id === id)
  if (!layer) throw new Error(`No layer with id ${id}. Call get_document for current ids.`)
  return layer
}

export function insertLayer(doc: StudioDoc, layer: Layer, belowId?: string | null): StudioDoc {
  const layers = [...doc.layers]
  const at = belowId ? layers.findIndex((l) => l.id === belowId) : -1
  if (at >= 0) layers.splice(at, 0, layer)
  else layers.push(layer)
  return { ...doc, layers }
}

export function replaceLayer(doc: StudioDoc, layer: Layer): StudioDoc {
  return { ...doc, layers: doc.layers.map((l) => (l.id === layer.id ? layer : l)) }
}

export function removeLayer(doc: StudioDoc, id: string): StudioDoc {
  findLayer(doc, id)
  return { ...doc, layers: doc.layers.filter((l) => l.id !== id) }
}

export function arrangeLayer(doc: StudioDoc, id: string, to: 'top' | 'bottom' | 'up' | 'down' | number): StudioDoc {
  const layers = [...doc.layers]
  const from = layers.findIndex((l) => l.id === id)
  if (from < 0) throw new Error(`No layer with id ${id}`)
  const [layer] = layers.splice(from, 1)
  const target =
    to === 'top' ? layers.length
      : to === 'bottom' ? 0
        : to === 'up' ? Math.min(layers.length, from + 1)
          : to === 'down' ? Math.max(0, from - 1)
            : clamp(to, 0, layers.length)
  layers.splice(target, 0, layer)
  return { ...doc, layers }
}

export function duplicateLayer(doc: StudioDoc, id: string): { doc: StudioDoc; layer: Layer } {
  const source = findLayer(doc, id)
  const layer = { ...source, id: newId(doc), name: source.name + ' copy' } as Layer
  const layers = [...doc.layers]
  layers.splice(layers.indexOf(source) + 1, 0, layer)
  return { doc: { ...doc, layers }, layer }
}

export function polygonPoints(layer: ShapeLayer): [number, number][] {
  return layer.points.map(([px, py]) => [
    Math.round((layer.x + px * layer.width) * 10) / 10,
    Math.round((layer.y + py * layer.height) * 10) / 10
  ])
}

export function describeLayer(layer: Layer): Record<string, unknown> {
  const round = (n: number): number => Math.round(n * 10) / 10
  const out: Record<string, unknown> = {
    ...layer,
    x: round(layer.x),
    y: round(layer.y),
    width: round(layer.width),
    height: round(layer.height)
  }
  if (layer.kind === 'shape') {
    if (layer.shape === 'polygon') out.points = polygonPoints(layer)
    else delete out.points
  }
  return out
}
