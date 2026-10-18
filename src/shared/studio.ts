export const CANVAS_W = 1280
export const CANVAS_H = 720

export const BLEND_MODES = [
  'normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten', 'color-dodge',
  'color-burn', 'hard-light', 'soft-light', 'difference', 'exclusion', 'hue',
  'saturation', 'color', 'luminosity'
] as const
export type BlendMode = (typeof BLEND_MODES)[number]

export const BUNDLED_FONTS = [
  'Montserrat', 'Anton', 'Bebas Neue', 'Oswald', 'Archivo Black', 'Luckiest Guy', 'Bangers'
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
  | { id: string; kind: 'tool'; name: string; summary: string; status: 'running' | 'done' | 'error'; detail: string | null; cost?: number | null; at: string }
  | { id: string; kind: 'note'; text: string; bad: boolean; at: string }

export type VariantStatus = 'idle' | 'working' | 'stopped' | 'error'

export interface StudioProject {
  kind: 'video' | 'stream'
  id: string
  name: string
}

export interface ClaudeChoice {
  model: string
  effort: string
}

export interface Variant {
  id: string
  name: string
  createdAt: string
  doc: StudioDoc
  chat: ChatItem[]
  sessionId: string | null
  claude: ClaudeChoice
}

export const IMAGE_TASKS = [
  { id: 'generate', label: 'Generate images' },
  { id: 'fill', label: 'Generative fill' },
  { id: 'cutout', label: 'Smart cut-out' }
] as const

export type ImageTask = (typeof IMAGE_TASKS)[number]['id']
export type ImageModels = Record<ImageTask, string>

export interface StudioFile {
  version: 1
  assets: AssetInfo[]
  variants: Variant[]
  activeId: string | null
  claude?: ClaudeChoice
  imageModels?: Partial<ImageModels>
}

export const CLAUDE_MODELS = [
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5' },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5' },
  { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5' }
] as const

export const CLAUDE_EFFORTS = [
  { id: 'low', label: 'Low', note: 'Quickest, lightest on usage' },
  { id: 'medium', label: 'Medium', note: 'Balanced' },
  { id: 'high', label: 'High', note: 'More careful, more usage' },
  { id: 'xhigh', label: 'Extra high', note: 'Slow and thorough' },
  { id: 'max', label: 'Max', note: 'Heaviest on usage' }
] as const

export const DEFAULT_CLAUDE: ClaudeChoice = { model: CLAUDE_MODELS[0].id, effort: 'medium' }

const GPT_ASPECTS = ['1:1', '3:2', '2:3', '4:3', '3:4', '16:9', '9:16', '21:9']
const GROK_ASPECTS = ['1:1', '3:4', '4:3', '9:16', '16:9', '2:3', '3:2', '1:2', '2:1']
const NANO_ASPECTS = ['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9']

export interface ImageModel {
  id: string
  label: string
  note: string
  maxRefs: number
  aspects: string[]
  transparent: boolean
  quality: boolean
  resolution: boolean
  fallback?: string
}

export const IMAGE_MODELS: ImageModel[] = [
  { id: 'openai/gpt-image-2.5-sunburst', label: 'GPT Image 2.5 Sunburst', note: 'Highest quality · slower', maxRefs: 16, aspects: GPT_ASPECTS, transparent: true, quality: true, resolution: false },
  { id: 'openai/gpt-image-2.5-flare', label: 'GPT Image 2.5 Flare', note: 'Fast GPT Image', maxRefs: 16, aspects: GPT_ASPECTS, transparent: true, quality: true, resolution: false },
  { id: 'x-ai/grok-imagine-image-quality', label: 'Grok Imagine Quality', note: 'Photoreal · up to 3 reference images', maxRefs: 3, aspects: GROK_ASPECTS, transparent: false, quality: false, resolution: true },
  { id: 'x-ai/grok-imagine-image-2.0', label: 'Grok Imagine 2.0', note: 'Up to 3 reference images', maxRefs: 3, aspects: GROK_ASPECTS, transparent: false, quality: false, resolution: true },
  { id: 'google/gemini-nano-banana-2.1', label: 'Nano Banana 2.1', note: 'Precise edits · best value', maxRefs: 14, aspects: NANO_ASPECTS, transparent: false, quality: false, resolution: true, fallback: 'google/gemini-3.1-flash-image' },
  { id: 'google/gemini-3-pro-image', label: 'Nano Banana Pro', note: 'Google’s strongest', maxRefs: 14, aspects: NANO_ASPECTS, transparent: false, quality: false, resolution: true, fallback: 'google/gemini-3.1-flash-image' },
  { id: 'google/gemini-3.1-flash-image', label: 'Nano Banana 2', note: 'Fast', maxRefs: 14, aspects: NANO_ASPECTS, transparent: false, quality: false, resolution: true }
]

export const DEFAULT_IMAGE_MODELS: ImageModels = {
  generate: 'openai/gpt-image-2.5-sunburst',
  fill: 'google/gemini-nano-banana-2.1',
  cutout: 'google/gemini-nano-banana-2.1'
}

export function imageModel(id: string): ImageModel {
  return IMAGE_MODELS.find((m) => m.id === id) ?? IMAGE_MODELS[0]
}

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
  usage: number | null
  error: string | null
}

export interface SpendSummary {
  total: number
  today: number
  month: number
  project: number
  images: number
  unpriced: number
  since: string | null
  models: { id: string; label: string; cost: number; images: number }[]
  tasks: Record<ImageTask, number>
}

export interface ReportInput {
  kind: 'missing' | 'bug'
  title: string
  detail: string
  workaround: string | null
  project: string
  model: string
}

export interface FeatureReport extends ReportInput {
  id: string
  firstAt: string
  lastAt: string
  count: number
  done: boolean
}

export interface ImageRequest {
  model: string
  task: ImageTask
  projectId: string
  prompt: string
  images: Uint8Array[]
  aspect: string | null
  transparent?: boolean
  detail?: 'edit' | 'final'
}

export interface ImageResult {
  data: Uint8Array
  mime: string
  cost: number | null
  model: string
}

export interface ChatImage {
  data: Uint8Array
  mime: string
}

export interface SendRequest {
  projectId: string
  variantId: string
  text: string
  images: ChatImage[]
  resume: string | null
  claude: ClaudeChoice
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

export function closestAspect(w: number, h: number, aspects: string[] = NANO_ASPECTS): { label: string; ratio: number } {
  const target = Math.log(w / h)
  let best = { label: '16:9', ratio: 16 / 9 }
  let gap = Infinity
  for (const label of aspects) {
    const [a, b] = label.split(':').map(Number)
    const d = Math.abs(Math.log(a / b) - target)
    if (d < gap) {
      gap = d
      best = { label, ratio: a / b }
    }
  }
  return best
}

export function variantBrief(project: StudioProject, brief: string, index: number, total: number): string {
  const what = project.kind === 'stream' ? 'livestream' : 'video'
  const framed = `Thumbnail for the ${what} "${project.name}":

${brief}`
  if (total <= 1) return framed
  return `${framed}

(You are making version ${index} of ${total}, each built by a separate designer from this same brief. Make yours clearly distinct in layout, composition and colour accents while still matching the brief.)`
}
