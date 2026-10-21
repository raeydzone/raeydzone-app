import { AssetStore, canvas, ctx2d } from '@renderer/studio/assets'
import { duplicateLayers, emptyDoc, groupLayers, makeShape, normalizeDoc, patchLayer, removeLayer } from '@renderer/studio/doc'
import { hitLayer, renderDoc } from '@renderer/studio/render'
import type { Layer, StudioDoc } from '@shared/studio'

// The node test runner cannot drive the renderer: compositing needs a real canvas. These
// cases run inside an offscreen Electron window and compare the pixels that came out.
export interface Case {
  name: string
  got: string
  want: string
}

const BG = '10,10,10'
const RED = '255,0,0'
const GREEN = '0,255,0'
const WHITE = '255,255,255'
const BLACK = '0,0,0'

// The store persists through the preload bridge; here it only has to keep the pixels.
;(window as unknown as { raeydzone: unknown }).raeydzone = {
  studio: { putAsset: async (): Promise<void> => {} }
}

const assets = new AssetStore('test', () => {})

function shape(doc: StudioDoc, patch: Record<string, unknown>): Layer {
  return patchLayer(makeShape(doc, 'rect'), patch).layer
}

function withLayers(...patches: Record<string, unknown>[]): StudioDoc {
  let doc = emptyDoc()
  for (const p of patches) doc = { ...doc, layers: [...doc.layers, shape(doc, p)] }
  return doc
}

function at(doc: StudioDoc, x: number, y: number): string {
  const d = ctx2d(renderDoc(doc, assets)).getImageData(x, y, 1, 1).data
  return [d[0], d[1], d[2]].join(',')
}

function clipTo(
  doc: StudioDoc,
  index: number,
  from: string,
  extra: Record<string, unknown> = {}
): StudioDoc {
  const layers = [...doc.layers]
  layers[index] = patchLayer(layers[index], { clip: { from, ...extra } }).layer
  return { ...doc, layers }
}

export async function run(): Promise<Case[]> {
  const cases: Case[] = []
  const check = (name: string, got: string, want: string): void => cases.push({ name, got, want })

  const box = withLayers(
    { name: 'A', x: 100, y: 100, width: 400, height: 200, fill: '#ff0000' },
    { name: 'B', x: 100, y: 100, width: 600, height: 200, fill: '#00ff00' }
  )
  const a = box.layers[0].id
  check('an unclipped layer covers its whole box', at(box, 550, 150), GREEN)
  check('a clip keeps what the source covers', at(clipTo(box, 1, a), 150, 150), GREEN)
  check('a clip drops what the source misses', at(clipTo(box, 1, a), 550, 150), BG)
  check('inverted, the source area shows what is beneath', at(clipTo(box, 1, a, { invert: true }), 150, 150), RED)
  check('inverted, the rest of the layer stays', at(clipTo(box, 1, a, { invert: true }), 550, 150), GREEN)

  // A rotated layer's raster lives in its own space, so the clip must be carried into it.
  const turned = withLayers(
    { name: 'A', x: 0, y: 0, width: 400, height: 720, fill: '#ff0000', visible: false },
    { name: 'B', x: 200, y: 200, width: 400, height: 200, fill: '#00ff00', rotation: 90 }
  )
  const left = turned.layers[0].id
  check('a rotated layer is clipped in canvas space', at(clipTo(turned, 1, left), 350, 300), GREEN)
  check('a rotated layer is cut where the source ends', at(clipTo(turned, 1, left), 450, 300), BG)
  check('a hidden source still clips', at(clipTo(turned, 1, left), 350, 300), GREEN)

  const grey = withLayers(
    { name: 'A', x: 0, y: 0, width: 1280, height: 720, fill: '#808080', visible: false },
    { name: 'B', x: 100, y: 100, width: 400, height: 200, fill: '#00ff00' }
  )
  const half = clipTo(grey, 1, grey.layers[0].id, { mode: 'luma' })
  check('luma mode turns mid-grey into half coverage', at(half, 200, 150), '5,133,5')

  const m = canvas(200, 100)
  const mg = ctx2d(m)
  mg.fillStyle = '#fff'
  mg.fillRect(0, 0, 100, 100)
  const info = await assets.addCanvas(m, 'mask', 'mask')
  const plain = withLayers({ name: 'B', x: 100, y: 100, width: 400, height: 200, fill: '#00ff00' })
  const masked = { ...plain, layers: [{ ...plain.layers[0], mask: info.id }] }
  check('a shape keeps the painted half of its mask', at(masked, 200, 150), GREEN)
  check('a shape loses the unpainted half', at(masked, 400, 150), BG)

  const solid = { name: 'S', x: 300, y: 300, width: 200, height: 100, fill: '#00ff00' }
  const ringed = withLayers({
    ...solid,
    strokes: [
      { color: '#ffffff', width: 10 },
      { color: '#000000', width: 10 }
    ]
  })
  check('the first stroke hugs the edge', at(ringed, 295, 350), WHITE)
  check('the second stroke wraps the first', at(ringed, 285, 350), BLACK)
  check('nothing past the outermost stroke', at(ringed, 270, 350), BG)

  const inside = withLayers({ ...solid, stroke: { color: '#ff0000', width: 10, position: 'inside' } })
  check('an inside stroke paints within the edge', at(inside, 305, 350), RED)
  check('an inside stroke leaves the middle alone', at(inside, 340, 350), GREEN)
  check('an inside stroke does not grow the shape', at(inside, 295, 350), BG)

  const sunk = withLayers({ ...solid, shadow: { color: '#000000', opacity: 1, blur: 0, x: 0, y: 20, inner: true } })
  check('an inner shadow darkens the edge it falls from', at(sunk, 400, 305), BLACK)
  check('an inner shadow stays inside the shape', at(sunk, 400, 295), BG)
  check('an inner shadow leaves the far side lit', at(sunk, 400, 380), GREEN)

  const legacy = { ...plain.layers[0], strokes: undefined, stroke: { color: '#fff', width: 6, opacity: 1 } }
  const migrated = normalizeDoc({ ...plain, layers: [legacy as unknown as Layer] }).layers[0]
  check(
    'a saved single stroke becomes a one-entry stack, the old key dropped',
    `${migrated.strokes.length}:${migrated.strokes[0]?.position}:${'stroke' in migrated}`,
    '1:outside:false'
  )

  const covered = clipTo(box, 1, a)
  check('a clipped layer is hit where it shows', hitLayer(covered, assets, 150, 150)?.name ?? 'none', 'B')
  check('a clipped layer lets clicks through where it is cut', hitLayer(covered, assets, 550, 150)?.name ?? 'none', 'none')

  // The group is dropped in the same pass that empties it, so it cannot count as a source.
  const trio = withLayers(
    { name: 'A', x: 100, y: 100, width: 200, height: 200, fill: '#ff0000' },
    { name: 'C', x: 300, y: 100, width: 200, height: 200, fill: '#ff0000' },
    { name: 'B', x: 100, y: 100, width: 600, height: 200, fill: '#00ff00' }
  )
  const [first, second] = trio.layers
  const grouped = groupLayers(trio, [first.id, second.id], 'Stencil')
  const viaGroup = clipTo(grouped.doc, grouped.doc.layers.findIndex((l) => l.name === 'B'), grouped.group.id)
  const clipOf = (d: StudioDoc): string => String(d.layers.find((l) => l.name === 'B')?.clip?.from ?? null)
  const halfGone = removeLayer(viaGroup, first.id)
  check('a clip to a group survives while the group has members', clipOf(halfGone), grouped.group.id)
  check('a clip to a group is cleared once the group empties', clipOf(removeLayer(halfGone, second.id)), 'null')

  const both = duplicateLayers(viaGroup, viaGroup.layers.map((l) => l.id))
  const copyB = both.doc.layers.find((l) => both.ids.includes(l.id) && l.name.startsWith('B'))
  const copyGroup = both.doc.groups.find((g) => g.id !== grouped.group.id)
  check('duplicating a group rebinds clips aimed at it', String(copyB?.clip?.from === copyGroup?.id), 'true')

  return cases
}
