import { boxSelection, colorSelection, combine, layerFromSelection, maskWithSelection, refine } from '@renderer/studio/selection'
import { canvas, ctx2d } from '@renderer/studio/assets'
import { emptyDoc, findLayer, makeShape, makeText, patchLayer } from '@renderer/studio/doc'
import { Studio } from '@renderer/studio/engine'
import { newPaintLayer, paint } from '@renderer/studio/paint'
import { hitLayer, renderDoc } from '@renderer/studio/render'
import { toSource } from '@renderer/studio/mask'
import { docToLayer } from '@renderer/studio/warp'
import type { Layer, ShapeKind, StudioDoc, TextLayer } from '@shared/studio'
import type { Case } from './cases'

type Rgb = [number, number, number]
const BG: Rgb = [10, 10, 10]
const RED: Rgb = [255, 0, 0]
const GREEN: Rgb = [0, 255, 0]
const WHITE: Rgb = [255, 255, 255]

// Antialiasing and gradient interpolation land a step or two off exact values.
function close(got: Rgb, want: Rgb, tol = 6): string {
  return got.every((v, i) => Math.abs(v - want[i]) <= tol) ? 'match' : got.join(',')
}

function pixel(c: HTMLCanvasElement, x: number, y: number): Rgb {
  const d = ctx2d(c).getImageData(x, y, 1, 1).data
  return [d[0], d[1], d[2]]
}

function alphaAt(c: HTMLCanvasElement, x: number, y: number): number {
  return ctx2d(c).getImageData(x, y, 1, 1).data[3]
}

function count(c: HTMLCanvasElement, box: { x: number; y: number; width: number; height: number }, want: Rgb): number {
  const d = ctx2d(c).getImageData(box.x, box.y, box.width, box.height).data
  let n = 0
  for (let i = 0; i < d.length; i += 4) if (close([d[i], d[i + 1], d[i + 2]], want, 40) === 'match') n++
  return n
}

;(window as unknown as { raeydzone: unknown }).raeydzone = {
  studio: { putAsset: async (): Promise<void> => {} }
}

export async function runBundle(): Promise<Case[]> {
  const studio = new Studio('bundle', { kind: 'video', id: 'bundle', name: 'Bundle' })
  const cases: Case[] = []
  const check = (name: string, got: string, want: string): void => cases.push({ name, got, want })
  const shape = (doc: StudioDoc, kind: ShapeKind, patch: Record<string, unknown>): Layer =>
    patchLayer(makeShape(doc, kind), patch).layer
  const only = (...layers: Layer[]): StudioDoc => ({ ...emptyDoc(), layers })
  const draw = (doc: StudioDoc): HTMLCanvasElement => renderDoc(doc, studio.assets)

  // Wave 3 — shapes
  const ring = only(shape(emptyDoc(), 'ellipse', { x: 300, y: 200, width: 200, height: 200, fill: 'transparent', line: { color: '#ffffff', width: 12 } }))
  check('a hollow ring leaves its middle empty', close(pixel(draw(ring), 400, 300), BG), 'match')
  check('a hollow ring draws its line on the edge', close(pixel(draw(ring), 301, 300), WHITE, 30), 'match')

  const star = only(shape(emptyDoc(), 'star', { x: 300, y: 200, width: 200, height: 200, fill: '#ff0000', sides: 5, inset: 0.4 }))
  check('a star fills its top point', close(pixel(draw(star), 400, 210), RED, 30), 'match')
  check('a star leaves the corner between points empty', close(pixel(draw(star), 310, 210), BG), 'match')

  const arrow = only(shape(emptyDoc(), 'arrow', { x: 300, y: 200, width: 300, height: 100, fill: '#ff0000', inset: 0.4 }))
  check('an arrow is solid at its tip', close(pixel(draw(arrow), 590, 250), RED, 30), 'match')
  check('an arrow is empty above its shaft', close(pixel(draw(arrow), 310, 210), BG), 'match')

  const ramp = only(shape(emptyDoc(), 'rect', {
    x: 0, y: 0, width: 1280, height: 720,
    gradient: { type: 'linear', angle: 0, stops: [{ at: 0, color: '#ff0000' }, { at: 0.5, color: '#00ff00' }, { at: 1, color: '#0000ff' }] }
  }))
  check('a three-stop ramp passes through its middle colour', close(pixel(draw(ramp), 640, 360), GREEN, 8), 'match')
  check('a three-stop ramp starts at its first colour', close(pixel(draw(ramp), 2, 360), RED, 8), 'match')

  // Wave 4 — distortion
  const plain = shape(emptyDoc(), 'rect', { x: 500, y: 300, width: 200, height: 100, fill: '#ff0000' })
  const skewed = only(patchLayer(plain, { corners: [[50, 0], [50, 0], [-50, 0], [-50, 0]] }).layer)
  check('a skewed top edge moves right', close(pixel(draw(skewed), 505, 303), BG), 'match')
  check('a skewed bottom edge moves left', close(pixel(draw(skewed), 455, 397), RED, 30), 'match')
  check('a distorted layer is clickable outside its old box', hitLayer(skewed, studio.assets, 455, 397)?.id ?? 'none', plain.id)
  const corner = toSource(skewed.layers[0], 200, 100, [550, 300]).map(Math.round).join(',')
  check('mask painting finds the source pixel through the distortion', corner, '0,0')

  const band = shape(emptyDoc(), 'rect', { x: 300, y: 300, width: 400, height: 100, fill: '#ff0000' })
  const arched = only(patchLayer(band, { warp: { style: 'arch', bend: 0.5 } }).layer)
  check('an arch lifts the middle of the layer', close(pixel(draw(arched), 500, 270), RED, 30), 'match')
  check('an arch leaves the ends where they were', close(pixel(draw(arched), 302, 270), BG), 'match')

  // Wave 5 — text
  const words = 'THE QUICK BROWN FOX JUMPS OVER THE LAZY DOG'
  const straight = makeText(emptyDoc(), words)
  const wrapped = patchLayer(straight, { wrap: 300 }).layer as TextLayer
  check('wrapped text keeps the wrap width', String(Math.round(wrapped.width)), '300')
  check('wrapped text grows taller instead of wider', String(wrapped.height > straight.height * 2), 'true')
  const fitted = patchLayer(straight, { wrap: 300, fit: true }).layer as TextLayer
  check('shrink-to-fit stays inside the width', String(fitted.width <= 302), 'true')
  check('shrink-to-fit keeps one line', String(fitted.height < straight.height), 'true')
  const curved = patchLayer(makeText(emptyDoc(), 'ARCHED'), { arc: 120 }).layer as TextLayer
  check('arched text sizes its box to the curve', String(curved.height > makeText(emptyDoc(), 'ARCHED').height), 'true')

  const styled = patchLayer(makeText(emptyDoc(), 'AAAA BBBB'), { size: 160, fill: '#ffffff', styles: [{ start: 5, end: 9, fill: '#ff0000' }] }).layer
  const lit = draw(only(styled))
  const third = { x: Math.round(styled.x), y: Math.round(styled.y), width: Math.round(styled.width / 3), height: Math.round(styled.height) }
  const last = { ...third, x: Math.round(styled.x + styled.width) - third.width }
  check('a styled word takes its own colour', String(count(lit, last, RED) > 200), 'true')
  check('the unstyled word keeps the layer colour', String(count(lit, third, RED)), '0')

  // Wave 6 — selections and paint
  const pair = only(
    shape(emptyDoc(), 'rect', { x: 100, y: 100, width: 100, height: 100, fill: '#ff0000' }),
    shape(emptyDoc(), 'rect', { x: 400, y: 100, width: 100, height: 100, fill: '#ff0000' })
  )
  const flat = draw(pair)
  const wand = colorSelection(flat, 150, 150, 20, true)
  check('the wand takes the touching region', String(alphaAt(wand, 150, 150)), '255')
  check('the wand stops at a gap', String(alphaAt(wand, 450, 150)), '0')
  check('colour range takes every match', String(alphaAt(colorSelection(flat, 150, 150, 20, false), 450, 150)), '255')

  const box = boxSelection(emptyDoc(), { x: 100, y: 100, width: 100, height: 100 }, false)
  check('growing a selection pushes its edge out', String(alphaAt(refine(box, 'grow', 10), 95, 150) > 200), 'true')
  check('shrinking a selection pulls its edge in', String(alphaAt(refine(box, 'shrink', 10), 105, 150)), '0')
  check('subtracting everything leaves no selection', String(combine(box, box, 'subtract')), 'null')

  // A stroke drawn on the canvas must land on the matching source pixel of a flipped layer.
  const mirrored = { ...shape(emptyDoc(), 'rect', { x: 100, y: 100, width: 200, height: 100 }), flipX: true } as Layer
  const dot = canvas(1280, 720)
  ctx2d(dot).fillRect(105, 145, 10, 10)
  const local = docToLayer(mirrored, dot, 400, 200)
  check('a canvas mark lands mirrored on a flipped layer', String(alphaAt(local, 380, 100) > 0), 'true')
  check('and not on the unflipped side', String(alphaAt(local, 20, 100)), '0')

  const v = studio.addVariant(only(shape(emptyDoc(), 'rect', { x: 0, y: 0, width: 1280, height: 720, fill: '#00ff00' })))
  const layer = await newPaintLayer(studio, v.id)
  await paint(studio, v.id, layer.id, {
    mode: 'brush', points: [[600, 360], [700, 360]], radius: 12, color: '#ff0000', opacity: 1, hardness: 1
  }, null)
  check('a brush stroke paints on its layer', close(pixel(draw(studio.doc(v.id)), 650, 360), RED, 10), 'match')
  check('a brush stroke stays on its path', close(pixel(draw(studio.doc(v.id)), 650, 300), GREEN, 10), 'match')

  await paint(studio, v.id, layer.id, {
    mode: 'erase', points: [[650, 360]], radius: 20, color: '#000', opacity: 1, hardness: 1
  }, null)
  check('the eraser removes paint', close(pixel(draw(studio.doc(v.id)), 650, 360), GREEN, 10), 'match')

  const clipped = boxSelection(studio.doc(v.id), { x: 800, y: 300, width: 50, height: 120 }, false)
  await paint(studio, v.id, layer.id, {
    mode: 'brush', points: [[760, 360], [900, 360]], radius: 10, color: '#ffffff', opacity: 1, hardness: 1
  }, clipped)
  check('a stroke stays inside the selection', close(pixel(draw(studio.doc(v.id)), 820, 360), WHITE, 10), 'match')
  check('a stroke is cut where the selection ends', close(pixel(draw(studio.doc(v.id)), 780, 360), GREEN, 10), 'match')

  const base = findLayer(studio.doc(v.id), studio.doc(v.id).layers[0].id)
  await maskWithSelection(studio, v.id, base, boxSelection(studio.doc(v.id), { x: 0, y: 0, width: 640, height: 720 }, false), 'inside')
  check('keep-inside hides the layer outside the selection', close(pixel(draw(studio.doc(v.id)), 1000, 100), BG, 10), 'match')
  const piece = await layerFromSelection(studio, v.id, boxSelection(studio.doc(v.id), { x: 100, y: 100, width: 50, height: 50 }, false), null)
  const pieceLayer = piece ? findLayer(studio.doc(v.id), piece) : null
  check('a layer from a selection is cropped to it', pieceLayer ? `${pieceLayer.x},${pieceLayer.y},${pieceLayer.width}` : 'none', '100,100,50')

  return cases
}
