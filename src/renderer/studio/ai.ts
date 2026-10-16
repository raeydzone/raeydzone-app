import { closestAspect } from '@shared/studio'
import type { AssetInfo, ImageLayer, Layer } from '@shared/studio'
import { canvas, copyOf, ctx2d, decode, encode } from './assets'
import { findLayer, makeImage } from './doc'
import type { Studio } from './engine'
import { baseMask, featherMask, invertMask, matteToMask, paintBrush, paintPolygon, toSource } from './mask'
import type { Pt } from './mask'
import { renderDoc } from './render'

export interface Box {
  x: number
  y: number
  width: number
  height: number
}

const image = (): typeof window.raeydzone.studio.image => window.raeydzone.studio.image

function imageLayer(studio: Studio, variantId: string, layerId: string): ImageLayer {
  const layer = findLayer(studio.doc(variantId), layerId)
  if (layer.kind !== 'image') throw new Error(`${layer.name} is a ${layer.kind} layer — masks only apply to image layers.`)
  return layer
}

function padToAspect(src: HTMLCanvasElement): { padded: HTMLCanvasElement; ox: number; oy: number; aspect: string } {
  const { label, ratio } = closestAspect(src.width, src.height)
  const w = src.width / src.height < ratio ? Math.round(src.height * ratio) : src.width
  const h = src.width / src.height < ratio ? src.height : Math.round(src.width / ratio)
  const padded = canvas(w, h)
  const g = ctx2d(padded)
  g.fillStyle = '#808080'
  g.fillRect(0, 0, w, h)
  const ox = Math.round((w - src.width) / 2)
  const oy = Math.round((h - src.height) / 2)
  g.drawImage(src, ox, oy)
  return { padded, ox, oy, aspect: label }
}

async function saveMask(studio: Studio, variantId: string, layer: ImageLayer, mask: HTMLCanvasElement | null): Promise<void> {
  let maskId: string | null = null
  if (mask) {
    const info = await studio.assets.addCanvas(mask, layer.name + ' mask', 'mask')
    studio.addAsset(info)
    maskId = info.id
  }
  studio.update(variantId, (d) => ({
    ...d,
    layers: d.layers.map((l) => (l.id === layer.id ? { ...(l as ImageLayer), mask: maskId } : l))
  }), { touched: layer.id })
}

export async function cutOut(
  studio: Studio,
  variantId: string,
  layerId: string,
  subject?: string,
  box?: Box
): Promise<number | null> {
  const layer = imageLayer(studio, variantId, layerId)
  const src = await studio.assets.get(layer.asset)
  const W = src.width
  const H = src.height

  let rx = 0, ry = 0, rw = W, rh = H
  if (box) {
    const corners: Pt[] = [
      [box.x, box.y], [box.x + box.width, box.y], [box.x, box.y + box.height], [box.x + box.width, box.y + box.height]
    ].map((p) => toSource(layer, W, H, p as Pt))
    const xs = corners.map((c) => c[0])
    const ys = corners.map((c) => c[1])
    const margin = 0.04 * Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys))
    rx = Math.max(0, Math.floor(Math.min(...xs) - margin))
    ry = Math.max(0, Math.floor(Math.min(...ys) - margin))
    rw = Math.min(W, Math.ceil(Math.max(...xs) + margin)) - rx
    rh = Math.min(H, Math.ceil(Math.max(...ys) + margin)) - ry
    if (rw < 8 || rh < 8) throw new Error('The box does not overlap the layer.')
  }

  const scale = Math.min(1, 1536 / Math.max(rw, rh))
  const crop = canvas(rw * scale, rh * scale)
  const cg = ctx2d(crop)
  cg.imageSmoothingQuality = 'high'
  cg.drawImage(src, rx, ry, rw, rh, 0, 0, crop.width, crop.height)
  const { padded, ox, oy, aspect } = padToAspect(crop)

  const what = subject?.trim() ? subject.trim() : 'the main subject'
  const prompt =
    `Make a precise black-and-white cut-out matte of this image. Paint ${what} pure white (#FFFFFF), ` +
    'including every part of it — hair, fine edges, clothing and anything it holds. Paint everything else pure black (#000000)' +
    (ox || oy ? ', including the flat grey border, which is only padding' : '') +
    '. Keep exactly the same framing, scale and outline as the input: no cropping, zooming, shifting or redrawing. Output only the matte.'

  const res = await image()({ prompt, images: [await encode(padded)], aspect })
  const out = await decode(res.data)
  const matte = canvas(crop.width, crop.height)
  const mg = ctx2d(matte)
  const sx = out.width / padded.width
  const sy = out.height / padded.height
  mg.drawImage(out, ox * sx, oy * sy, crop.width * sx, crop.height * sy, 0, 0, crop.width, crop.height)
  matteToMask(matte)

  const mask = canvas(W, H)
  const g = ctx2d(mask)
  g.imageSmoothingQuality = 'high'
  g.drawImage(matte, rx, ry, rw, rh)
  await saveMask(studio, variantId, layer, mask)
  return res.cost
}

export async function editMask(
  studio: Studio,
  variantId: string,
  layerId: string,
  action: string,
  points: Pt[] = [],
  radius = 20
): Promise<void> {
  const layer = imageLayer(studio, variantId, layerId)
  if (action === 'reset') return saveMask(studio, variantId, layer, null)

  const src = await studio.assets.get(layer.asset)
  const current = layer.mask ? await studio.assets.get(layer.mask) : null
  const scale = src.width / layer.width
  const mask = baseMask(src.width, src.height, current)
  const pts = points.map((p) => toSource(layer, src.width, src.height, p))

  let result = mask
  switch (action) {
    case 'invert':
      result = invertMask(mask)
      break
    case 'feather':
      result = featherMask(mask, Math.max(1, radius) * scale)
      break
    case 'hide_polygon':
    case 'show_polygon':
      if (pts.length < 3) throw new Error('A polygon needs at least 3 points.')
      paintPolygon(mask, pts, action === 'show_polygon')
      break
    case 'hide_brush':
    case 'show_brush':
      if (!pts.length) throw new Error('A brush stroke needs at least 1 point.')
      paintBrush(mask, pts, Math.max(1, radius) * scale, action === 'show_brush')
      break
    default:
      throw new Error('Unknown mask action ' + action)
  }
  await saveMask(studio, variantId, layer, result)
}

export async function generateAsset(
  studio: Studio,
  prompt: string,
  refs: string[] = [],
  aspect = '16:9'
): Promise<{ info: AssetInfo; cost: number | null }> {
  const images: Uint8Array[] = []
  for (const id of refs) images.push(await encode(copyOf(await studio.assets.get(id), 1536)))
  const res = await image()({ prompt, images, aspect })
  const bitmap = await decode(res.data)
  const info = await studio.assets.addCanvas(copyOf(bitmap), prompt.slice(0, 48), 'generated')
  studio.addAsset(info)
  return { info, cost: res.cost }
}

export function placeAsset(studio: Studio, variantId: string, info: AssetInfo, fit: 'cover' | 'contain' = 'contain', touched = false): Layer {
  return studio.addLayer(variantId, makeImage(studio.doc(variantId), info, fit), null, touched)
}

function fitAspect(r: Box, W: number, H: number): Box {
  const { ratio } = closestAspect(r.width, r.height)
  let { x, y, width, height } = r
  if (width / height < ratio) width = Math.min(W, height * ratio)
  else height = Math.min(H, width / ratio)
  x = Math.max(0, Math.min(W - width, x - (width - r.width) / 2))
  y = Math.max(0, Math.min(H - height, y - (height - r.height) / 2))
  return { x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) }
}

export async function generativeFill(
  studio: Studio,
  variantId: string,
  prompt: string,
  region: Box,
  touched = false
): Promise<{ layer: Layer; cost: number | null }> {
  const doc = studio.doc(variantId)
  const r = {
    x: Math.max(0, region.x),
    y: Math.max(0, region.y),
    width: Math.min(doc.width, region.x + region.width) - Math.max(0, region.x),
    height: Math.min(doc.height, region.y + region.height) - Math.max(0, region.y)
  }
  if (r.width < 16 || r.height < 16) throw new Error('The fill region is too small or off the canvas.')

  const margin = Math.max(48, 0.35 * Math.max(r.width, r.height))
  const grown = {
    x: Math.max(0, r.x - margin),
    y: Math.max(0, r.y - margin),
    width: Math.min(doc.width, r.x + r.width + margin) - Math.max(0, r.x - margin),
    height: Math.min(doc.height, r.y + r.height + margin) - Math.max(0, r.y - margin)
  }
  const ctxBox = fitAspect(grown, doc.width, doc.height)
  const { label: aspect } = closestAspect(ctxBox.width, ctxBox.height)

  const up = Math.max(1, 1024 / Math.max(ctxBox.width, ctxBox.height))
  const composite = renderDoc(doc, studio.assets)
  const context = canvas(ctxBox.width * up, ctxBox.height * up)
  ctx2d(context).drawImage(composite, ctxBox.x, ctxBox.y, ctxBox.width, ctxBox.height, 0, 0, context.width, context.height)
  const guide = canvas(context.width, context.height)
  const gg = ctx2d(guide)
  gg.fillStyle = '#000'
  gg.fillRect(0, 0, guide.width, guide.height)
  gg.fillStyle = '#fff'
  gg.fillRect((r.x - ctxBox.x) * up, (r.y - ctxBox.y) * up, r.width * up, r.height * up)

  const instruction =
    'The first image is part of a YouTube thumbnail; the second is a mask of the same size. ' +
    `Repaint only the area that is white in the mask: ${prompt}. ` +
    'Match the surrounding lighting, perspective, grain and style so it looks photographed and real, never AI-generated. ' +
    'Keep everything outside the white area unchanged and keep the same framing. No text, no borders.'
  const res = await image()({ prompt: instruction, images: [await encode(context), await encode(guide)], aspect })
  const out = await decode(res.data)

  const filled = canvas(ctxBox.width, ctxBox.height)
  const fg = ctx2d(filled)
  fg.imageSmoothingQuality = 'high'
  fg.drawImage(out, 0, 0, filled.width, filled.height)
  const info = await studio.assets.addCanvas(filled, 'Fill · ' + prompt.slice(0, 32), 'fill')
  studio.addAsset(info)

  const area = canvas(ctxBox.width, ctxBox.height)
  const ag = ctx2d(area)
  ag.fillStyle = '#fff'
  const edge = Math.min(48, Math.max(6, 0.12 * Math.min(r.width, r.height)))
  ag.fillRect(r.x - ctxBox.x + edge / 2, r.y - ctxBox.y + edge / 2, r.width - edge, r.height - edge)
  const maskInfo = await studio.assets.addCanvas(featherMask(area, edge), 'Fill mask', 'mask')
  studio.addAsset(maskInfo)

  const base = makeImage(studio.doc(variantId), info)
  const layer: ImageLayer = {
    ...base,
    name: 'Fill · ' + prompt.slice(0, 24),
    x: ctxBox.x,
    y: ctxBox.y,
    width: ctxBox.width,
    height: ctxBox.height,
    mask: maskInfo.id
  }
  studio.addLayer(variantId, layer, null, touched)
  return { layer, cost: res.cost }
}
