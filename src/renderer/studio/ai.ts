import { closestAspect, imageModel } from '@shared/studio'
import type { AssetInfo, ImageLayer, ImageRequest, ImageResult, ImageTask, Layer } from '@shared/studio'
import { canvas, copyOf, ctx2d, decode, encode } from './assets'
import { findLayer, makeImage } from './doc'
import type { Studio } from './engine'
import { baseMask, featherMask, invertMask, matteToMask, paintBrush, paintPolygon, toSource } from './mask'
import type { Pt } from './mask'
import { loadDocAssets, renderDoc } from './render'

export interface Box {
  x: number
  y: number
  width: number
  height: number
}

const image = (studio: Studio, task: ImageTask, req: Omit<ImageRequest, 'task' | 'projectId'>): Promise<ImageResult> =>
  window.raeydzone.studio.image({ ...req, task, projectId: studio.projectId })

function imageLayer(studio: Studio, variantId: string, layerId: string): ImageLayer {
  const layer = findLayer(studio.doc(variantId), layerId)
  if (layer.kind !== 'image') throw new Error(`${layer.name} is a ${layer.kind} layer — masks only apply to image layers.`)
  return layer
}

const modelFor = (studio: Studio, task: ImageTask) => imageModel(studio.state.imageModels[task])

function padToAspect(src: HTMLCanvasElement, aspects: string[]): { padded: HTMLCanvasElement; ox: number; oy: number; aspect: string } {
  const { label, ratio } = closestAspect(src.width, src.height, aspects)
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
  const model = modelFor(studio, 'cutout')
  const { padded, ox, oy, aspect } = padToAspect(crop, model.aspects)

  const what = subject?.trim() ? subject.trim() : 'the main subject'
  const prompt =
    `Make a precise black-and-white cut-out matte of this image. Paint ${what} pure white (#FFFFFF), ` +
    'including every part of it — hair, fine edges, clothing and anything it holds. Paint everything else pure black (#000000)' +
    (ox || oy ? ', including the flat grey border, which is only padding' : '') +
    '. Keep exactly the same framing, scale and outline as the input: no cropping, zooming, shifting or redrawing. Output only the matte.'

  const res = await image(studio, 'cutout', { model: model.id, prompt, images: [await encode(padded)], aspect, detail: 'edit' })
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

export interface AssetRequest {
  prompt: string
  refs?: string[]
  layers?: string[]
  canvas?: boolean
  aspect?: string
  transparent?: boolean
}

async function references(studio: Studio, variantId: string | null, req: AssetRequest): Promise<Uint8Array[]> {
  const out: Uint8Array[] = []
  for (const id of req.refs ?? []) out.push(await encode(copyOf(await studio.assets.get(id), 1536)))
  if (variantId && (req.canvas || req.layers?.length)) {
    const doc = studio.doc(variantId)
    await loadDocAssets(studio.assets, doc)
    if (req.canvas) out.push(await encode(renderDoc(doc, studio.assets)))
    for (const id of req.layers ?? []) out.push(await encode(renderDoc(doc, studio.assets, findLayer(doc, id).id)))
  }
  return out
}

export async function generateAsset(
  studio: Studio,
  variantId: string | null,
  req: AssetRequest
): Promise<{ info: AssetInfo; cost: number | null; transparent: boolean; model: string }> {
  const model = modelFor(studio, 'generate')
  const images = await references(studio, variantId, req)
  if (images.length > model.maxRefs) {
    throw new Error(`${model.label} takes at most ${model.maxRefs} reference images; ${images.length} were given.`)
  }
  const aspect = req.aspect && model.aspects.includes(req.aspect) ? req.aspect : closestAspect(16, 9, model.aspects).label
  const transparent = !!req.transparent && model.transparent
  const res = await image(studio, 'generate', { model: model.id, prompt: req.prompt, images, aspect, transparent, detail: 'final' })
  const bitmap = await decode(res.data)
  const info = await studio.assets.addCanvas(copyOf(bitmap), req.prompt.slice(0, 48), 'generated')
  studio.addAsset(info)
  return { info, cost: res.cost, transparent, model: imageModel(res.model).label }
}

export function placeAsset(studio: Studio, variantId: string, info: AssetInfo, fit: 'cover' | 'contain' = 'contain', touched = false): Layer {
  return studio.addLayer(variantId, makeImage(studio.doc(variantId), info, fit), null, touched)
}

// The feather has to fall outside the region, or whatever sat on its border shows through.
// Sides that meet the canvas edge run past it so the blur cannot fade them.
function fillMask(r: Box, ctxBox: Box, edge: number): HTMLCanvasElement {
  const p = 2 * edge
  const big = canvas(ctxBox.width + 2 * p, ctxBox.height + 2 * p)
  const x0 = r.x - edge <= ctxBox.x ? 0 : r.x - ctxBox.x - edge + p
  const y0 = r.y - edge <= ctxBox.y ? 0 : r.y - ctxBox.y - edge + p
  const x1 = r.x + r.width + edge >= ctxBox.x + ctxBox.width ? big.width : r.x + r.width - ctxBox.x + edge + p
  const y1 = r.y + r.height + edge >= ctxBox.y + ctxBox.height ? big.height : r.y + r.height - ctxBox.y + edge + p
  const bg = ctx2d(big)
  bg.fillStyle = '#fff'
  bg.fillRect(x0, y0, x1 - x0, y1 - y0)
  const out = canvas(ctxBox.width, ctxBox.height)
  ctx2d(out).drawImage(featherMask(big, edge), -p, -p)
  return out
}

function fitAspect(r: Box, W: number, H: number, aspects: string[]): Box {
  const { ratio } = closestAspect(r.width, r.height, aspects)
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
  touched = false,
  keepContents = false
): Promise<{ layer: Layer; cost: number | null }> {
  const doc = studio.doc(variantId)
  // Boxes get drawn tight around the thing to replace, which leaves its outline and shadow
  // just outside; a little slack catches them.
  const slack = Math.max(8, Math.round(0.03 * Math.max(region.width, region.height)))
  const r = {
    x: Math.max(0, region.x - slack),
    y: Math.max(0, region.y - slack),
    width: Math.min(doc.width, region.x + region.width + slack) - Math.max(0, region.x - slack),
    height: Math.min(doc.height, region.y + region.height + slack) - Math.max(0, region.y - slack)
  }
  if (r.width < 16 || r.height < 16) throw new Error('The fill region is too small or off the canvas.')

  const margin = Math.max(48, 0.35 * Math.max(r.width, r.height))
  const grown = {
    x: Math.max(0, r.x - margin),
    y: Math.max(0, r.y - margin),
    width: Math.min(doc.width, r.x + r.width + margin) - Math.max(0, r.x - margin),
    height: Math.min(doc.height, r.y + r.height + margin) - Math.max(0, r.y - margin)
  }
  const model = modelFor(studio, 'fill')
  const ctxBox = fitAspect(grown, doc.width, doc.height, model.aspects)
  const { label: aspect } = closestAspect(ctxBox.width, ctxBox.height, model.aspects)

  const up = Math.max(1, 1024 / Math.max(ctxBox.width, ctxBox.height))
  const composite = renderDoc(doc, studio.assets)
  const context = canvas(ctxBox.width * up, ctxBox.height * up)
  const hole: [number, number, number, number] = [(r.x - ctxBox.x) * up, (r.y - ctxBox.y) * up, r.width * up, r.height * up]
  const cg = ctx2d(context)
  cg.drawImage(composite, ctxBox.x, ctxBox.y, ctxBox.width, ctxBox.height, 0, 0, context.width, context.height)
  // A model shown the old pixels tends to keep them, so a replacement fill only sees a hole.
  if (!keepContents) {
    cg.fillStyle = '#808080'
    cg.fillRect(...hole)
  }
  const guide = canvas(context.width, context.height)
  const gg = ctx2d(guide)
  gg.fillStyle = '#000'
  gg.fillRect(0, 0, guide.width, guide.height)
  gg.fillStyle = '#fff'
  gg.fillRect(...hole)

  const instruction = (keepContents
    ? 'The first image is part of a YouTube thumbnail; the second is a mask of the same size. ' +
      `Repaint only the area that is white in the mask: ${prompt}. `
    : 'The first image is part of a YouTube thumbnail with a flat grey rectangular hole in it; the second image is a mask marking that hole in white. ' +
      `Fill the hole completely with: ${prompt}. Continue the surrounding scene through it seamlessly — no grey, no edge, no outline and nothing framed may remain. `) +
    'Match the surrounding lighting, perspective, grain and style so it looks photographed and real, never AI-generated. ' +
    'Keep everything outside the white area unchanged and keep the same framing. No text, no borders, no frames, no overlays.'
  const res = await image(studio, 'fill', {
    model: model.id,
    prompt: instruction,
    images: [await encode(context), await encode(guide)],
    aspect,
    detail: 'edit'
  })
  const out = await decode(res.data)

  const filled = canvas(ctxBox.width, ctxBox.height)
  const fg = ctx2d(filled)
  fg.imageSmoothingQuality = 'high'
  fg.drawImage(out, 0, 0, filled.width, filled.height)
  const info = await studio.assets.addCanvas(filled, 'Fill · ' + prompt.slice(0, 32), 'fill')
  studio.addAsset(info)

  const edge = Math.min(48, Math.max(6, 0.12 * Math.min(r.width, r.height)))
  const maskInfo = await studio.assets.addCanvas(fillMask(r, ctxBox, edge), 'Fill mask', 'mask')
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
