import {
  BLEND_MODES, BLUR_STYLES, CANVAS_H, CANVAS_W, GRADIENT_TYPES, SHAPES, STROKE_POSITIONS, WARP_STYLES
} from '@shared/studio'
import type {
  Adjust, AdjustLayer, AssetInfo, BlendMode, BlurFx, BlurStyle, Clip, Corners, CurvePoint, Curves, Glow, Grade,
  Gradient, GradientStop, GradientType, ImageLayer, Layer, LayerGroup, Levels, Line, Outline, Shadow, ShapeKind,
  ShapeLayer, StrokePosition, StudioDoc, TextLayer, TextStyle, Tint, Tone, Warp, WarpStyle, Contact, Finish, LightWrap
} from '@shared/studio'
import { findFont } from './fonts'
import { measureText } from './text'

export const NEUTRAL: Adjust = { brightness: 100, contrast: 100, saturation: 100, hue: 0, blur: 0 }

const EFFECT_DEFAULTS = {
  shadow: { color: '#000000', opacity: 0.7, blur: 24, x: 0, y: 12, inner: false } as Shadow,
  glow: { color: '#ff2a2a', opacity: 0.9, size: 32, inner: false } as Glow,
  stroke: { color: '#ffffff', width: 8, opacity: 1, position: 'outside' } as Outline,
  tint: { color: '#ff1a1a', amount: 0.35 } as Tint,
  gradient: { type: 'radial', from: '#ff2a2a', to: '#00000000', angle: 90, stops: [] } as Gradient,
  line: { color: '#ffffff', width: 6, opacity: 1, dash: 0 } as Line,
  warp: { style: 'arch', bend: 0.3 } as Warp,
  blurFx: { style: 'motion', amount: 24, angle: 0, x: 0.5, y: 0.5, focus: 0.3 } as BlurFx,
  lightWrap: { amount: 0.6, size: 24 } as LightWrap,
  contact: { color: '#000000', opacity: 0.65, blur: 18, squash: 0.12, y: 0 } as Contact
}

export const FINISH_DEFAULT: Finish = { sharpen: 0, clarity: 0, vibrance: 0, bloom: 0, vignette: 0, grain: 0 }

export const LEVELS_NEUTRAL: Levels = { black: 0, white: 255, gamma: 1, outBlack: 0, outWhite: 255 }
export const NO_TONE: Tone = { levels: null, curves: null, map: null, lut: null, grade: null }

export const effectDefault = <K extends keyof typeof EFFECT_DEFAULTS>(
  name: K
): (typeof EFFECT_DEFAULTS)[K] => ({ ...EFFECT_DEFAULTS[name] })

// shadow/glow/stroke each hold a stack now. The singular names stay as shorthand for the
// first one in the stack, so a document, a tool call or a UI control written against one
// effect keeps working.
const STACKS = { shadow: 'shadows', glow: 'glows', stroke: 'strokes' } as const
type StackName = keyof typeof STACKS

const CLIP_DEFAULT: Clip = { from: '', mode: 'alpha', invert: false, feather: 0 }

export const emptyDoc = (): StudioDoc => ({
  width: CANVAS_W,
  height: CANVAS_H,
  background: '#0a0a0a',
  layers: [],
  groups: [],
  guides: [],
  finish: null
})

// Docs saved before groups, masks on every layer, clipping or effect stacks lack those fields.
export function normalizeDoc(doc: StudioDoc): StudioDoc {
  return tidyGroups({
    ...doc,
    groups: (doc.groups ?? []).map((g) => ({ ...g, parent: g.parent ?? null, mask: g.mask ?? null })),
    guides: doc.guides ?? [],
    finish: doc.finish ?? null,
    layers: doc.layers.map((l) => {
      const { shadow, glow, stroke, ...rest } = l as Layer & Partial<Record<StackName, unknown>>
      const old = { shadow, glow, stroke }
      const stack = <T,>(name: StackName, list: T[] | undefined): T[] =>
        list ?? (old[name] ? [old[name] as T] : [])
      const common = {
        ...rest,
        group: l.group ?? null,
        mask: l.mask ?? null,
        clip: l.clip ?? null,
        corners: l.corners ?? null,
        warp: l.warp ?? null,
        tone: l.tone ?? null,
        blurFx: l.blurFx ?? null,
        lightWrap: l.lightWrap ?? null,
        contact: l.contact ?? null,
        link: l.link ?? null,
        shadows: stack<Shadow>('shadow', l.shadows).map((e) => ({ ...EFFECT_DEFAULTS.shadow, ...e })),
        glows: stack<Glow>('glow', l.glows).map((e) => ({ ...EFFECT_DEFAULTS.glow, ...e })),
        strokes: stack<Outline>('stroke', l.strokes).map((e) => ({ ...EFFECT_DEFAULTS.stroke, ...e }))
      } as Layer
      const ramp = (g: Gradient | null): Gradient | null => (g ? { ...g, stops: g.stops ?? [] } : null)
      if (common.kind === 'text') {
        return {
          ...common,
          gradient: ramp(common.gradient),
          wrap: common.wrap ?? null,
          fit: common.fit ?? false,
          arc: common.arc ?? 0,
          styles: common.styles ?? []
        }
      }
      if (common.kind === 'shape') {
        return {
          ...common,
          gradient: ramp(common.gradient),
          line: common.line ?? null,
          sides: common.sides ?? 5,
          inset: common.inset ?? 0.5,
          smooth: common.smooth ?? 0
        }
      }
      return common
    })
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
    shadows: [],
    glows: [],
    strokes: [],
    tint: null,
    adjust: { ...NEUTRAL },
    mask: null,
    clip: null,
    corners: null,
    warp: null,
    tone: null,
    blurFx: null,
    lightWrap: null,
    contact: null,
    link: null
  }
}

// Everything a layer needs loaded before it can be drawn.
export function assetsOf(l: Layer): string[] {
  return [
    ...(l.kind === 'image' ? [l.asset] : []),
    ...(l.mask ? [l.mask] : []),
    ...(l.tone?.lut ? [l.tone.lut.asset] : [])
  ]
}

export function docAssets(doc: StudioDoc): string[] {
  return [...doc.layers.flatMap(assetsOf), ...doc.groups.flatMap((g) => (g.mask ? [g.mask] : []))]
}

export function patchFinish(current: Finish | null, value: unknown): Finish | null {
  if (value === null || value === false) return null
  if (typeof value !== 'object') throw new Error('finish must be an object or null')
  const next = { ...(current ?? FINISH_DEFAULT) }
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (k in FINISH_DEFAULT) next[k as keyof Finish] = clamp(asNumber(v, 'finish.' + k), 0, 1)
  }
  return Object.values(next).some((v) => v > 0) ? next : null
}

export function makeAdjust(doc: StudioDoc, name = 'Adjustment'): AdjustLayer {
  return { ...base(doc, name), kind: 'adjust', width: doc.width, height: doc.height }
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
    lineHeight: 1,
    wrap: null,
    fit: false,
    arc: 0,
    styles: []
  }
  const box = measureText(layer)
  return { ...layer, ...box, x: Math.round((doc.width - box.width) / 2), y: Math.round((doc.height - box.height) / 2) }
}

const SHAPE_NAMES: Record<ShapeKind, string> = {
  rect: 'Rectangle', ellipse: 'Ellipse', polygon: 'Shape', star: 'Star', arrow: 'Arrow', bubble: 'Speech bubble'
}

export function makeShape(doc: StudioDoc, shape: ShapeKind = 'rect'): ShapeLayer {
  return {
    ...base(doc, SHAPE_NAMES[shape]),
    kind: 'shape',
    shape,
    fill: '#ff2a2a',
    gradient: null,
    radius: shape === 'bubble' ? 36 : 0,
    feather: 0,
    points: [],
    line: null,
    sides: 5,
    inset: shape === 'arrow' ? 0.45 : 0.5,
    smooth: 0,
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
    else if (typeof sample === 'boolean') next[k] = !!v
    else if (k === 'type') next[k] = oneOf(GRADIENT_TYPES, v, `${key}.type`) as GradientType
    else if (k === 'style' && key === 'blurFx') next[k] = oneOf(BLUR_STYLES, v, `${key}.style`) as BlurStyle
    else if (k === 'style') next[k] = oneOf(WARP_STYLES, v, `${key}.style`) as WarpStyle
    else if (k === 'stops') next[k] = asStops(v, `${key}.stops`)
    else if (k === 'position') {
      if (!STROKE_POSITIONS.includes(v as StrokePosition)) {
        throw new Error(`${key}.position must be one of ${STROKE_POSITIONS.join(', ')}`)
      }
      next[k] = v
    } else next[k] = asColor(v, `${key}.${k}`)
  }
  for (const k of key === 'blurFx' ? ['opacity'] : ['opacity', 'amount']) {
    if (typeof next[k] === 'number') next[k] = clamp(next[k] as number, 0, 1)
  }
  return next as T
}

function oneOf<T extends string>(list: readonly T[], v: unknown, key: string): T {
  if (!list.includes(v as T)) throw new Error(`${key} must be one of ${list.join(', ')}`)
  return v as T
}

// A ramp of colour stops; a single stop is no gradient at all, so two is the floor.
function asStops(v: unknown, key: string): GradientStop[] {
  if (!Array.isArray(v)) throw new Error(`${key} must be a list of { at, color }`)
  if (v.length === 0) return []
  if (v.length < 2 || v.length > 16) throw new Error(`${key} needs 2 to 16 stops`)
  return v
    .map((s, i) => {
      const o = (s ?? {}) as Record<string, unknown>
      return { at: clamp(asNumber(o.at, `${key}[${i}].at`), 0, 1), color: asColor(o.color, `${key}[${i}].color`) }
    })
    .sort((a, b) => a.at - b.at)
}

function asCorners(v: unknown): Corners | null {
  if (v === null || v === false) return null
  if (!Array.isArray(v) || v.length !== 4) throw new Error('corners must be four [dx, dy] offsets: top-left, top-right, bottom-right, bottom-left')
  const out = v.map((p, i) => {
    if (!Array.isArray(p)) throw new Error(`corners[${i}] must be [dx, dy]`)
    return [asNumber(p[0], `corners[${i}][0]`), asNumber(p[1], `corners[${i}][1]`)] as [number, number]
  }) as Corners
  return out.every(([x, y]) => x === 0 && y === 0) ? null : out
}

function asStyles(v: unknown): TextStyle[] {
  if (v === null) return []
  if (!Array.isArray(v)) throw new Error('styles must be a list of { start, end, ... }')
  return v.map((s, i) => {
    const o = (s ?? {}) as Record<string, unknown>
    const key = `styles[${i}]`
    const style: TextStyle = {
      start: Math.max(0, Math.round(asNumber(o.start, key + '.start'))),
      end: Math.max(0, Math.round(asNumber(o.end, key + '.end')))
    }
    if (o.fill !== undefined) style.fill = asColor(o.fill, key + '.fill')
    if (o.scale !== undefined) style.scale = clamp(asNumber(o.scale, key + '.scale'), 0.2, 5)
    if (o.weight !== undefined) style.weight = clamp(Math.round(asNumber(o.weight, key + '.weight') / 100) * 100, 100, 900)
    if (o.italic !== undefined) style.italic = !!o.italic
    if (o.rise !== undefined) style.rise = asNumber(o.rise, key + '.rise')
    if (o.font !== undefined) {
      const font = findFont(String(o.font))
      if (!font) throw new Error(`Font "${o.font}" is not installed. Call list_fonts for what is available.`)
      style.font = font.name
    }
    return style
  })
}

function asCurve(v: unknown, key: string): CurvePoint[] {
  if (v === null || v === undefined) return []
  if (!Array.isArray(v) || v.length > 16) throw new Error(`${key} must be up to 16 [input, output] points, 0 to 255`)
  return v.map((p, i) => {
    if (!Array.isArray(p)) throw new Error(`${key}[${i}] must be [input, output]`)
    return [clamp(asNumber(p[0], key), 0, 255), clamp(asNumber(p[1], key), 0, 255)] as CurvePoint
  })
}

function triple(v: unknown, key: string, fallback: [number, number, number]): [number, number, number] {
  if (v === undefined) return fallback
  if (!Array.isArray(v) || v.length !== 3) throw new Error(`${key} must be [red, green, blue]`)
  return v.map((x) => asNumber(x, key)) as [number, number, number]
}

type Part = Record<string, unknown> | null | undefined

function partOf(given: Record<string, unknown>, k: string): Part {
  const v = given[k]
  if (v === undefined) return undefined
  if (v === null || v === false) return null
  if (typeof v !== 'object') throw new Error(`tone.${k} must be an object or null`)
  return v as Record<string, unknown>
}

function mergeLevels(cur: Levels | null, given: Record<string, unknown>): Levels {
  const lv = { ...(cur ?? LEVELS_NEUTRAL) }
  for (const k of Object.keys(LEVELS_NEUTRAL) as (keyof Levels)[]) {
    if (given[k] !== undefined) lv[k] = asNumber(given[k], 'tone.levels.' + k)
  }
  return {
    black: clamp(lv.black, 0, 254),
    white: clamp(lv.white, 1, 255),
    gamma: clamp(lv.gamma, 0.1, 9.99),
    outBlack: clamp(lv.outBlack, 0, 255),
    outWhite: clamp(lv.outWhite, 0, 255)
  }
}

function mergeCurves(cur: Curves | null, given: Record<string, unknown>): Curves | null {
  const base: Curves = cur ?? { rgb: [], r: [], g: [], b: [] }
  const pick = (k: keyof Curves): CurvePoint[] => (given[k] === undefined ? base[k] : asCurve(given[k], 'tone.curves.' + k))
  const next = { rgb: pick('rgb'), r: pick('r'), g: pick('g'), b: pick('b') }
  return Object.values(next).some((c) => c.length >= 2) ? next : null
}

function mergeGrade(cur: Grade | null, given: Record<string, unknown>): Grade {
  const base: Grade = cur ?? { gain: [1, 1, 1], lift: [0, 0, 0], amount: 1 }
  return {
    gain: triple(given.gain, 'tone.grade.gain', base.gain).map((v) => clamp(v, 0, 4)) as Grade['gain'],
    lift: triple(given.lift, 'tone.grade.lift', base.lift).map((v) => clamp(v, -1, 1)) as Grade['lift'],
    amount: clamp(given.amount === undefined ? base.amount : asNumber(given.amount, 'tone.grade.amount'), 0, 1)
  }
}

// Each part of a tone adjustment merges on its own and null drops just that part; when
// nothing is left the whole adjustment goes, so a neutral layer stores no tone at all.
function mergeTone(current: Tone | null, value: unknown): Tone | null {
  if (value === null || value === false) return null
  if (typeof value !== 'object') throw new Error('tone must be an object or null')
  const given = value as Record<string, unknown>
  const next: Tone = { ...NO_TONE, ...current }
  const levels = partOf(given, 'levels')
  if (levels !== undefined) next.levels = levels && mergeLevels(next.levels, levels)
  const curves = partOf(given, 'curves')
  if (curves !== undefined) next.curves = curves && mergeCurves(next.curves, curves)
  const grade = partOf(given, 'grade')
  if (grade !== undefined) next.grade = grade && mergeGrade(next.grade, grade)
  const map = partOf(given, 'map')
  if (map !== undefined) {
    const stops = map?.stops === undefined ? next.map?.stops ?? [] : asStops(map.stops, 'tone.map.stops')
    if (map && stops.length < 2) throw new Error('tone.map needs stops: at least two { at, color }, dark to light')
    const amount = map?.amount === undefined ? next.map?.amount ?? 1 : asNumber(map.amount, 'tone.map.amount')
    next.map = map && { stops, amount: clamp(amount, 0, 1) }
  }
  const lut = partOf(given, 'lut')
  if (lut !== undefined) {
    const asset = typeof lut?.asset === 'string' ? lut.asset : next.lut?.asset
    if (lut && !asset) throw new Error('tone.lut needs the asset of a loaded .cube LUT')
    const amount = lut?.amount === undefined ? next.lut?.amount ?? 1 : asNumber(lut.amount, 'tone.lut.amount')
    next.lut = lut && { asset: asset!, name: typeof lut.name === 'string' ? lut.name : next.lut?.name ?? 'LUT', amount: clamp(amount, 0, 1) }
  }
  return Object.values(next).some(Boolean) ? next : null
}

// A stack can be set as a list, or one entry at a time through the singular name.
function mergeStack<T extends object>(
  current: T[],
  value: unknown,
  fallback: T,
  key: string
): T[] {
  if (value === null || value === false) return []
  const items = Array.isArray(value) ? value : [value]
  if (items.length > 8) throw new Error(`${key} takes at most 8 entries`)
  return items.map((item, i) => mergeEffect(current[i] ?? null, item, fallback, `${key}[${i}]`)!)
}

const COMMON = new Set([
  'name', 'x', 'y', 'width', 'height', 'rotation', 'flipX', 'flipY', 'opacity', 'blend',
  'visible', 'locked', 'shadow', 'shadows', 'glow', 'glows', 'stroke', 'strokes', 'tint',
  'adjust', 'clip', 'corners', 'warp', 'tone', 'blurFx', 'lightWrap', 'contact', 'link'
])
const OUTLINE_EFFECTS = new Set(['shadow', 'shadows', 'glow', 'glows', 'stroke', 'strokes'])
const BY_KIND: Record<Layer['kind'], Set<string>> = {
  image: new Set(),
  adjust: new Set(),
  text: new Set([
    'text', 'font', 'size', 'weight', 'italic', 'uppercase', 'fill', 'gradient', 'highlight', 'align',
    'letterSpacing', 'lineHeight', 'wrap', 'fit', 'arc', 'styles'
  ]),
  shape: new Set(['shape', 'fill', 'gradient', 'radius', 'feather', 'points', 'line', 'sides', 'inset', 'smooth'])
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
    if ((!COMMON.has(key) && !allowed.has(key)) || (layer.kind === 'adjust' && OUTLINE_EFFECTS.has(key))) {
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
        next[key] = SHAPES.includes(value as ShapeKind) ? value : 'rect'
        break
      case 'corners':
        next.corners = asCorners(value)
        break
      case 'styles':
        next.styles = asStyles(value)
        break
      case 'wrap':
        next.wrap = value === null || value === false ? null : Math.max(20, asNumber(value, 'wrap'))
        break
      case 'tone':
        next.tone = mergeTone(next.tone as Tone | null, value)
        break
      case 'blurFx': {
        const b = mergeEffect(next.blurFx as BlurFx | null, value, EFFECT_DEFAULTS.blurFx, 'blurFx')
        next.blurFx = b && {
          ...b,
          amount: clamp(b.amount, 0, b.style === 'spin' ? 90 : 300),
          x: clamp(b.x, -1, 2),
          y: clamp(b.y, -1, 2),
          focus: clamp(b.focus, 0, 1)
        }
        break
      }
      case 'lightWrap':
      case 'contact': {
        const e = mergeEffect(next[key] as object | null, value, EFFECT_DEFAULTS[key], key) as (LightWrap & Contact) | null
        if (e && 'size' in e) e.size = clamp(e.size, 1, 200)
        if (e && 'squash' in e) Object.assign(e, { squash: clamp(e.squash, 0.02, 1), blur: clamp(e.blur, 0, 200) })
        next[key] = e
        break
      }
      case 'link':
        next.link = typeof value === 'string' && value ? value : null
        break
      case 'line':
      case 'warp':
        next[key] = mergeEffect(next[key] as object | null, value, EFFECT_DEFAULTS[key], key)
        break
      case 'flipX':
      case 'flipY':
      case 'visible':
      case 'locked':
      case 'italic':
      case 'uppercase':
      case 'fit':
        next[key] = !!value
        break
      case 'fill':
      case 'highlight':
        next[key] = asColor(value, key)
        break
      case 'shadow':
      case 'glow':
      case 'stroke': {
        const stack = STACKS[key]
        next[stack] = mergeStack(next[stack] as object[], value, EFFECT_DEFAULTS[key], key)
        break
      }
      case 'shadows':
      case 'glows':
      case 'strokes': {
        const one = key.slice(0, -1) as StackName
        next[key] = mergeStack(next[key] as object[], value, EFFECT_DEFAULTS[one], key)
        break
      }
      case 'tint':
      case 'gradient':
        next[key] = mergeEffect(next[key] as object | null, value, EFFECT_DEFAULTS[key], key)
        break
      case 'clip': {
        if (value === null || value === false) {
          next.clip = null
          break
        }
        if (typeof value !== 'object') throw new Error('clip must be an object or null')
        const given = value as Record<string, unknown>
        const current = (next.clip as Clip | null) ?? CLIP_DEFAULT
        const from = given.from === undefined ? current.from : String(given.from)
        if (!from) throw new Error('clip.from must name the layer or group to clip to')
        if (from === layer.id) throw new Error('A layer cannot clip to itself')
        next.clip = {
          from,
          mode: (given.mode === undefined ? current.mode : given.mode) === 'luma' ? 'luma' : 'alpha',
          invert: given.invert === undefined ? current.invert : !!given.invert,
          feather: clamp(given.feather === undefined ? current.feather : asNumber(given.feather, 'clip.feather'), 0, 400)
        }
        break
      }
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
    next.sides = clamp(Math.round(next.sides as number), 3, 24)
    next.inset = clamp(next.inset as number, 0.05, 0.95)
    next.smooth = clamp(next.smooth as number, 0, 1)
    const line = next.line as Line | null
    if (line) next.line = { ...line, width: clamp(line.width, 0.5, 200), dash: Math.max(0, line.dash) }
  }
  if (layer.kind === 'text') next.arc = clamp(next.arc as number, -360, 360)
  const warp = next.warp as Warp | null
  if (warp) next.warp = { ...warp, bend: clamp(warp.bend, -1, 1) }

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

// Text is measured with fields older files lack, so they are filled in before the refit.
export function openDoc(doc: StudioDoc): StudioDoc {
  const normal = normalizeDoc(doc)
  return { ...normal, layers: normal.layers.map(refitText) }
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
  return tidyGroups({ ...doc, layers: doc.layers.filter((l) => l.id !== id) })
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

// The groups a layer or group sits in, innermost first. A parent loop, which only a damaged
// file could hold, ends the chain rather than spinning.
export function chainOf(doc: StudioDoc, groupId: string | null): LayerGroup[] {
  const out: LayerGroup[] = []
  let id = groupId
  while (id && !out.some((g) => g.id === id)) {
    const g = doc.groups.find((x) => x.id === id)
    if (!g) break
    out.push(g)
    id = g.parent
  }
  return out
}

export const inGroup = (doc: StudioDoc, l: Layer, id: string): boolean => chainOf(doc, l.group).some((g) => g.id === id)

export function tidyGroups(doc: StudioDoc): StudioDoc {
  const known = new Set(doc.groups.map((g) => g.id))
  const bad = (g: LayerGroup): boolean => !!g.parent && (!known.has(g.parent) || chainOf(doc, g.parent).some((x) => x.id === g.id))
  const groups = doc.groups.some(bad) ? doc.groups.map((g) => (bad(g) ? { ...g, parent: null } : g)) : doc.groups
  const fixed = { ...doc, groups }
  const used = new Set(doc.layers.flatMap((l) => chainOf(fixed, l.group).map((g) => g.id)))
  // A group emptied by this very edit is dropped below, so it no longer counts as a source.
  const alive = new Set([...doc.layers.map((l) => l.id), ...used])
  const stray = doc.layers.some((l) => l.group && !known.has(l.group))
  const empty = groups.some((g) => !used.has(g.id))
  const dangling = doc.layers.some((l) => l.clip && !alive.has(l.clip.from))
  if (!stray && !empty && !dangling && groups === doc.groups) return doc
  return {
    ...doc,
    groups: groups.filter((g) => used.has(g.id)),
    layers: doc.layers.map((l) => {
      const group = l.group && !known.has(l.group) ? null : l.group
      const clip = l.clip && !alive.has(l.clip.from) ? null : l.clip
      return group === l.group && clip === l.clip ? l : ({ ...l, group, clip } as Layer)
    })
  }
}

export const findGroup = (doc: StudioDoc, id: string): LayerGroup => {
  const group = doc.groups.find((g) => g.id === id)
  if (!group) throw new Error(`No group with id ${id}. Call get_document for current group ids.`)
  return group
}

export const groupMembers = (doc: StudioDoc, id: string): Layer[] => doc.layers.filter((l) => inGroup(doc, l, id))

// The largest group in a layer's chain that the ids cover completely, if any: that whole
// group is what the selection means, not the single layer.
export function wholeGroupOf(doc: StudioDoc, l: Layer, ids: string[]): LayerGroup | null {
  const chain = chainOf(doc, l.group)
  for (let i = chain.length - 1; i >= 0; i--) {
    if (groupMembers(doc, chain[i].id).every((m) => ids.includes(m.id))) return chain[i]
  }
  return null
}

// Members are pulled together where the topmost one sat, so a group always reads as one
// block in the layers panel. Whole groups in the selection nest inside the new one.
export function groupLayers(doc: StudioDoc, ids: string[], name: string): { doc: StudioDoc; group: LayerGroup } {
  const members = doc.layers.filter((l) => ids.includes(l.id))
  if (members.length < 2) throw new Error('A group needs at least two layers')
  const nested = new Set(members.map((l) => wholeGroupOf(doc, l, ids)?.id).filter((id): id is string => !!id))
  const parents = new Set(members.map((l) => {
    const whole = wholeGroupOf(doc, l, ids)
    return whole ? whole.parent : l.group
  }))
  const parent = parents.size === 1 ? [...parents][0] : null
  const group: LayerGroup = { id: newGroupId(doc), name: name.trim() || 'Group', parent, mask: null }
  const top = doc.layers.indexOf(members[members.length - 1])
  const rest = doc.layers.filter((l) => !ids.includes(l.id))
  const at = doc.layers.slice(0, top).filter((l) => !ids.includes(l.id)).length
  rest.splice(at, 0, ...members.map((l) => (wholeGroupOf(doc, l, ids) ? l : { ...l, group: group.id })))
  const groups = doc.groups.map((g) => (nested.has(g.id) ? { ...g, parent: group.id } : g))
  return { doc: tidyGroups({ ...doc, layers: rest, groups: [...groups, group] }), group }
}

// The group's layers and groups move up into its parent, wherever they sat inside it.
export function ungroup(doc: StudioDoc, id: string): StudioDoc {
  const g = findGroup(doc, id)
  return tidyGroups({
    ...doc,
    groups: doc.groups.map((x) => (x.parent === id ? { ...x, parent: g.parent } : x)),
    layers: doc.layers.map((l) => (l.group === id ? { ...l, group: g.parent } : l))
  })
}

export function arrangeGroup(doc: StudioDoc, id: string, to: 'top' | 'bottom' | 'up' | 'down'): StudioDoc {
  const members = groupMembers(doc, id)
  const inside = new Set(members.map((l) => l.id))
  const rest = doc.layers.filter((l) => !inside.has(l.id))
  const now = doc.layers.slice(0, doc.layers.indexOf(members[0])).filter((l) => !inside.has(l.id)).length
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
    strokes: l.strokes.map((e) => ({ ...e, width: px(e.width) })),
    glows: l.glows.map((e) => ({ ...e, size: px(e.size) })),
    shadows: l.shadows.map((e) => ({ ...e, blur: px(e.blur), x: e.x * k, y: e.y * k })),
    adjust: { ...l.adjust, blur: px(l.adjust.blur) },
    corners: l.corners ? (l.corners.map(([cx, cy]) => [cx * k, cy * k]) as Corners) : null,
    clip: l.clip ? { ...l.clip, feather: px(l.clip.feather) } : null,
    blurFx: l.blurFx ? { ...l.blurFx, amount: l.blurFx.style === 'spin' ? l.blurFx.amount : px(l.blurFx.amount) } : null,
    lightWrap: l.lightWrap ? { ...l.lightWrap, size: Math.max(1, l.lightWrap.size * k) } : null,
    contact: l.contact ? { ...l.contact, blur: px(l.contact.blur), y: l.contact.y * k } : null
  } as Layer
  if (scaled.kind === 'text') {
    return {
      ...scaled,
      size: Math.max(6, scaled.size * k),
      letterSpacing: scaled.letterSpacing * k,
      wrap: scaled.wrap === null ? null : scaled.wrap * k,
      styles: scaled.styles.map((st) => (st.rise === undefined ? st : { ...st, rise: st.rise * k }))
    }
  }
  if (scaled.kind === 'shape') {
    return { ...scaled, radius: px(scaled.radius), feather: px(scaled.feather), line: scaled.line && { ...scaled.line, width: px(scaled.line.width), dash: px(scaled.line.dash) } }
  }
  return scaled
}

// The whole design at another resolution, for export: every pixel measure scales with it.
export function scaleDoc(doc: StudioDoc, k: number): StudioDoc {
  return {
    ...doc,
    width: Math.round(doc.width * k),
    height: Math.round(doc.height * k),
    layers: doc.layers.map((l) => scaleLayer(l, k, 0, 0)),
    guides: doc.guides.map((g) => ({ ...g, at: g.at * k }))
  }
}

// Copies keep their own groups: a fully copied group becomes a new group, a lone member
// stays in the group it came from.
export function duplicateLayers(doc: StudioDoc, ids: string[], shift = 0): { doc: StudioDoc; ids: string[] } {
  let next = doc
  const copies: string[] = []
  const remap = new Map<string, string>()
  const regroup = new Map<string, string>()
  for (const g of doc.groups) {
    const members = groupMembers(doc, g.id)
    if (!members.every((l) => ids.includes(l.id))) continue
    const copy = { ...g, id: newGroupId(next), name: g.name + ' copy' }
    next = { ...next, groups: [...next.groups, copy] }
    regroup.set(g.id, copy.id)
  }
  next = { ...next, groups: next.groups.map((g) => (g.parent && regroup.has(g.parent) && [...regroup.values()].includes(g.id) ? { ...g, parent: regroup.get(g.parent)! } : g)) }
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
    remap.set(src.id, layer.id)
  }
  // Copying a clip source together with what it clips keeps the pair self-contained.
  const rebound = layers.map((l) => {
    const from = l.clip && copies.includes(l.id) ? remap.get(l.clip.from) ?? regroup.get(l.clip.from) : undefined
    return from ? ({ ...l, clip: { ...l.clip!, from } } as Layer) : l
  })
  return { doc: { ...next, layers: rebound }, ids: copies }
}

export type AlignEdge = 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom'

// A whole group that is part of the selection moves as one block, so aligning a badge and
// a headline lines up the badge rather than scattering its pieces.
function unitsOf(doc: StudioDoc, ids: string[]): Layer[][] {
  const picked = doc.layers.filter((l) => ids.includes(l.id))
  const units = new Map<string, Layer[]>()
  for (const l of picked) {
    const whole = wholeGroupOf(doc, l, ids)
    const key = whole ? 'g:' + whole.id : l.id
    units.set(key, [...(units.get(key) ?? []), l])
  }
  return [...units.values()]
}

function shifted(doc: StudioDoc, moves: Map<string, [number, number]>): StudioDoc {
  return {
    ...doc,
    layers: doc.layers.map((l) => {
      const d = moves.get(l.id)
      return d ? ({ ...l, x: Math.round((l.x + d[0]) * 10) / 10, y: Math.round((l.y + d[1]) * 10) / 10 } as Layer) : l
    })
  }
}

// One unit, or toCanvas, aligns against the canvas; several align against their joint box.
export function alignLayers(doc: StudioDoc, ids: string[], edge: AlignEdge, toCanvas = false): StudioDoc {
  const units = unitsOf(doc, ids)
  if (!units.length) return doc
  const frame = toCanvas || units.length === 1 ? { x: 0, y: 0, width: doc.width, height: doc.height } : boundsOf(units.flat())
  const moves = new Map<string, [number, number]>()
  for (const unit of units) {
    const b = boundsOf(unit)
    const dx =
      edge === 'left' ? frame.x - b.x
        : edge === 'center' ? frame.x + frame.width / 2 - (b.x + b.width / 2)
          : edge === 'right' ? frame.x + frame.width - (b.x + b.width) : 0
    const dy =
      edge === 'top' ? frame.y - b.y
        : edge === 'middle' ? frame.y + frame.height / 2 - (b.y + b.height / 2)
          : edge === 'bottom' ? frame.y + frame.height - (b.y + b.height) : 0
    for (const l of unit) moves.set(l.id, [dx, dy])
  }
  return shifted(doc, moves)
}

// Equal gaps between neighbours, the outermost two staying where they are.
export function distributeLayers(doc: StudioDoc, ids: string[], axis: 'x' | 'y'): StudioDoc {
  const units = unitsOf(doc, ids).map((u) => ({ layers: u, b: boundsOf(u) }))
  if (units.length < 3) return doc
  const pos = (b: Bounds): number => (axis === 'x' ? b.x : b.y)
  const len = (b: Bounds): number => (axis === 'x' ? b.width : b.height)
  units.sort((a, c) => pos(a.b) + len(a.b) / 2 - (pos(c.b) + len(c.b) / 2))
  const first = units[0].b
  const last = units[units.length - 1].b
  const gap = (pos(last) + len(last) - pos(first) - units.reduce((n, u) => n + len(u.b), 0)) / (units.length - 1)
  const moves = new Map<string, [number, number]>()
  let at = pos(first)
  for (const u of units) {
    const d = at - pos(u.b)
    for (const l of u.layers) moves.set(l.id, axis === 'x' ? [d, 0] : [0, d])
    at += len(u.b) + gap
  }
  return shifted(doc, moves)
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
      parent: g.parent,
      masked: !!g.mask || undefined,
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
