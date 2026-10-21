import { canvas, ctx2d } from '@renderer/studio/assets'
import { alignLayers, distributeLayers, emptyDoc, findLayer, groupLayers, makeImage, makeShape, makeText, patchLayer } from '@renderer/studio/doc'
import { diagnose } from '@renderer/studio/doctor'
import { Studio } from '@renderer/studio/engine'
import { snapMove } from '@renderer/studio/snap'
import type { Layer, StudioDoc } from '@shared/studio'
import type { Case } from './cases'

export async function runWave8(): Promise<Case[]> {
  const studio = new Studio('wave8', { kind: 'video', id: 'wave8', name: 'Wave 8' })
  const cases: Case[] = []
  const check = (name: string, got: string, want: string): void => cases.push({ name, got, want })
  const rect = (x: number, y: number, w = 50, h = 50, extra: Record<string, unknown> = {}): Layer =>
    patchLayer(makeShape(emptyDoc(), 'rect'), { x, y, width: w, height: h, ...extra }).layer
  const only = (...layers: Layer[]): StudioDoc => ({ ...emptyDoc(), layers })
  const xs = (doc: StudioDoc): string => doc.layers.map((l) => Math.round(l.x)).join(',')

  const pair = only(rect(100, 100), rect(300, 200))
  check('aligning left edges lines them up', xs(alignLayers(pair, pair.layers.map((l) => l.id), 'left')), '100,100')
  check('aligning right edges lines them up', xs(alignLayers(pair, pair.layers.map((l) => l.id), 'right')), '300,300')
  const lone = only(rect(100, 100, 200))
  check('one layer aligns to the canvas', xs(alignLayers(lone, [lone.layers[0].id], 'center')), '540')

  const parts = only(rect(100, 100), rect(200, 100), rect(600, 300))
  const grouped = groupLayers(parts, [parts.layers[0].id, parts.layers[1].id], 'Badge').doc
  const all = grouped.layers.map((l) => l.id)
  check('a whole group aligns as one block', xs(alignLayers(grouped, all, 'right')), '500,600,600')

  const row = only(rect(0, 0), rect(100, 0), rect(1000, 0))
  check('distributing makes the gaps equal', xs(distributeLayers(row, row.layers.map((l) => l.id), 'x')), '0,500,1000')

  const snapped = snapMove(emptyDoc(), { x: 535, y: 100, width: 200, height: 100 }, new Set(), 6)
  check('a dragged centre snaps to the canvas centre', `${snapped.dx},${snapped.lines.some((l) => l.axis === 'x' && l.at === 640)}`, '5,true')
  const free = snapMove(emptyDoc(), { x: 520, y: 100, width: 200, height: 100 }, new Set(), 6)
  check('nothing snaps out of reach', `${free.dx},${free.dy}`, '0,0')
  const toGuide = snapMove({ ...emptyDoc(), guides: [{ axis: 'y', at: 300 }] }, { x: 10, y: 296, width: 50, height: 50 }, new Set(), 6)
  check('a top edge snaps to a guide', String(toGuide.dy), '4')
  const toLayer = snapMove(only(rect(400, 400, 100, 100)), { x: 503, y: 10, width: 40, height: 40 }, new Set(), 6)
  check('an edge snaps to another layer', String(toLayer.dx), '-3')

  const findings = (doc: StudioDoc): string => diagnose(doc, studio.assets).map((i) => i.id.replace(/L\w+$/, '')).sort().join(' ')
  const text = (t: string, extra: Record<string, unknown> = {}): Layer => patchLayer(makeText(emptyDoc(), t), extra).layer
  check('tiny text is flagged', String(findings(only(text('HI', { size: 40 }))).includes('small')), 'true')
  check('big text is not flagged as small', String(findings(only(text('HI', { size: 140 }))).includes('small')), 'false')
  const white = { ...emptyDoc(), background: '#ffffff' }
  const pale = text('HI', { size: 140, fill: '#f4f4f4' })
  check('pale text on white is flagged', String(findings({ ...white, layers: [pale] }).includes('contrast')), 'true')
  const outlined = patchLayer(pale, { strokes: [{ color: '#000000', width: 10 }] }).layer
  check('an outline fixes the contrast', String(findings({ ...white, layers: [outlined] }).includes('contrast')), 'false')
  check('text under the length badge is flagged', String(findings(only(text('HI', { size: 100, x: 1100, y: 620 }))).includes('badge')), 'true')
  check('text off the edge is flagged', String(findings(only(text('HI', { size: 140, x: -60, y: 100 }))).includes('cut')), 'true')
  check('a long line of text gets a tip', String(findings(only(text('ONE TWO THREE FOUR FIVE SIX SEVEN'))).includes('words')), 'true')
  check('a flat image gets a tip', String(findings(only(rect(0, 0, 1280, 720, { fill: '#181818' }))).includes('flat')), 'true')

  const person = canvas(400, 600)
  const pg = ctx2d(person)
  pg.fillStyle = '#c08060'
  pg.fillRect(0, 0, 400, 600)
  const photo = await studio.assets.addCanvas(person, 'Person', 'upload')
  const mask = await studio.assets.addCanvas(person, 'Mask', 'mask')
  studio.addAsset(photo)
  studio.addAsset(mask)
  const subject = { ...makeImage(emptyDoc(), photo), x: 100, y: 100, width: 400, height: 600, mask: mask.id } as Layer
  const overFace = text('WOW', { size: 160, x: 160, y: 120 })
  const below = text('WOW', { size: 160, x: 700, y: 120 })
  check('text over a cut-out face is flagged', String(findings(only(subject, overFace)).includes('face')), 'true')
  check('text beside the cut-out is not', String(findings(only(subject, below)).includes('face')), 'false')
  check('the finding points at the covering layer', diagnose(only(subject, overFace), studio.assets).find((i) => i.id.startsWith('face'))?.layer ?? 'none', findLayer(only(subject, overFace), overFace.id).id)

  return cases
}
