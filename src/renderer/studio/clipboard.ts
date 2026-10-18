import type { Layer } from '@shared/studio'
import { placeAsset } from './ai'
import { canvas, ctx2d, encode } from './assets'
import { newId } from './doc'
import type { Studio } from './engine'
import { drawLayer, loadDocAssets, raster } from './render'

let copied: { projectId: string; layers: Layer[] } | null = null

type Bounds = { x0: number; y0: number; x1: number; y1: number }

function bounds(studio: Studio, l: Layer): Bounds {
  const pad = raster(l, studio.assets)?.pad ?? 0
  const a = (l.rotation * Math.PI) / 180
  const hw = l.width / 2 + pad
  const hh = l.height / 2 + pad
  const ex = Math.abs(hw * Math.cos(a)) + Math.abs(hh * Math.sin(a))
  const ey = Math.abs(hw * Math.sin(a)) + Math.abs(hh * Math.cos(a))
  const cx = l.x + l.width / 2
  const cy = l.y + l.height / 2
  return { x0: Math.floor(cx - ex), y0: Math.floor(cy - ey), x1: Math.ceil(cx + ex), y1: Math.ceil(cy + ey) }
}

export async function copyLayers(studio: Studio, variantId: string, ids: string[]): Promise<void> {
  const doc = studio.doc(variantId)
  const layers = doc.layers.filter((l) => ids.includes(l.id))
  if (!layers.length) return
  await loadDocAssets(studio.assets, doc)
  const all = layers.map((l) => bounds(studio, l))
  const x0 = Math.min(...all.map((b) => b.x0))
  const y0 = Math.min(...all.map((b) => b.y0))
  const out = canvas(Math.max(...all.map((b) => b.x1)) - x0, Math.max(...all.map((b) => b.y1)) - y0)
  const g = ctx2d(out)
  g.translate(-x0, -y0)
  for (const l of layers) drawLayer(g, layers.length > 1 ? l : ({ ...l, blend: 'normal' } as Layer), studio.assets)
  await window.raeydzone.studio.copyImage(await encode(out))
  copied = { projectId: studio.projectId, layers }
}

export async function cutLayers(studio: Studio, variantId: string, ids: string[]): Promise<void> {
  await copyLayers(studio, variantId, ids)
  studio.removeMany(variantId, ids)
}

export async function pasteLayers(studio: Studio, variantId: string): Promise<boolean> {
  const pasted = await window.raeydzone.studio.paste(studio.projectId)
  if (!pasted) return false
  if (pasted.ours && copied?.projectId === studio.projectId) {
    let doc = studio.doc(variantId)
    const first = copied.layers[0]
    const shift = doc.layers.some((l) => l.x === first.x && l.y === first.y) ? 24 : 0
    const ids: string[] = []
    for (const src of copied.layers) {
      const layer = { ...src, id: newId(doc), x: src.x + shift, y: src.y + shift } as Layer
      doc = { ...doc, layers: [...doc.layers, layer] }
      ids.push(layer.id)
    }
    studio.commit(variantId, doc)
    studio.pick(variantId, ids)
    return true
  }
  const info = await studio.assets.addFile(pasted.file, pasted.name, 'upload')
  studio.addAsset(info)
  studio.select(variantId, placeAsset(studio, variantId, info).id)
  return true
}
