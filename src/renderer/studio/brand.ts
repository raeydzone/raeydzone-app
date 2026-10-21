import { useSyncExternalStore } from 'react'
import { EMPTY_KIT } from '@shared/studio'
import type { BrandKit, BrandLogo, BrandStyle, Layer } from '@shared/studio'
import { placeAsset } from './ai'
import { findLayer, patchLayer } from './doc'
import type { Studio } from './engine'

let kit: BrandKit = EMPTY_KIT
let loading: Promise<BrandKit> | null = null
const listeners = new Set<() => void>()
const notify = (): void => listeners.forEach((fn) => fn())

export function loadBrand(): Promise<BrandKit> {
  loading ??= window.raeydzone.studio.brand().then((k) => {
    kit = k
    window.raeydzone.studio.onBrand((next) => {
      kit = next
      notify()
    })
    notify()
    return k
  })
  return loading
}

export const brandKit = (): BrandKit => kit

export function subscribeBrand(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export function useBrand(): BrandKit {
  return useSyncExternalStore(subscribeBrand, () => kit)
}

export async function saveBrand(next: BrandKit): Promise<void> {
  kit = await window.raeydzone.studio.saveBrand(next)
  notify()
}

export const brandId = (): string => Math.random().toString(36).slice(2, 9)

// A style carries the look, never the place; a LUT is one project's asset and stays behind.
const LOOK = ['blend', 'shadows', 'glows', 'strokes', 'tint', 'adjust', 'tone', 'lightWrap', 'contact']
const BY_KIND: Record<Layer['kind'], string[]> = {
  text: ['font', 'weight', 'italic', 'uppercase', 'fill', 'gradient', 'highlight', 'letterSpacing', 'lineHeight'],
  shape: ['fill', 'gradient', 'line', 'radius', 'feather'],
  image: [],
  adjust: []
}

export function styleFrom(l: Layer): Record<string, unknown> {
  const all = l as unknown as Record<string, unknown>
  const props = Object.fromEntries([...LOOK, ...BY_KIND[l.kind]].map((k) => [k, all[k]]))
  if (l.tone?.lut) props.tone = { ...l.tone, lut: null }
  return JSON.parse(JSON.stringify(props))
}

function propsFor(style: BrandStyle, l: Layer): Record<string, unknown> {
  const keys = new Set([...LOOK, ...(style.kind === l.kind ? BY_KIND[l.kind] : [])])
  const out = Object.fromEntries(Object.entries(style.props).filter(([k]) => keys.has(k)))
  // A layer's own LUT survives a style that has none to give.
  if (out.tone && l.tone?.lut) out.tone = { ...(out.tone as object), lut: l.tone.lut }
  return out
}

// A brand font missing on this PC must not break the layer; it keeps its current look.
function styled(l: Layer, style: BrandStyle): Layer {
  try {
    return { ...patchLayer(l, propsFor(style, l)).layer, link: style.id } as Layer
  } catch {
    return l
  }
}

export function applyStyle(studio: Studio, variantId: string, layerId: string, style: BrandStyle): void {
  const l = findLayer(studio.doc(variantId), layerId)
  studio.replaceMany(variantId, [{ ...patchLayer(l, propsFor(style, l)).layer, link: style.id } as Layer])
}

// Linked layers follow their style: after the kit changes, or when a project opens on a
// kit edited elsewhere. A style that was deleted lets its layers go, keeping their look.
export function syncLinked(studio: Studio): void {
  const styles = new Map(kit.styles.map((st) => [st.id, st]))
  for (const v of studio.state.variants) {
    let changed = false
    const layers = v.doc.layers.map((l) => {
      if (!l.link) return l
      const style = styles.get(l.link)
      const next = style ? styled(l, style) : ({ ...l, link: null } as Layer)
      if (JSON.stringify(next) === JSON.stringify(l)) return l
      changed = true
      return next
    })
    if (changed) studio.commit(v.id, { ...v.doc, layers }, { record: false })
  }
}

export async function placeLogo(studio: Studio, variantId: string, logo: BrandLogo): Promise<Layer> {
  const file = await window.raeydzone.studio.logoToProject(studio.projectId, logo.file)
  const info = await studio.assets.addFile(file, logo.name, 'upload')
  studio.addAsset(info)
  const layer = placeAsset(studio, variantId, info, 'contain', true)
  const w = Math.min(layer.width, studio.doc(variantId).width * 0.2)
  studio.patch(variantId, layer.id, { name: logo.name, width: w, x: 32, y: 32 })
  return findLayer(studio.doc(variantId), layer.id)
}
