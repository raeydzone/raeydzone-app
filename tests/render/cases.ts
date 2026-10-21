import { AssetStore, canvas, ctx2d } from '@renderer/studio/assets'
import { emptyDoc, makeShape, patchLayer } from '@renderer/studio/doc'
import { renderDoc } from '@renderer/studio/render'
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

// The store writes every canvas it is handed through the preload bridge; here it only
// has to remember the pixels.
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

  // Masks were an image-layer field; every kind carries one now.
  const m = canvas(200, 100)
  const mg = ctx2d(m)
  mg.fillStyle = '#fff'
  mg.fillRect(0, 0, 100, 100)
  const info = await assets.addCanvas(m, 'mask', 'mask')
  const plain = withLayers({ name: 'B', x: 100, y: 100, width: 400, height: 200, fill: '#00ff00' })
  const masked = { ...plain, layers: [{ ...plain.layers[0], mask: info.id }] }
  check('a shape keeps the painted half of its mask', at(masked, 200, 150), GREEN)
  check('a shape loses the unpainted half', at(masked, 400, 150), BG)

  return cases
}
