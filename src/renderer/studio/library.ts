import type { AssetInfo, Layer, LayerGroup, StudioFile } from '@shared/studio'
import { AssetStore } from './assets'
import { newGroupId, newId, normalizeDoc } from './doc'
import type { Studio } from './engine'

export interface Source {
  projectId: string
  file: StudioFile
  assets: AssetStore
}

export async function openSource(studio: Studio, projectId: string): Promise<Source> {
  if (projectId === studio.projectId) {
    const { assets, variants, activeId } = studio.state
    return { projectId, file: { version: 1, assets, variants, activeId }, assets: studio.assets }
  }
  const file = await window.raeydzone.studio.load(projectId)
  if (!file) throw new Error('That project has no thumbnail studio yet.')
  const assets = new AssetStore(projectId, () => {})
  assets.register(file.assets)
  return { projectId, file: { ...file, variants: file.variants.map((v) => ({ ...v, doc: normalizeDoc(v.doc) })) }, assets }
}

export async function bringAssets(studio: Studio, fromProject: string, infos: AssetInfo[]): Promise<Map<string, string>> {
  if (fromProject === studio.projectId) return new Map(infos.map((a) => [a.id, a.id]))
  const files = await window.raeydzone.studio.copyAssets(fromProject, studio.projectId, infos.map((a) => a.file))
  const map = new Map<string, string>()
  for (const [i, src] of infos.entries()) {
    const info = await studio.assets.addFile(files[i], src.label, src.source)
    studio.addAsset(info)
    map.set(src.id, info.id)
  }
  return map
}

// Imported layers land on top with fresh ids; whole groups come along as new groups.
export async function importLayers(
  studio: Studio,
  variantId: string,
  fromProject: string,
  layers: Layer[],
  groups: LayerGroup[],
  assets: AssetInfo[],
  shift = 0
): Promise<string[]> {
  const needed = new Set(layers.flatMap((l) => (l.kind === 'image' ? [l.asset, ...(l.mask ? [l.mask] : [])] : [])))
  const map = await bringAssets(studio, fromProject, assets.filter((a) => needed.has(a.id)))
  let doc = studio.doc(variantId)
  const regroup = new Map<string, string>()
  for (const g of groups) {
    if (!layers.some((l) => l.group === g.id)) continue
    const id = newGroupId(doc)
    doc = { ...doc, groups: [...doc.groups, { id, name: g.name }] }
    regroup.set(g.id, id)
  }
  const ids: string[] = []
  for (const src of layers) {
    const layer = { ...src, id: newId(doc), x: src.x + shift, y: src.y + shift, group: src.group ? regroup.get(src.group) ?? null : null } as Layer
    if (layer.kind === 'image' && src.kind === 'image') {
      const asset = map.get(src.asset)
      if (!asset) continue
      layer.asset = asset
      layer.mask = src.mask ? map.get(src.mask) ?? null : null
    }
    doc = { ...doc, layers: [...doc.layers, layer] }
    ids.push(layer.id)
  }
  studio.commit(variantId, doc)
  studio.pick(variantId, ids)
  return ids
}
