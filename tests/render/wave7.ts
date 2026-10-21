import { canvas, ctx2d } from '@renderer/studio/assets'
import { emptyDoc, makeAdjust, makeShape, patchLayer } from '@renderer/studio/doc'
import { Studio } from '@renderer/studio/engine'
import { hasGl } from '@renderer/studio/gl'
import { hitLayer, renderDoc } from '@renderer/studio/render'
import { autoLevels, curveTable, matchGrade, parseCube } from '@renderer/studio/tone'
import type { Layer, StudioDoc } from '@shared/studio'
import type { Case } from './cases'

type Rgb = [number, number, number]

function near(got: Rgb, want: Rgb, tol = 8): string {
  return got.every((v, i) => Math.abs(v - want[i]) <= tol) ? 'match' : got.join(',')
}

function pixel(c: HTMLCanvasElement, x: number, y: number): Rgb {
  const d = ctx2d(c).getImageData(x, y, 1, 1).data
  return [d[0], d[1], d[2]]
}

function flat(color: string): HTMLCanvasElement {
  const c = canvas(64, 64)
  const g = ctx2d(c)
  g.fillStyle = color
  g.fillRect(0, 0, 64, 64)
  return c
}

export async function runWave7(): Promise<Case[]> {
  const studio = new Studio('wave7', { kind: 'video', id: 'wave7', name: 'Wave 7' })
  const cases: Case[] = []
  const check = (name: string, got: string, want: string): void => cases.push({ name, got, want })
  const shape = (patch: Record<string, unknown>): Layer => patchLayer(makeShape(emptyDoc(), 'rect'), patch).layer
  const only = (...layers: Layer[]): StudioDoc => ({ ...emptyDoc(), layers })
  const draw = (doc: StudioDoc): HTMLCanvasElement => renderDoc(doc, studio.assets)
  const red = { x: 100, y: 100, width: 200, height: 200, fill: '#ff0000' }

  check('WebGL2 is available to the compositor', String(hasGl()), 'true')

  const ramp = curveTable([[0, 0], [64, 40], [192, 220], [255, 255]])
  check('a curve passes through its points', String(Math.round(ramp[64] * 255)), '40')
  check('a curve never runs backwards', String(ramp.every((v, i) => i === 0 || v >= ramp[i - 1])), 'true')

  const grey = shape({ ...red, fill: '#808080', tone: { levels: { black: 128 } } })
  check('levels clip everything below the black point', near(pixel(draw(only(grey)), 200, 200), [0, 0, 0], 6), 'match')
  const lifted = shape({ ...red, fill: '#000000', tone: { levels: { outBlack: 100 } } })
  check('levels lift black to the output floor', near(pixel(draw(only(lifted)), 200, 200), [100, 100, 100], 3), 'match')

  const inverted = shape({ ...red, tone: { curves: { rgb: [[0, 255], [255, 0]] } } })
  check('an inverting curve turns red cyan', near(pixel(draw(only(inverted)), 200, 200), [0, 255, 255]), 'match')
  const blueless = shape({ ...red, fill: '#ffffff', tone: { curves: { b: [[0, 0], [255, 0]] } } })
  check('a channel curve touches only its channel', near(pixel(draw(only(blueless)), 200, 200), [255, 255, 0]), 'match')

  const mapped = shape({ ...red, tone: { map: { stops: [{ at: 0, color: '#000000' }, { at: 1, color: '#ffffff' }] } } })
  check('a gradient map follows brightness', near(pixel(draw(only(mapped)), 200, 200), [54, 54, 54]), 'match')
  const graded = shape({ ...red, fill: '#ffffff', tone: { grade: { gain: [0, 1, 1] } } })
  check('a grade scales each channel', near(pixel(draw(only(graded)), 200, 200), [0, 255, 255]), 'match')
  check('a neutral tone is stored as none', String(patchLayer(shape(red), { tone: { levels: null } }).layer.tone), 'null')

  // Red and blue swapped: entries run red fastest, so index 1 is pure red in, blue out.
  const swap = ['LUT_3D_SIZE 2', '0 0 0', '0 0 1', '0 1 0', '0 1 1', '1 0 0', '1 0 1', '1 1 0', '1 1 1'].join('\n')
  const info = await studio.assets.addCanvas(parseCube(swap), 'Swap', 'lut')
  studio.addAsset(info)
  const looked = shape({ ...red, tone: { lut: { asset: info.id, name: 'Swap' } } })
  check('a LUT remaps colour through the cube', near(pixel(draw(only(looked)), 200, 200), [0, 0, 255]), 'match')

  const band = canvas(200, 100)
  const bg = ctx2d(band)
  bg.fillStyle = '#404040'
  bg.fillRect(0, 0, 200, 50)
  bg.fillStyle = '#c0c0c0'
  bg.fillRect(0, 50, 200, 50)
  const auto = autoLevels(band)
  check('auto levels finds the darkest and brightest tones', `${auto.black},${auto.white}`, '64,192')
  const match = matchGrade(flat('#646464'), flat('#c8c8c8'))
  const out = match ? Math.round((100 / 255) * match.gain[0] * 255 + match.lift[0] * 255) : -1
  check('a colour match carries one image to the other', String(Math.abs(out - 200) <= 2), 'true')

  const line = shape({ x: 400, y: 200, width: 4, height: 200, fill: '#ffffff' })
  const moved = draw(only(patchLayer(line, { blurFx: { style: 'motion', amount: 60, angle: 0 } }).layer))
  check('a motion blur smears sideways', String(pixel(moved, 420, 300)[0] > 14), 'true')
  check('a motion blur does not smear across its direction', near(pixel(moved, 402, 190), [10, 10, 10], 3), 'match')

  const dot = (x: number, y: number): Layer => shape({ x, y, width: 8, height: 8, fill: '#ffffff' })
  const field = (blurFx: Record<string, unknown>): HTMLCanvasElement => {
    const adj = patchLayer(makeAdjust(emptyDoc()), { blurFx }).layer
    return draw(only(dot(636, 356), dot(636, 96), adj))
  }
  const tilt = field({ style: 'tilt', amount: 30, angle: 0, x: 0.5, y: 0.5, focus: 0.2 })
  check('tilt-shift keeps its band sharp', near(pixel(tilt, 640, 360), [255, 255, 255], 10), 'match')
  check('tilt-shift blurs away from the band', String(pixel(tilt, 640, 100)[0] < 120), 'true')
  const lens = field({ style: 'lens', amount: 30, focus: 0 })
  check('a lens blur spreads a point into a disc', String(pixel(lens, 660, 360)[0] > 12), 'true')
  const zoom = field({ style: 'zoom', amount: 80, x: 0.5, y: 0.5 })
  check('a zoom blur streaks along the line to its centre', String(pixel(zoom, 640, 88)[0] > 12), 'true')
  check('a zoom blur leaves the spot beside a point alone', near(pixel(zoom, 660, 100), [10, 10, 10], 3), 'match')

  const spin = field({ style: 'spin', amount: 20, x: 0.5, y: 0.5 })
  check('a spin blur sweeps round its centre', String(pixel(spin, 670, 101)[0] > 12), 'true')
  check('a spin blur leaves its centre sharp', near(pixel(spin, 640, 360), [255, 255, 255], 10), 'match')

  const adj = patchLayer(makeAdjust(emptyDoc()), { tone: { curves: { rgb: [[0, 255], [255, 0]] } } }).layer
  const under = draw(only(shape(red), adj))
  check('an adjustment layer changes the layers below it', near(pixel(under, 200, 200), [0, 255, 255]), 'match')
  check('an adjustment layer changes the background too', near(pixel(under, 600, 600), [245, 245, 245]), 'match')
  const over = draw(only(adj, shape(red)))
  check('an adjustment layer leaves the layers above it alone', near(pixel(over, 200, 200), [255, 0, 0]), 'match')
  const half = patchLayer(adj, { width: 640 }).layer
  check('an adjustment layer stops at its box', near(pixel(draw(only(shape(red), shape({ ...red, x: 800 }), half)), 900, 200), [255, 0, 0]), 'match')
  const faint = patchLayer(adj, { opacity: 0.5 }).layer
  check('an adjustment layer fades with its opacity', near(pixel(draw(only(shape(red), faint)), 200, 200), [128, 128, 128], 4), 'match')
  const off = patchLayer(adj, { visible: false }).layer
  check('a hidden adjustment layer does nothing', near(pixel(draw(only(shape(red), off)), 200, 200), [255, 0, 0]), 'match')
  const subject = shape(red)
  const clippedAdj = patchLayer(adj, { clip: { from: subject.id } }).layer
  const clippedDoc = draw(only(subject, clippedAdj))
  check('a clipped adjustment changes only its source', near(pixel(clippedDoc, 600, 600), [10, 10, 10], 3), 'match')
  check('and still changes the source itself', near(pixel(clippedDoc, 200, 200), [0, 255, 255]), 'match')
  check('clicks pass through an adjustment layer', hitLayer(only(subject, adj), studio.assets, 200, 200)?.id ?? 'none', subject.id)
  check('an adjustment layer takes no outline', String(patchLayer(adj, { strokes: [{}] }).ignored.join()), 'strokes')

  return cases
}
