import type { Corners, Layer, Warp, WarpStyle } from '@shared/studio'
import { canvas, ctx2d } from './assets'

type Pt = [number, number]

// How far each style may push a point, as a share of the box width — also what the raster
// pad has to make room for.
const REACH: Record<WarpStyle, number> = { arc: 0.25, arch: 0.25, bulge: 0.2, flag: 0.08, wave: 0.08, rise: 0.22 }

export const isDistorted = (l: Layer): boolean => !!l.corners || (!!l.warp && l.warp.bend !== 0)

function warpOffset(warp: Warp, u: number, v: number, w: number): number {
  const x = 2 * u - 1
  const a = warp.bend * w * REACH[warp.style]
  switch (warp.style) {
    case 'arch':
      return -a * (1 - x * x)
    case 'arc':
      return -a * (1 - x * x) * (1 - v)
    case 'bulge':
      return a * (1 - x * x) * (2 * v - 1)
    case 'flag':
      return a * Math.sin(2 * Math.PI * u)
    case 'wave':
      return a * Math.sin(2 * Math.PI * (u + v / 2))
    case 'rise':
      return -a * Math.sin(Math.PI * (u - 0.5))
  }
}

interface Homography {
  a: number
  b: number
  c: number
  d: number
  e: number
  f: number
  g: number
  h: number
}

// Unit square onto an arbitrary quad (Heckbert). The parallelogram case is plain affine.
function squareToQuad(q: Pt[]): Homography {
  const [[x0, y0], [x1, y1], [x2, y2], [x3, y3]] = q
  const sx = x0 - x1 + x2 - x3
  const sy = y0 - y1 + y2 - y3
  if (Math.abs(sx) < 1e-9 && Math.abs(sy) < 1e-9) {
    return { a: x1 - x0, b: x3 - x0, c: x0, d: y1 - y0, e: y3 - y0, f: y0, g: 0, h: 0 }
  }
  const dx1 = x1 - x2
  const dx2 = x3 - x2
  const dy1 = y1 - y2
  const dy2 = y3 - y2
  const den = dx1 * dy2 - dx2 * dy1
  const g = (sx * dy2 - dx2 * sy) / den
  const h = (dx1 * sy - sx * dy1) / den
  return {
    a: x1 - x0 + g * x1, b: x3 - x0 + h * x3, c: x0,
    d: y1 - y0 + g * y1, e: y3 - y0 + h * y3, f: y0, g, h
  }
}

export function forward(l: Layer, w: number, h: number): (u: number, v: number) => Pt {
  const warp = l.warp && l.warp.bend !== 0 ? l.warp : null
  const quad = l.corners
    ? squareToQuad([[0, 0], [w, 0], [w, h], [0, h]].map(([x, y], i) => [x + l.corners![i][0], y + l.corners![i][1]] as Pt))
    : null
  return (u, v) => {
    let px = u * w
    let py = v * h
    if (warp) py += warpOffset(warp, u, v, w)
    if (!quad) return [px, py]
    const uu = px / w
    const vv = py / h
    const k = quad.g * uu + quad.h * vv + 1
    return [(quad.a * uu + quad.b * vv + quad.c) / k, (quad.d * uu + quad.e * vv + quad.f) / k]
  }
}

// Newton on the forward map: warps have no closed-form inverse, and they are smooth enough
// that a dozen steps from the undistorted guess land well inside a pixel.
export function inverse(l: Layer, w: number, h: number): (x: number, y: number) => Pt {
  const f = forward(l, w, h)
  return (x, y) => {
    let u = x / w
    let v = y / h
    const eps = 1e-4
    for (let i = 0; i < 14; i++) {
      const [fx, fy] = f(u, v)
      const ex = fx - x
      const ey = fy - y
      if (Math.abs(ex) + Math.abs(ey) < 0.05) break
      const [ux, uy] = f(u + eps, v)
      const [vx, vy] = f(u, v + eps)
      const j00 = (ux - fx) / eps
      const j10 = (uy - fy) / eps
      const j01 = (vx - fx) / eps
      const j11 = (vy - fy) / eps
      const det = j00 * j11 - j01 * j10
      if (Math.abs(det) < 1e-9) break
      u -= (j11 * ex - j01 * ey) / det
      v -= (-j10 * ex + j00 * ey) / det
    }
    return [u, v]
  }
}

export function overflow(l: Layer): number {
  if (!isDistorted(l)) return 0
  const w = Math.max(1, l.width)
  const h = Math.max(1, l.height)
  const f = forward(l, w, h)
  let out = 0
  for (let i = 0; i <= 32; i++) {
    const t = i / 32
    for (const [u, v] of [[t, 0], [t, 1], [0, t], [1, t], [t, 0.5]] as Pt[]) {
      const [x, y] = f(u, v)
      out = Math.max(out, -x, x - w, -y, y - h)
    }
  }
  return Math.ceil(out)
}

function triangle(g: CanvasRenderingContext2D, img: HTMLCanvasElement, s: Pt[], d: Pt[]): void {
  const [[s0x, s0y], [s1x, s1y], [s2x, s2y]] = s
  const den = s0x * (s1y - s2y) + s1x * (s2y - s0y) + s2x * (s0y - s1y)
  if (Math.abs(den) < 1e-9) return
  const solve = (p0: number, p1: number, p2: number): [number, number, number] => [
    (p0 * (s1y - s2y) + p1 * (s2y - s0y) + p2 * (s0y - s1y)) / den,
    (p0 * (s2x - s1x) + p1 * (s0x - s2x) + p2 * (s1x - s0x)) / den,
    (p0 * (s1x * s2y - s2x * s1y) + p1 * (s2x * s0y - s0x * s2y) + p2 * (s0x * s1y - s1x * s0y)) / den
  ]
  const [a, c, e] = solve(d[0][0], d[1][0], d[2][0])
  const [b, dd, f] = solve(d[0][1], d[1][1], d[2][1])
  // Antialiased clip edges leave hairlines between neighbouring triangles; pushing each one
  // out a little from its centre closes them.
  const cx = (d[0][0] + d[1][0] + d[2][0]) / 3
  const cy = (d[0][1] + d[1][1] + d[2][1]) / 3
  g.save()
  g.beginPath()
  d.forEach(([x, y], i) => {
    const len = Math.hypot(x - cx, y - cy) || 1
    const k = 0.75 / len
    const px = x + (x - cx) * k
    const py = y + (y - cy) * k
    if (i) g.lineTo(px, py)
    else g.moveTo(px, py)
  })
  g.closePath()
  g.clip()
  g.transform(a, b, c, dd, e, f)
  const xs = s.map((p) => p[0])
  const ys = s.map((p) => p[1])
  const x0 = Math.max(0, Math.floor(Math.min(...xs)) - 1)
  const y0 = Math.max(0, Math.floor(Math.min(...ys)) - 1)
  const x1 = Math.min(img.width, Math.ceil(Math.max(...xs)) + 1)
  const y1 = Math.min(img.height, Math.ceil(Math.max(...ys)) + 1)
  if (x1 > x0 && y1 > y0) g.drawImage(img, x0, y0, x1 - x0, y1 - y0, x0, y0, x1 - x0, y1 - y0)
  g.restore()
}

function mesh(img: HTMLCanvasElement, from: Pt[][], to: Pt[][]): HTMLCanvasElement {
  const out = canvas(img.width, img.height)
  const g = ctx2d(out)
  g.imageSmoothingQuality = 'high'
  for (let j = 0; j < from.length - 1; j++) {
    for (let i = 0; i < from[j].length - 1; i++) {
      const s = [from[j][i], from[j][i + 1], from[j + 1][i + 1], from[j + 1][i]]
      const d = [to[j][i], to[j][i + 1], to[j + 1][i + 1], to[j + 1][i]]
      triangle(g, img, [s[0], s[1], s[2]], [d[0], d[1], d[2]])
      triangle(g, img, [s[0], s[2], s[3]], [d[0], d[2], d[3]])
    }
  }
  return out
}

// Both grids span the whole raster, pad included, so overhanging glyphs and feathered edges
// travel with the content instead of being cut at the box.
function grids(l: Layer, src: HTMLCanvasElement, w: number, h: number, pad: number): { flat: Pt[][]; bent: Pt[][] } {
  const cols = l.warp ? 28 : 10
  const rows = l.warp ? 18 : 10
  const f = forward(l, w, h)
  const flat: Pt[][] = []
  const bent: Pt[][] = []
  for (let j = 0; j <= rows; j++) {
    const fr: Pt[] = []
    const br: Pt[] = []
    for (let i = 0; i <= cols; i++) {
      const sx = (i / cols) * src.width
      const sy = (j / rows) * src.height
      const [x, y] = f((sx - pad) / w, (sy - pad) / h)
      fr.push([sx, sy])
      br.push([x + pad, y + pad])
    }
    flat.push(fr)
    bent.push(br)
  }
  return { flat, bent }
}

export function distort(src: HTMLCanvasElement, l: Layer, w: number, h: number, pad: number): HTMLCanvasElement {
  const { flat, bent } = grids(l, src, w, h, pad)
  return mesh(src, flat, bent)
}

export function undistort(src: HTMLCanvasElement, l: Layer, w: number, h: number, pad: number): HTMLCanvasElement {
  const { flat, bent } = grids(l, src, w, h, pad)
  return mesh(src, bent, flat)
}

export function cornersFor(kind: 'skewX' | 'skewY' | 'perspectiveX' | 'perspectiveY', amount: number, w: number, h: number): Corners {
  const dx = amount * w * 0.5
  const dy = amount * h * 0.5
  switch (kind) {
    case 'skewX':
      return [[dx, 0], [dx, 0], [-dx, 0], [-dx, 0]]
    case 'skewY':
      return [[0, -dy], [0, dy], [0, dy], [0, -dy]]
    case 'perspectiveX':
      return [[0, dy], [0, -dy], [0, dy], [0, -dy]]
    case 'perspectiveY':
      return [[dx, 0], [-dx, 0], [dx, 0], [-dx, 0]]
  }
}

export type CornerPreset = Parameters<typeof cornersFor>[0]

const dot = (a: Corners, b: Corners): number => a.reduce((n, [x, y], i) => n + x * b[i][0] + y * b[i][1], 0)

// The four presets are orthogonal, so each slider reads its own amount straight out of any
// corner set, and moving one leaves the others — and any hand-dragged corner — untouched.
export function presetAmount(kind: CornerPreset, corners: Corners | null, w: number, h: number): number {
  if (!corners) return 0
  const unit = cornersFor(kind, 1, w, h)
  return dot(corners, unit) / dot(unit, unit)
}

export function withPreset(kind: CornerPreset, amount: number, corners: Corners | null, w: number, h: number): Corners | null {
  const unit = cornersFor(kind, 1, w, h)
  const delta = amount - presetAmount(kind, corners, w, h)
  const base = corners ?? ([[0, 0], [0, 0], [0, 0], [0, 0]] as Corners)
  const next = base.map(([x, y], i) => [x + unit[i][0] * delta, y + unit[i][1] * delta]) as Corners
  return next.every(([x, y]) => Math.abs(x) < 0.01 && Math.abs(y) < 0.01) ? null : next
}

// Selections and strokes are drawn where the creator sees them; the layer stores pixels in
// its own unrotated, undistorted, unflipped source space, so they are carried back there.
export function docToLayer(l: Layer, docSpace: HTMLCanvasElement, srcW: number, srcH: number): HTMLCanvasElement {
  const w = Math.max(1, Math.round(l.width))
  const h = Math.max(1, Math.round(l.height))
  const pad = isDistorted(l) ? overflow(l) + 2 : 0
  const boxed = canvas(w + pad * 2, h + pad * 2)
  const g = ctx2d(boxed)
  g.translate(pad + w / 2, pad + h / 2)
  g.rotate((-l.rotation * Math.PI) / 180)
  g.translate(-(l.x + l.width / 2), -(l.y + l.height / 2))
  g.drawImage(docSpace, 0, 0)
  const flat = pad ? undistort(boxed, l, w, h, pad) : boxed

  const out = canvas(srcW, srcH)
  const o = ctx2d(out)
  o.imageSmoothingQuality = 'high'
  o.scale(srcW / w, srcH / h)
  if (l.flipX || l.flipY) {
    o.translate(l.flipX ? w : 0, l.flipY ? h : 0)
    o.scale(l.flipX ? -1 : 1, l.flipY ? -1 : 1)
  }
  o.drawImage(flat, -pad, -pad)
  return out
}
