import type { StudioDoc } from '@shared/studio'
import { canvas, ctx2d, encode } from './assets'
import type { AssetStore } from './assets'
import { scaleDoc } from './doc'
import { loadDocAssets, renderDoc } from './render'

export const EXPORT_SIZES = [
  { w: 1280, label: '1280 × 720', note: 'YouTube' },
  { w: 1920, label: '1920 × 1080', note: 'Full HD' },
  { w: 2560, label: '2560 × 1440', note: 'QHD' },
  { w: 3840, label: '3840 × 2160', note: '4K' }
] as const

// YouTube refuses thumbnails over 2 MB.
export const UPLOAD_LIMIT = 2_000_000
const MAX_SIDE = 7680

// Halving step by step keeps thin strokes and small type from shimmering.
export function downscale(src: HTMLCanvasElement, w: number, h: number): HTMLCanvasElement {
  let cur = src
  while (cur.width / 2 >= w) {
    const half = canvas(cur.width / 2, cur.height / 2)
    const g = ctx2d(half)
    g.imageSmoothingQuality = 'high'
    g.drawImage(cur, 0, 0, half.width, half.height)
    cur = half
  }
  if (cur.width === w && cur.height === h) return cur
  const out = canvas(w, h)
  const g = ctx2d(out)
  g.imageSmoothingQuality = 'high'
  g.drawImage(cur, 0, 0, w, h)
  return out
}

// Supersampling renders every effect at twice the size, so edges come out cleaner shrunk.
export async function renderAt(doc: StudioDoc, assets: AssetStore, w: number, supersample = true): Promise<HTMLCanvasElement> {
  await loadDocAssets(assets, doc)
  const h = Math.round((w * doc.height) / doc.width)
  const k = Math.min(MAX_SIDE / doc.width, (w / doc.width) * (supersample ? 2 : 1))
  const big = k === 1 ? renderDoc(doc, assets) : renderDoc(scaleDoc(doc, k), assets)
  return downscale(big, w, h)
}

export async function encodeFor(c: HTMLCanvasElement, format: 'jpg' | 'png', limit: number | null): Promise<Uint8Array> {
  if (format === 'png') return encode(c, 'image/png')
  let q = 0.95
  let data = await encode(c, 'image/jpeg', q)
  while (limit && data.length > limit && q > 0.5) {
    q -= 0.05
    data = await encode(c, 'image/jpeg', q)
  }
  return data
}

export interface ExportOptions {
  sizes: number[]
  format: 'jpg' | 'png'
  supersample: boolean
  limit: boolean
}

export async function exportFiles(doc: StudioDoc, assets: AssetStore, name: string, o: ExportOptions): Promise<{ name: string; data: Uint8Array }[]> {
  const safe = name.replace(/[^\w.-]+/g, '_').replace(/_+/g, '_').replace(/^[._]+|[._]+$/g, '').slice(0, 60) || 'Thumbnail'
  const out: { name: string; data: Uint8Array }[] = []
  for (const w of o.sizes) {
    const h = Math.round((w * doc.height) / doc.width)
    const c = await renderAt(doc, assets, w, o.supersample)
    out.push({ name: `${safe}_${w}x${h}.${o.format}`, data: await encodeFor(c, o.format, o.limit ? UPLOAD_LIMIT : null) })
  }
  return out
}
