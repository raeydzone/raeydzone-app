import { canvas, ctx2d } from '@renderer/studio/assets'
import { applyStyle, brandId, saveBrand, styleFrom, syncLinked } from '@renderer/studio/brand'
import {
  chainOf, emptyDoc, openDoc, findLayer, groupLayers, groupMembers, makeImage, makeShape, makeText, patchLayer, scaleDoc, tidyGroups, ungroup
} from '@renderer/studio/doc'
import { Studio } from '@renderer/studio/engine'
import { encodeFor, renderAt } from '@renderer/studio/exporter'
import { extractPalette } from '@renderer/studio/palette'
import { renderDoc } from '@renderer/studio/render'
import { maskGroup } from '@renderer/studio/selection'
import type { BrandKit, Layer, StudioDoc, TextLayer } from '@shared/studio'
import type { Case } from './cases'

type Rgb = [number, number, number]

function pixel(c: HTMLCanvasElement, x: number, y: number): Rgb {
  const d = ctx2d(c).getImageData(x, y, 1, 1).data
  return [d[0], d[1], d[2]]
}

export async function runWave9(): Promise<Case[]> {
  const host = window as unknown as { raeydzone: { studio: Record<string, unknown> } }
  host.raeydzone.studio.saveBrand = async (kit: BrandKit): Promise<BrandKit> => kit
  const studio = new Studio('wave9', { kind: 'video', id: 'wave9', name: 'Wave 9' })
  const cases: Case[] = []
  const check = (name: string, got: string, want: string): void => cases.push({ name, got, want })
  const rect = (patch: Record<string, unknown>): Layer => patchLayer(makeShape(emptyDoc(), 'rect'), patch).layer
  const only = (...layers: Layer[]): StudioDoc => ({ ...emptyDoc(), layers })
  const draw = (doc: StudioDoc): HTMLCanvasElement => renderDoc(doc, studio.assets)
  const grey = rect({ x: 0, y: 0, width: 1280, height: 720, fill: '#808080' })

  const vignetted = draw({ ...only(grey), finish: { sharpen: 0, clarity: 0, vibrance: 0, bloom: 0, vignette: 1, grain: 0 } })
  check('a vignette darkens the corners', String(pixel(vignetted, 4, 4)[0] < 60), 'true')
  check('a vignette leaves the centre', String(Math.abs(pixel(vignetted, 640, 360)[0] - 128) <= 3), 'true')
  const grainy = draw({ ...only(grey), finish: { sharpen: 0, clarity: 0, vibrance: 0, bloom: 0, vignette: 0, grain: 1 } })
  const spread = new Set([0, 1, 2, 3, 4, 5, 6, 7].map((i) => pixel(grainy, 600 + i, 300)[0])).size
  check('grain varies flat areas', String(spread > 2), 'true')
  const edge = only(rect({ x: 0, y: 0, width: 640, height: 720, fill: '#404040' }), rect({ x: 640, y: 0, width: 640, height: 720, fill: '#a0a0a0' }))
  const sharp = draw({ ...edge, finish: { sharpen: 1, clarity: 0, vibrance: 0, bloom: 0, vignette: 0, grain: 0 } })
  check('sharpening deepens the dark side of an edge', String(pixel(sharp, 639, 360)[0] < 0x40), 'true')

  const box = rect({ x: 500, y: 200, width: 200, height: 200, fill: '#ffffff', contact: { opacity: 1, blur: 4, squash: 0.1, y: 6 } })
  const floor = draw(only(box))
  check('a contact shadow lies under the layer', String(pixel(floor, 600, 405)[0] < 8), 'true')
  check('a contact shadow stays near the floor', String(pixel(floor, 600, 440)[0] >= 9), 'true')

  const red = rect({ x: 0, y: 0, width: 1280, height: 720, fill: '#ff0000' })
  const dark = rect({ x: 400, y: 200, width: 400, height: 300, fill: '#000000', lightWrap: { amount: 1, size: 30 } })
  const wrapped = draw(only(red, dark))
  check('light wrap tints the edge with the scene', String(pixel(wrapped, 404, 350)[0] > 40), 'true')
  check('light wrap leaves the middle alone', String(pixel(wrapped, 600, 350)[0] < 6), 'true')

  const a = rect({ name: 'A', x: 100, y: 100, width: 100, height: 100 })
  const b = rect({ name: 'B', x: 300, y: 100, width: 100, height: 100 })
  const c = rect({ name: 'C', x: 500, y: 100, width: 100, height: 100 })
  const inner = groupLayers(only(a, b, c), [a.id, b.id], 'Inner')
  const outer = groupLayers(inner.doc, [a.id, b.id, c.id], 'Outer')
  const nested = outer.doc
  check('grouping a whole group nests it', inner.doc.groups.length + ':' + (nested.groups.find((g) => g.id === inner.group.id)?.parent ?? 'none'), '1:' + outer.group.id)
  check('the outer group holds every layer inside', String(groupMembers(nested, outer.group.id).length), '3')
  check('a layer knows both of its groups', chainOf(nested, findLayer(nested, a.id).group).map((g) => g.name).join('>'), 'Inner>Outer')
  const opened = ungroup(nested, outer.group.id)
  check('ungrouping the outer group keeps the inner one', opened.groups.map((g) => g.name + ':' + g.parent).join(), 'Inner:null')
  check('ungrouping hands loose layers to the parent', String(findLayer(opened, c.id).group), 'null')
  const loop = tidyGroups({ ...nested, groups: nested.groups.map((g) => (g.id === outer.group.id ? { ...g, parent: inner.group.id } : g)) })
  check('a parent loop is broken, not followed', String(loop.groups.filter((g) => g.parent === null).length >= 1), 'true')

  const v = studio.addVariant(only(red, a, b))
  const g = studio.group(v.id, [a.id, b.id], 'Pair')
  const half = canvas(1280, 720)
  ctx2d(half).fillRect(0, 0, 250, 720)
  await maskGroup(studio, v.id, g, half, 'outside')
  const cut = draw(studio.doc(v.id))
  check('a group mask hides every member', `${pixel(cut, 150, 150).join()}|${pixel(cut, 350, 150)[0] > 200 && pixel(cut, 350, 150)[1] < 60}`, '255,0,0|true')
  studio.saveSnapshot(v.id, 'Before')
  studio.patch(v.id, a.id, { x: 900 })
  studio.restoreSnapshot(v.id, studio.variant(v.id).snapshots[0].id)
  check('restoring a snapshot brings the design back', String(findLayer(studio.doc(v.id), a.id).x), '100')

  const word = patchLayer(makeText(emptyDoc(), 'BIG'), { size: 100, strokes: [{ width: 8 }], x: 100, y: 100 }).layer as TextLayer
  const doubled = scaleDoc(only(word), 2)
  const big = doubled.layers[0] as TextLayer
  check('a scaled design scales type and outlines', `${doubled.width}x${doubled.height} ${big.size} ${big.strokes[0].width} ${big.x}`, '2560x1440 200 16 200')
  const hd = await renderAt(only(red), studio.assets, 1920)
  check('an export renders at the asked size', `${hd.width}x${hd.height}`, '1920x1080')
  const noisy = canvas(1280, 720)
  const ng = ctx2d(noisy)
  const img = ng.createImageData(1280, 720)
  for (let i = 0; i < img.data.length; i++) img.data[i] = (i * 2654435761) % 256
  ng.putImageData(img, 0, 0)
  const loose = await encodeFor(noisy, 'jpg', null)
  const limit = Math.round(loose.length * 0.7)
  const capped = await encodeFor(noisy, 'jpg', limit)
  check('a jpeg is squeezed under the size limit', String(capped.length <= limit), 'true')

  const two = canvas(200, 100)
  const tg = ctx2d(two)
  tg.fillStyle = '#ff0000'
  tg.fillRect(0, 0, 150, 100)
  tg.fillStyle = '#00ff00'
  tg.fillRect(150, 0, 50, 100)
  check('the palette finds the main colours, most used first', extractPalette(two, 4).slice(0, 2).join(), '#ff0000,#00ff00')

  const source = patchLayer(makeText(emptyDoc(), 'STYLE'), { fill: '#ff2a2a', strokes: [{ color: '#000000', width: 12 }] }).layer
  const style = { id: brandId(), name: 'Headline', kind: 'text' as const, props: styleFrom(source), updatedAt: '' }
  await saveBrand({ colors: [], fonts: [], styles: [style], logos: [] })
  const plain = makeText(emptyDoc(), 'PLAIN')
  const sv = studio.addVariant(only(plain))
  applyStyle(studio, sv.id, plain.id, style)
  const after = findLayer(studio.doc(sv.id), plain.id) as TextLayer
  check('a brand style carries its look', `${after.fill} ${after.strokes[0]?.width} ${after.link === style.id}`, '#ff2a2a 12 true')
  check('a brand style keeps the text', after.text, 'PLAIN')
  await saveBrand({ colors: [], fonts: [], styles: [{ ...style, props: { ...style.props, fill: '#00ff00' } }], logos: [] })
  syncLinked(studio)
  check('a linked layer follows its edited style', (findLayer(studio.doc(sv.id), plain.id) as TextLayer).fill, '#00ff00')
  await saveBrand({ colors: [], fonts: [], styles: [], logos: [] })
  syncLinked(studio)
  check('deleting a style unlinks but keeps the look', `${findLayer(studio.doc(sv.id), plain.id).link} ${(findLayer(studio.doc(sv.id), plain.id) as TextLayer).fill}`, 'null #00ff00')

  const photo = await studio.assets.addCanvas(two, 'Two', 'upload')
  studio.addAsset(photo)
  const pic = makeImage(emptyDoc(), photo)
  check('an image takes only the shared part of a text style', String(patchLayer(pic, styleFrom(source)).ignored.length > 0), 'true')

  const legacy = makeText(emptyDoc(), 'OLD') as Partial<TextLayer>
  delete legacy.styles
  delete legacy.wrap
  const reopened = (() => {
    try {
      return String((openDoc(only(legacy as Layer)).layers[0] as TextLayer).styles.length)
    } catch (err) {
      return (err as Error).message
    }
  })()
  check('a text layer saved before word styles still opens', reopened, '0')

  return cases
}
