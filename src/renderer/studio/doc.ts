import { BLEND_MODES, CANVAS_H, CANVAS_W } from '@shared/studio'
import type {
  Adjust, AssetInfo, BlendMode, Glow, Gradient, ImageLayer, Layer, LayerGroup, Outline, Shadow,
  ShapeLayer, StudioDoc, TextLayer, Tint
} from '@shared/studio'
import { findFont } from './fonts'
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
  layers: [],
  groups: []
})

// Docs saved before groups existed carry neither field.
export function normalizeDoc(doc: StudioDoc): StudioDoc {
  return tidyGroups({
    ...doc,
    groups: doc.groups ?? [],
    layers: doc.layers.map((l) => (l.group === undefined ? { ...l, group: null } : l))
  })
}

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
    group: null,
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
    gradient: null,
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
  text: new Set(['text', 'font', 'size', 'weight', 'italic', 'uppercase', 'fill', 'gradient', 'highlight', 'align', 'letterSpacing', 'lineHeight']),
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
      case 'font': {
        const font = findFont(String(value))
        if (!font) throw new Error(`Font "${value}" is not installed. Call list_fonts for what is available.`)
        next[key] = font.name
        break
      }
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

export const newGroupId = (doc: StudioDoc): string => {
  let id = ''
  do id = 'G' + Math.random().toString(36).slice(2, 7)
  while (doc.groups.some((g) => g.id === id))
  return id
}

export function tidyGroups(doc: StudioDoc): StudioDoc {
  const used = new Set(doc.layers.map((l) => l.group))
  const known = new Set(doc.groups.map((g) => g.id))
  const stray = doc.layers.some((l) => l.group && !known.has(l.group))
  const empty = doc.groups.some((g) => !used.has(g.id))
  if (!stray && !empty) return doc
  return {
    ...doc,
    groups: doc.groups.filter((g) => used.has(g.id)),
    layers: stray ? doc.layers.map((l) => (l.group && !known.has(l.group) ? { ...l, group: null } : l)) : doc.layers
  }
}

export const findGroup = (doc: StudioDoc, id: string): LayerGroup => {
  const group = doc.groups.find((g) => g.id === id)
  if (!group) throw new Error(`No group with id ${id}. Call get_document for current group ids.`)
  return group
}

export const groupMembers = (doc: StudioDoc, id: string): Layer[] => doc.layers.filter((l) => l.group === id)

// Members are pulled together where the topmost one sat, so a group always reads as one
// block in the layers panel.
export function groupLayers(doc: StudioDoc, ids: string[], name: string): { doc: StudioDoc; group: LayerGroup } {
  const members = doc.layers.filter((l) => ids.includes(l.id))
  if (members.length < 2) throw new Error('A group needs at least two layers')
  const group = { id: newGroupId(doc), name: name.trim() || 'Group' }
  const top = doc.layers.indexOf(members[members.length - 1])
  const rest = doc.layers.filter((l) => !ids.includes(l.id))
  const at = doc.layers.slice(0, top).filter((l) => !ids.includes(l.id)).length
  rest.splice(at, 0, ...members.map((l) => ({ ...l, group: group.id })))
  return { doc: tidyGroups({ ...doc, layers: rest, groups: [...doc.groups, group] }), group }
}

export function ungroup(doc: StudioDoc, id: string): StudioDoc {
  findGroup(doc, id)
  return tidyGroups({ ...doc, layers: doc.layers.map((l) => (l.group === id ? { ...l, group: null } : l)) })
}

export function arrangeGroup(doc: StudioDoc, id: string, to: 'top' | 'bottom' | 'up' | 'down'): StudioDoc {
  const members = groupMembers(doc, id)
  const rest = doc.layers.filter((l) => l.group !== id)
  const now = doc.layers.slice(0, doc.layers.indexOf(members[0])).filter((l) => l.group !== id).length
  const at = to === 'top' ? rest.length : to === 'bottom' ? 0 : to === 'up' ? Math.min(rest.length, now + 1) : Math.max(0, now - 1)
  rest.splice(at, 0, ...members)
  return { ...doc, layers: rest }
}

export interface Bounds { x: number; y: number; width: number; height: number }

export function boundsOf(layers: Layer[]): Bounds {
  const corners = layers.flatMap((l) => {
    const a = (l.rotation * Math.PI) / 180
    const cx = l.x + l.width / 2
    const cy = l.y + l.height / 2
    return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sy]) => {
      const hx = (sx * l.width) / 2
      const hy = (sy * l.height) / 2
      return [cx + hx * Math.cos(a) - hy * Math.sin(a), cy + hx * Math.sin(a) + hy * Math.cos(a)]
    })
  })
  const xs = corners.map((c) => c[0])
  const ys = corners.map((c) => c[1])
  const x = Math.min(...xs)
  const y = Math.min(...ys)
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y }
}

// Scales a set of layers as one object about a fixed point: positions, boxes, type size and
// the effects whose size is measured in pixels.
export function scaleLayer(l: Layer, k: number, ox: number, oy: number): Layer {
  const x = ox + (l.x - ox) * k
  const y = oy + (l.y - oy) * k
  const px = (n: number): number => Math.max(0, n * k)
  const scaled = {
    ...l,
    x,
    y,
    width: Math.max(1, l.width * k),
    height: Math.max(1, l.height * k),
    stroke: l.stroke && { ...l.stroke, width: px(l.stroke.width) },
    glow: l.glow && { ...l.glow, size: px(l.glow.size) },
    shadow: l.shadow && { ...l.shadow, blur: px(l.shadow.blur), x: l.shadow.x * k, y: l.shadow.y * k }
  } as Layer
  if (scaled.kind === 'text') return { ...scaled, size: Math.max(6, scaled.size * k) }
  if (scaled.kind === 'shape') return { ...scaled, radius: px(scaled.radius), feather: px(scaled.feather) }
  return scaled
}

// Copies keep their own groups: a fully copied group becomes a new group, a lone member
// stays in the group it came from.
export function duplicateLayers(doc: StudioDoc, ids: string[], shift = 0): { doc: StudioDoc; ids: string[] } {
  let next = doc
  const copies: string[] = []
  const regroup = new Map<string, string>()
  for (const g of doc.groups) {
    const members = groupMembers(doc, g.id)
    if (!members.every((l) => ids.includes(l.id))) continue
    const copy = { id: newGroupId(next), name: g.name + ' copy' }
    next = { ...next, groups: [...next.groups, copy] }
    regroup.set(g.id, copy.id)
  }
  const sources = doc.layers.filter((l) => ids.includes(l.id))
  const top = doc.layers.indexOf(sources[sources.length - 1])
  const layers = [...next.layers]
  for (const src of sources) {
    const layer = {
      ...src,
      id: newId({ ...next, layers }),
      name: src.name + ' copy',
      x: src.x + shift,
      y: src.y + shift,
      group: src.group ? regroup.get(src.group) ?? src.group : null
    } as Layer
    layers.splice(top + 1 + copies.length, 0, layer)
    copies.push(layer.id)
  }
  return { doc: { ...next, layers }, ids: copies }
}

export function polygonPoints(layer: ShapeLayer): [number, number][] {
  return layer.points.map(([px, py]) => [
    Math.round((layer.x + px * layer.width) * 10) / 10,
    Math.round((layer.y + py * layer.height) * 10) / 10
  ])
}

export function describeGroups(doc: StudioDoc): Record<string, unknown>[] {
  const round = (n: number): number => Math.round(n * 10) / 10
  return doc.groups.map((g) => {
    const members = groupMembers(doc, g.id)
    const b = boundsOf(members)
    return {
      id: g.id,
      name: g.name,
      layer_ids_top_to_bottom: [...members].reverse().map((l) => l.id),
      box: { x: round(b.x), y: round(b.y), width: round(b.width), height: round(b.height) }
    }
  })
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
