import type { Layer, StudioDoc, Tone } from '@shared/studio'
import { canvas, ctx2d } from './assets'
import type { AssetStore } from './assets'
import { findLayer } from './doc'
import type { Studio } from './engine'
import { drawLayer, loadDocAssets, renderDoc } from './render'
import { LOOKS, autoLevels, matchGrade, parseCube } from './tone'

// An adjustment layer measures what is below it; its own earlier tone must not skew that.
function pixelsOf(doc: StudioDoc, l: Layer, assets: AssetStore, drop: Partial<Tone>): HTMLCanvasElement {
  if (l.kind === 'adjust') return renderDoc({ ...doc, layers: doc.layers.slice(0, doc.layers.indexOf(l)) }, assets)
  const out = canvas(doc.width, doc.height)
  const tone = l.tone ? { ...l.tone, ...drop } : null
  drawLayer(ctx2d(out), { ...l, tone, opacity: 1, blend: 'normal', visible: true } as Layer, assets, doc)
  return out
}

export async function autoLevelsOn(studio: Studio, variantId: string, layerId: string): Promise<void> {
  const doc = studio.doc(variantId)
  await loadDocAssets(studio.assets, doc)
  const layer = findLayer(doc, layerId)
  const levels = autoLevels(pixelsOf(doc, layer, studio.assets, { levels: null, curves: null, map: null, lut: null }))
  studio.patch(variantId, layerId, { tone: { levels } }, undefined, true)
}

export async function matchColors(studio: Studio, variantId: string, layerId: string, refId: string | null): Promise<void> {
  const doc = studio.doc(variantId)
  await loadDocAssets(studio.assets, doc)
  const layer = findLayer(doc, layerId)
  const src = pixelsOf(doc, layer, studio.assets, { grade: null, levels: null, curves: null, map: null, lut: null })
  const ref = refId
    ? pixelsOf(doc, findLayer(doc, refId), studio.assets, {})
    : renderDoc({ ...doc, layers: doc.layers.filter((l) => l.id !== layerId && l.kind !== 'adjust') }, studio.assets)
  const grade = matchGrade(src, ref)
  if (!grade) throw new Error('There are no visible pixels to match.')
  studio.patch(variantId, layerId, { tone: { grade } }, undefined, true)
}

export function applyLook(studio: Studio, variantId: string, layerId: string, lookId: string): void {
  const look = LOOKS.find((l) => l.id === lookId)
  if (!look) throw new Error(`Unknown look "${lookId}". Looks: ${LOOKS.map((l) => l.id).join(', ')}`)
  studio.patch(variantId, layerId, { tone: { levels: null, curves: null, map: null, grade: null, ...look.tone } }, undefined, true)
}

export async function loadLut(studio: Studio, variantId: string, layerId: string): Promise<boolean> {
  const picked = await window.raeydzone.studio.pickLut()
  if (!picked) return false
  const info = await studio.assets.addCanvas(parseCube(picked.text), picked.name, 'lut')
  studio.addAsset(info)
  studio.patch(variantId, layerId, { tone: { lut: { asset: info.id, name: picked.name, amount: 1 } } })
  return true
}
