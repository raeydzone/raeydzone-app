export const CANVAS_W = 1280
export const CANVAS_H = 720

export const BLEND_MODES = [
  'normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten', 'color-dodge',
  'color-burn', 'hard-light', 'soft-light', 'difference', 'exclusion', 'hue',
  'saturation', 'color', 'luminosity'
] as const
export type BlendMode = (typeof BLEND_MODES)[number]

export const SHAPES = ['rect', 'ellipse', 'polygon', 'star', 'arrow', 'bubble'] as const
export type ShapeKind = (typeof SHAPES)[number]

export const WARP_STYLES = ['arc', 'arch', 'bulge', 'flag', 'wave', 'rise'] as const
export type WarpStyle = (typeof WARP_STYLES)[number]

export const GRADIENT_TYPES = ['linear', 'radial', 'conic'] as const
export type GradientType = (typeof GRADIENT_TYPES)[number]

export const BLUR_STYLES = ['motion', 'zoom', 'spin', 'lens', 'tilt'] as const
export type BlurStyle = (typeof BLUR_STYLES)[number]

export const BUNDLED_FONTS = [
  'Montserrat', 'Anton', 'Bebas Neue', 'Oswald', 'Archivo Black', 'Luckiest Guy', 'Bangers'
] as const

export const STROKE_POSITIONS = ['outside', 'center', 'inside'] as const
export type StrokePosition = (typeof STROKE_POSITIONS)[number]

export interface Shadow {
  color: string
  opacity: number
  blur: number
  x: number
  y: number
  inner: boolean
}
export interface Glow { color: string; opacity: number; size: number; inner: boolean }
export interface Outline {
  color: string
  width: number
  opacity: number
  position: StrokePosition
}
export interface Tint { color: string; amount: number }
export interface Adjust {
  brightness: number
  contrast: number
  saturation: number
  hue: number
  blur: number
}
// A clipping mask: this layer only shows where the source layer or group covers. The
// source needs no visibility of its own, so a shape can exist purely to clip.
export interface Clip {
  from: string
  mode: 'alpha' | 'luma'
  invert: boolean
  feather: number
}

export interface GradientStop {
  at: number
  color: string
}

// from/to are the two-colour case; stops, when present, are the whole ramp.
export interface Gradient {
  type: GradientType
  from: string
  to: string
  angle: number
  stops: GradientStop[]
}

// Offsets of the top-left, top-right, bottom-right and bottom-left corners from where the
// box puts them, in layer pixels. Skew, perspective and free distort are all this.
export type Corners = [[number, number], [number, number], [number, number], [number, number]]

export interface Warp {
  style: WarpStyle
  bend: number
}

export interface Line {
  color: string
  width: number
  opacity: number
  dash: number
}

export interface TextStyle {
  start: number
  end: number
  fill?: string
  scale?: number
  font?: string
  weight?: number
  italic?: boolean
  rise?: number
}

// x and y place the centre of a zoom or spin, or the spot a lens or tilt-shift blur keeps
// sharp, as fractions of the layer box; focus sizes that sharp area.
export interface BlurFx {
  style: BlurStyle
  amount: number
  angle: number
  x: number
  y: number
  focus: number
}

export interface Levels {
  black: number
  white: number
  gamma: number
  outBlack: number
  outWhite: number
}

export type CurvePoint = [number, number]
export interface Curves {
  rgb: CurvePoint[]
  r: CurvePoint[]
  g: CurvePoint[]
  b: CurvePoint[]
}

export interface GradientMap {
  stops: GradientStop[]
  amount: number
}

// A 3D colour lookup, stored as an image asset of n slices of n x n laid side by side.
export interface Lut {
  asset: string
  name: string
  amount: number
}

// A per-channel gain and lift, the shape a colour match from another image takes.
export interface Grade {
  gain: [number, number, number]
  lift: [number, number, number]
  amount: number
}

export interface Tone {
  levels: Levels | null
  curves: Curves | null
  map: GradientMap | null
  lut: Lut | null
  grade: Grade | null
}

// The backdrop bleeding into the edge of a cut-out, so it looks lit by the scene.
export interface LightWrap {
  amount: number
  size: number
}

// The layer's own silhouette squashed flat under it: the shadow where it meets the floor.
export interface Contact {
  color: string
  opacity: number
  blur: number
  squash: number
  y: number
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
  group: string | null
  shadows: Shadow[]
  glows: Glow[]
  strokes: Outline[]
  tint: Tint | null
  adjust: Adjust
  mask: string | null
  clip: Clip | null
  corners: Corners | null
  warp: Warp | null
  tone: Tone | null
  blurFx: BlurFx | null
  lightWrap: LightWrap | null
  contact: Contact | null
  link: string | null
}

export interface ImageLayer extends LayerBase {
  kind: 'image'
  asset: string
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
  gradient: Gradient | null
  highlight: string
  align: 'left' | 'center' | 'right'
  letterSpacing: number
  lineHeight: number
  wrap: number | null
  fit: boolean
  arc: number
  styles: TextStyle[]
}

export interface ShapeLayer extends LayerBase {
  kind: 'shape'
  shape: ShapeKind
  fill: string
  gradient: Gradient | null
  radius: number
  feather: number
  points: [number, number][]
  line: Line | null
  sides: number
  inset: number
  smooth: number
}

// Changes everything below it instead of drawing anything; its box, mask and clip say where.
export interface AdjustLayer extends LayerBase {
  kind: 'adjust'
}

export type Layer = ImageLayer | TextLayer | ShapeLayer | AdjustLayer
export type LayerKind = Layer['kind']

// parent nests a group inside another; mask is a canvas-sized asset applied to every
// member, so a group can be faded or cut as one.
export interface LayerGroup {
  id: string
  name: string
  parent: string | null
  mask: string | null
}

// The last pass over the whole thumbnail, each 0 to 1.
export interface Finish {
  sharpen: number
  clarity: number
  vibrance: number
  bloom: number
  vignette: number
  grain: number
}

export interface Guide {
  axis: 'x' | 'y'
  at: number
}

// Where YouTube draws over a thumbnail, as fractions of the canvas: the video length badge,
// the watch-later and queue buttons on hover, and the red bar on videos already watched.
export const SAFE_ZONES = [
  { id: 'length', label: 'Video length', x: 0.83, y: 0.875, w: 0.155, h: 0.1 },
  { id: 'queue', label: 'Hover icons', x: 0.89, y: 0.02, w: 0.09, h: 0.33 },
  { id: 'progress', label: 'Watched bar', x: 0, y: 0.97, w: 1, h: 0.03 }
] as const

export interface StudioDoc {
  width: number
  height: number
  background: string
  layers: Layer[]
  groups: LayerGroup[]
  guides: Guide[]
  finish: Finish | null
}

export interface Snapshot {
  id: string
  name: string
  at: string
  doc: StudioDoc
}

export interface BrandColor {
  id: string
  name: string
  color: string
}

export interface BrandStyle {
  id: string
  name: string
  kind: LayerKind
  props: Record<string, unknown>
  updatedAt: string
}

export interface BrandLogo {
  id: string
  name: string
  file: string
  w: number
  h: number
}

export interface BrandKit {
  colors: BrandColor[]
  fonts: string[]
  styles: BrandStyle[]
  logos: BrandLogo[]
}

export const EMPTY_KIT: BrandKit = { colors: [], fonts: [], styles: [], logos: [] }

export interface AssetInfo {
  id: string
  file: string
  w: number
  h: number
  label: string
  source: 'upload' | 'generated' | 'mask' | 'fill' | 'paint' | 'lut'
}

export type ChatItem =
  | { id: string; kind: 'user'; text: string; images: string[]; at: string }
  | { id: string; kind: 'assistant'; text: string; ms?: number; at: string }
  | { id: string; kind: 'tool'; name: string; summary: string; status: 'running' | 'done' | 'error'; detail: string | null; cost?: number | null; ms?: number; at: string }
  | { id: string; kind: 'note'; text: string; bad: boolean; at: string }

export type VariantStatus = 'idle' | 'working' | 'stopped' | 'error'

export interface StudioProject {
  kind: 'video' | 'stream'
  id: string
  name: string
}

export interface StudioListing extends StudioProject {
  updatedAt: string
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
  snapshots: Snapshot[]
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
  thumbHash?: string
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
  images: number
  unpriced: number
  since: string | null
  imageMs: number
  claudeMs: number
  turns: number
  models: { id: string; label: string; cost: number; images: number; ms: number }[]
  months: { key: string; cost: number; images: number; ms: number }[]
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
  | { type: 'status'; status: VariantStatus; error?: string; ms?: number }
  | { type: 'text'; text: string; ms?: number }
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
