import type { CurvePoint, Grade, GradientStop, Levels, Tone } from '@shared/studio'
import { canvas, ctx2d } from './assets'
import type { AssetStore } from './assets'
import { HEAD, pass } from './gl'

const clamp = (v: number, lo = 0, hi = 1): number => Math.min(hi, Math.max(lo, v))

// Monotone cubic through the points (Fritsch–Carlson), so a curve never overshoots into the
// ringing a plain spline gives between close points. Flat beyond the first and last point.
export function curveTable(points: CurvePoint[]): Float32Array {
  const out = new Float32Array(256)
  const p = [...points]
    .map(([x, y]) => [clamp(x, 0, 255), clamp(y, 0, 255)] as CurvePoint)
    .sort((a, b) => a[0] - b[0])
    .filter((q, i, all) => i === 0 || q[0] > all[i - 1][0])
  if (p.length < 2) {
    for (let i = 0; i < 256; i++) out[i] = i / 255
    return out
  }
  const n = p.length
  const m: number[] = []
  for (let k = 0; k < n - 1; k++) m.push((p[k + 1][1] - p[k][1]) / (p[k + 1][0] - p[k][0]))
  const t = p.map((_, k) => (k === 0 ? m[0] : k === n - 1 ? m[n - 2] : m[k - 1] * m[k] <= 0 ? 0 : (m[k - 1] + m[k]) / 2))
  for (let k = 0; k < n - 1; k++) {
    if (m[k] === 0) {
      t[k] = t[k + 1] = 0
      continue
    }
    const a = t[k] / m[k]
    const b = t[k + 1] / m[k]
    const s = a * a + b * b
    if (s > 9) {
      const tau = 3 / Math.sqrt(s)
      t[k] = tau * a * m[k]
      t[k + 1] = tau * b * m[k]
    }
  }
  let k = 0
  for (let i = 0; i < 256; i++) {
    let y: number
    if (i <= p[0][0]) y = p[0][1]
    else if (i >= p[n - 1][0]) y = p[n - 1][1]
    else {
      while (i > p[k + 1][0]) k++
      const h = p[k + 1][0] - p[k][0]
      const u = (i - p[k][0]) / h
      const u2 = u * u
      const u3 = u2 * u
      y = (2 * u3 - 3 * u2 + 1) * p[k][1] + (u3 - 2 * u2 + u) * h * t[k] + (-2 * u3 + 3 * u2) * p[k + 1][1] + (u3 - u2) * h * t[k + 1]
    }
    out[i] = clamp(y / 255)
  }
  return out
}

function lookup(table: Float32Array, v: number): number {
  const x = clamp(v) * 255
  const i = Math.floor(x)
  const f = x - i
  return i >= 255 ? table[255] : table[i] * (1 - f) + table[i + 1] * f
}

function levelled(v: number, lv: Levels): number {
  const span = Math.max(1, lv.white - lv.black)
  const u = Math.pow(clamp((v * 255 - lv.black) / span), 1 / Math.max(0.05, lv.gamma))
  return clamp((lv.outBlack + u * (lv.outWhite - lv.outBlack)) / 255)
}

// Grade, levels and curves all map each channel on its own, so they fold into one table of
// 256 entries that the shader reads in a single lookup.
export function toneTable(tone: Tone): Uint8Array {
  const out = new Uint8Array(256 * 4)
  const c = tone.curves
  const tables = c ? { rgb: curveTable(c.rgb), ch: [curveTable(c.r), curveTable(c.g), curveTable(c.b)] } : null
  for (let i = 0; i < 256; i++) {
    for (let ch = 0; ch < 3; ch++) {
      let v = i / 255
      const g = tone.grade
      if (g) v = clamp(v + (v * g.gain[ch] + g.lift[ch] - v) * g.amount)
      if (tone.levels) v = levelled(v, tone.levels)
      if (tables) v = lookup(tables.ch[ch], lookup(tables.rgb, v))
      out[i * 4 + ch] = Math.round(v * 255)
    }
    out[i * 4 + 3] = 255
  }
  return out
}

export function rampTable(stops: GradientStop[]): Uint8Array {
  const c = canvas(256, 1)
  const g = ctx2d(c)
  const grad = g.createLinearGradient(0, 0, 256, 0)
  for (const st of stops) grad.addColorStop(clamp(st.at), st.color)
  g.fillStyle = grad
  g.fillRect(0, 0, 256, 1)
  return new Uint8Array(g.getImageData(0, 0, 256, 1).data.buffer)
}

const cubes = new Map<string, { n: number; bytes: Uint8Array }>()

// The asset holds slice b at x = b*n, with red across and green down inside each slice;
// a 3D texture wants red fastest, then green, then blue.
function cubeOf(assets: AssetStore, id: string): { n: number; bytes: Uint8Array } | null {
  const hit = cubes.get(id)
  if (hit) return hit
  const px = assets.peek(id)
  if (!px) return null
  const n = px.height
  const flat = canvas(px.width, px.height)
  const g = ctx2d(flat)
  g.drawImage(px, 0, 0)
  const d = g.getImageData(0, 0, px.width, px.height).data
  const bytes = new Uint8Array(n * n * n * 4)
  for (let b = 0; b < n; b++) {
    for (let gi = 0; gi < n; gi++) {
      for (let r = 0; r < n; r++) {
        const from = (gi * n * n + b * n + r) * 4
        const to = ((b * n + gi) * n + r) * 4
        bytes.set(d.subarray(from, from + 4), to)
        bytes[to + 3] = 255
      }
    }
  }
  const cube = { n, bytes }
  cubes.set(id, cube)
  return cube
}

const TONE = HEAD + `
uniform sampler2D curve;
uniform sampler2D ramp;
uniform sampler3D cube;
uniform float rampAmt;
uniform float cubeAmt;
uniform float cubeN;
vec4 row(sampler2D t, float v) { return texture(t, vec2(v * 255.0 / 256.0 + 0.5 / 256.0, 0.5)); }
void main() {
  vec4 c = at(here());
  if (c.a <= 0.0) { outColor = c; return; }
  vec3 rgb = clamp(c.rgb / c.a, 0.0, 1.0);
  rgb = vec3(row(curve, rgb.r).r, row(curve, rgb.g).g, row(curve, rgb.b).b);
  if (rampAmt > 0.0) {
    float l = dot(rgb, vec3(0.2126, 0.7152, 0.0722));
    vec4 m = row(ramp, l);
    rgb = mix(rgb, m.rgb, rampAmt * m.a);
  }
  if (cubeAmt > 0.0) {
    vec3 s = rgb * (cubeN - 1.0) / cubeN + 0.5 / cubeN;
    rgb = mix(rgb, texture(cube, s).rgb, cubeAmt);
  }
  outColor = vec4(rgb * c.a, c.a);
}`

export function toneReady(tone: Tone | null, assets: AssetStore): boolean {
  return !tone?.lut || !!assets.peek(tone.lut.asset)
}

export function isNeutral(tone: Tone | null): boolean {
  return !tone || (!tone.levels && !tone.curves && !tone.map && !tone.lut && !tone.grade)
}

export function applyTone(src: HTMLCanvasElement, tone: Tone, assets: AssetStore): HTMLCanvasElement {
  if (isNeutral(tone)) return src
  const curve = toneTable(tone)
  const map = tone.map && tone.map.stops.length >= 2 && tone.map.amount > 0 ? tone.map : null
  const ramp = map ? rampTable(map.stops) : new Uint8Array(256 * 4)
  const cube = tone.lut && tone.lut.amount > 0 ? cubeOf(assets, tone.lut.asset) : null
  const out = pass(
    src,
    TONE,
    { rampAmt: map?.amount ?? 0, cubeAmt: cube ? tone.lut!.amount : 0, cubeN: cube?.n ?? 2 },
    [
      { name: 'curve', width: 256, height: 1, bytes: curve },
      { name: 'ramp', width: 256, height: 1, bytes: ramp },
      cube
        ? { name: 'cube', width: cube.n, height: cube.n, depth: cube.n, bytes: cube.bytes }
        : { name: 'cube', width: 2, height: 2, depth: 2, bytes: new Uint8Array(32) }
    ]
  )
  return out ?? toneOnCpu(src, curve, map ? ramp : null, map?.amount ?? 0)
}

// Without WebGL2 the per-channel table and the gradient map still apply; only a LUT is lost.
function toneOnCpu(src: HTMLCanvasElement, curve: Uint8Array, ramp: Uint8Array | null, amount: number): HTMLCanvasElement {
  const out = canvas(src.width, src.height)
  const g = ctx2d(out)
  g.drawImage(src, 0, 0)
  const img = g.getImageData(0, 0, out.width, out.height)
  const d = img.data
  for (let i = 0; i < d.length; i += 4) {
    if (!d[i + 3]) continue
    let r = curve[d[i] * 4]
    let gr = curve[d[i + 1] * 4 + 1]
    let b = curve[d[i + 2] * 4 + 2]
    if (ramp) {
      const l = Math.round(0.2126 * r + 0.7152 * gr + 0.0722 * b) * 4
      const k = amount * (ramp[l + 3] / 255)
      r += (ramp[l] - r) * k
      gr += (ramp[l + 1] - gr) * k
      b += (ramp[l + 2] - b) * k
    }
    d[i] = r
    d[i + 1] = gr
    d[i + 2] = b
  }
  g.putImageData(img, 0, 0)
  return out
}

function samples(c: HTMLCanvasElement): Uint8ClampedArray {
  const k = Math.min(1, Math.sqrt(250_000 / (c.width * c.height)))
  const small = canvas(Math.max(1, c.width * k), Math.max(1, c.height * k))
  const g = ctx2d(small)
  g.drawImage(c, 0, 0, small.width, small.height)
  return g.getImageData(0, 0, small.width, small.height).data
}

// The darkest and brightest half-percent are let go, so a few specks do not pin the range.
export function autoLevels(c: HTMLCanvasElement): Levels {
  const d = samples(c)
  const hist = new Array(256).fill(0)
  let total = 0
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 128) continue
    hist[Math.round(0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2])]++
    total++
  }
  const edge = (from: number, step: number): number => {
    let seen = 0
    for (let v = from; v >= 0 && v <= 255; v += step) {
      seen += hist[v]
      if (seen > total * 0.005) return v
    }
    return from
  }
  const black = total ? edge(0, 1) : 0
  const white = total ? edge(255, -1) : 255
  return { black, white: Math.max(black + 8, white), gamma: 1, outBlack: 0, outWhite: 255 }
}

function stats(c: HTMLCanvasElement): { mean: number[]; dev: number[] } | null {
  const d = samples(c)
  const sum = [0, 0, 0]
  const sq = [0, 0, 0]
  let n = 0
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 128) continue
    for (let ch = 0; ch < 3; ch++) {
      sum[ch] += d[i + ch]
      sq[ch] += d[i + ch] * d[i + ch]
    }
    n++
  }
  if (!n) return null
  const mean = sum.map((v) => v / n / 255)
  return { mean, dev: sq.map((v, ch) => Math.sqrt(Math.max(0, v / n / 65025 - mean[ch] * mean[ch]))) }
}

// Reinhard's colour transfer per channel: shift and stretch each channel so its mean and
// spread match the reference. Crude next to a full Lab transfer, but it is one gain and one
// lift per channel and so stays an editable adjustment instead of a baked image.
export function matchGrade(src: HTMLCanvasElement, ref: HTMLCanvasElement): Grade | null {
  const a = stats(src)
  const b = stats(ref)
  if (!a || !b) return null
  const gain = [0, 1, 2].map((ch) => clamp(b.dev[ch] / Math.max(0.02, a.dev[ch]), 0.4, 2.5))
  const lift = [0, 1, 2].map((ch) => b.mean[ch] - a.mean[ch] * gain[ch])
  const round = (v: number): number => Math.round(v * 1000) / 1000
  return { gain: gain.map(round) as Grade['gain'], lift: lift.map(round) as Grade['lift'], amount: 1 }
}

export function parseCube(text: string): HTMLCanvasElement {
  let n = 0
  let lo = [0, 0, 0]
  let hi = [1, 1, 1]
  const rows: number[][] = []
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const parts = line.split(/\s+/)
    if (parts[0] === 'LUT_3D_SIZE') n = Number(parts[1])
    else if (parts[0] === 'DOMAIN_MIN') lo = parts.slice(1, 4).map(Number)
    else if (parts[0] === 'DOMAIN_MAX') hi = parts.slice(1, 4).map(Number)
    else if (/^[-\d.]/.test(parts[0]) && parts.length >= 3) rows.push(parts.slice(0, 3).map(Number))
  }
  if (!Number.isInteger(n) || n < 2 || n > 65) throw new Error('Only 3D .cube LUTs from 2 to 65 points per side are supported.')
  if (rows.length !== n * n * n) throw new Error(`The .cube file promises ${n * n * n} entries but holds ${rows.length}.`)
  const out = canvas(n * n, n)
  const g = ctx2d(out)
  const img = g.createImageData(n * n, n)
  rows.forEach((row, i) => {
    const r = i % n
    const gi = Math.floor(i / n) % n
    const b = Math.floor(i / (n * n))
    const at = (gi * n * n + b * n + r) * 4
    for (let ch = 0; ch < 3; ch++) img.data[at + ch] = Math.round(clamp((row[ch] - lo[ch]) / (hi[ch] - lo[ch] || 1)) * 255)
    img.data[at + 3] = 255
  })
  g.putImageData(img, 0, 0)
  return out
}

const S_CURVE: CurvePoint[] = [[0, 0], [64, 48], [192, 210], [255, 255]]

export const LOOKS: { id: string; label: string; tone: Partial<Tone> }[] = [
  { id: 'punch', label: 'Punchy', tone: { curves: { rgb: S_CURVE, r: [], g: [], b: [] } } },
  {
    id: 'teal',
    label: 'Teal & orange',
    tone: { curves: { rgb: S_CURVE, r: [[0, 0], [128, 142], [255, 255]], g: [], b: [[0, 26], [128, 112], [255, 230]] } }
  },
  {
    id: 'moody',
    label: 'Moody',
    tone: {
      levels: { black: 8, white: 255, gamma: 0.85, outBlack: 16, outWhite: 236 },
      curves: { rgb: S_CURVE, r: [], g: [], b: [[0, 20], [255, 240]] }
    }
  },
  { id: 'warm', label: 'Warm', tone: { grade: { gain: [1.08, 1, 0.9], lift: [0.02, 0.005, -0.02], amount: 1 } } },
  { id: 'cold', label: 'Cold', tone: { grade: { gain: [0.92, 1, 1.08], lift: [-0.02, 0, 0.03], amount: 1 } } },
  {
    id: 'noir',
    label: 'Noir',
    tone: { curves: { rgb: S_CURVE, r: [], g: [], b: [] }, map: { stops: [{ at: 0, color: '#000000' }, { at: 1, color: '#ffffff' }], amount: 1 } }
  },
  {
    id: 'duo',
    label: 'Red duotone',
    tone: { map: { stops: [{ at: 0, color: '#0a0a0a' }, { at: 0.55, color: '#ff2a2a' }, { at: 1, color: '#fff0e8' }], amount: 1 } }
  }
]
