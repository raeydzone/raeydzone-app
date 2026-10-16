export const CANVAS_W = 1280
export const CANVAS_H = 720

export const BLEND_MODES = [
  'normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten', 'color-dodge',
  'color-burn', 'hard-light', 'soft-light', 'difference', 'exclusion', 'hue',
  'saturation', 'color', 'luminosity'
] as const
export type BlendMode = (typeof BLEND_MODES)[number]

export const FONTS = [
  'Montserrat', 'Anton', 'Bebas Neue', 'Oswald', 'Archivo Black', 'Luckiest Guy',
  'Bangers', 'Impact', 'Arial Black', 'Segoe UI'
] as const

export interface Shadow { color: string; opacity: number; blur: number; x: number; y: number }
export interface Glow { color: string; opacity: number; size: number }
export interface Outline { color: string; width: number; opacity: number }
export interface Tint { color: string; amount: number }
export interface Adjust {
  brightness: number
  contrast: number
  saturation: number
  hue: number
  blur: number
}
export interface Gradient {
  type: 'linear' | 'radial'
  from: string
  to: string
  angle: number
}

interface LayerBase {
  id: string
  name: string
  x: number
  y: number
  width: number
  height: number
  rotation: number
  flipX: boolean
  flipY: boolean
  opacity: number
  blend: BlendMode
  visible: boolean
  locked: boolean
  shadow: Shadow | null
  glow: Glow | null
  stroke: Outline | null
  tint: Tint | null
  adjust: Adjust
}

export interface ImageLayer extends LayerBase {
  kind: 'image'
  asset: string
  mask: string | null
}

export interface TextLayer extends LayerBase {
  kind: 'text'
  text: string
  font: string
  size: number
  weight: number
  italic: boolean
  uppercase: boolean
  fill: string
  highlight: string
  align: 'left' | 'center' | 'right'
  letterSpacing: number
  lineHeight: number
}

export interface ShapeLayer extends LayerBase {
  kind: 'shape'
  shape: 'rect' | 'ellipse' | 'polygon'
  fill: string
  gradient: Gradient | null
  radius: number
  feather: number
  points: [number, number][]
}

export type Layer = ImageLayer | TextLayer | ShapeLayer
export type LayerKind = Layer['kind']

export interface StudioDoc {
  width: number
  height: number
  background: string
  layers: Layer[]
}

export interface AssetInfo {
  id: string
  file: string
  w: number
  h: number
  label: string
  source: 'upload' | 'generated' | 'mask' | 'fill'
}

export type ChatItem =
  | { id: string; kind: 'user'; text: string; images: string[]; at: string }
  | { id: string; kind: 'assistant'; text: string; at: string }
  | { id: string; kind: 'tool'; name: string; summary: string; status: 'running' | 'done' | 'error'; detail: string | null; at: string }
  | { id: string; kind: 'note'; text: string; bad: boolean; at: string }

export type VariantStatus = 'idle' | 'working' | 'stopped' | 'error'

export interface Variant {
  id: string
  name: string
  createdAt: string
  doc: StudioDoc
  chat: ChatItem[]
  sessionId: string | null
}

export interface StudioFile {
  version: 1
  assets: AssetInfo[]
  variants: Variant[]
  activeId: string | null
}

export const CLAUDE_MODELS = [
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5' },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5' },
  { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5' }
] as const

export const IMAGE_MODELS = [
  { id: 'google/gemini-nano-banana-2.1', label: 'Nano Banana 2.1', note: '≈ $0.04 per image' },
  { id: 'google/gemini-3-pro-image', label: 'Nano Banana Pro (Gemini 3 Pro Image)', note: '≈ $0.14 per image' },
  { id: 'openai/gpt-5.4-image-2', label: 'GPT-5.4 Image 2', note: 'priciest, strongest text rendering' },
  { id: 'google/gemini-3.1-flash-lite-image', label: 'Nano Banana 2 Lite', note: 'cheapest, lower quality' }
] as const

export const DEFAULT_CLAUDE_MODEL = CLAUDE_MODELS[0].id
export const DEFAULT_IMAGE_MODEL = IMAGE_MODELS[0].id

export interface ClaudeStatus {
  found: boolean
  path: string | null
  version: string | null
  loggedIn: boolean
  email: string | null
  plan: string | null
  error: string | null
}

export interface OpenRouterStatus {
  set: boolean
  ok: boolean
  label: string | null
  remaining: number | null
  error: string | null
}

export interface ImageRequest {
  prompt: string
  images: Uint8Array[]
  aspect: string | null
}

export interface ImageResult {
  data: Uint8Array
  mime: string
  cost: number | null
}

export interface ChatImage {
  data: Uint8Array
  mime: string
}

export interface SendRequest {
  videoId: string
  variantId: string
  text: string
  images: ChatImage[]
  resume: string | null
}

export type StudioEvent =
  | { type: 'status'; status: VariantStatus; error?: string }
  | { type: 'text'; text: string }
  | { type: 'session'; sessionId: string }
  | { type: 'usage'; fiveHour: number | null; weekly: number | null }

export interface ToolCall {
  callId: string
  variantId: string
  name: string
  args: Record<string, unknown>
}

export interface ToolReply {
  text: string
  image?: { data: string; mime: string }
  isError?: boolean
}

export const ASPECTS = ['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9'] as const

export function closestAspect(w: number, h: number): { label: string; ratio: number } {
  const target = Math.log(w / h)
  let best = { label: '16:9', ratio: 16 / 9 }
  let gap = Infinity
  for (const label of ASPECTS) {
    const [a, b] = label.split(':').map(Number)
    const d = Math.abs(Math.log(a / b) - target)
    if (d < gap) {
      gap = d
      best = { label, ratio: a / b }
    }
  }
  return best
}

export function variantBrief(brief: string, index: number, total: number): string {
  if (total <= 1) return brief
  return `${brief}

(You are making version ${index} of ${total}, each built by a separate designer from this same brief. Make yours clearly distinct in layout, composition and colour accents while still matching the brief.)`
}
