import type { Layer, StudioDoc, ToolReply } from '@shared/studio'
import { canvas, ctx2d, copyOf, encode, toBase64 } from './assets'
import { cutOut, editMask, generateAsset, generativeFill, placeAsset } from './ai'
import type { Box } from './ai'
import { asColor, describeLayer, findLayer, makeShape, makeText, patchLayer } from './doc'
import type { Studio } from './engine'
import type { Pt } from './mask'
import { fontFamilies } from './fonts'
import { renderDoc } from './render'

type Args = Record<string, unknown>

interface Outcome {
  reply: ToolReply
  summary: string
}

const PLACEMENT = new Set(['asset_id', 'fit', 'below_layer_id', 'layer_id'])
const label = (l: Layer): string => (l.kind === 'text' ? `"${l.text.replace(/\*/g, '').slice(0, 30)}"` : l.name)
const json = (value: unknown): string => JSON.stringify(value)
const money = (cost: number | null): string => (cost ? ` ($${cost.toFixed(3)})` : '')

function props(args: Args): Args {
  return Object.fromEntries(Object.entries(args).filter(([k]) => !PLACEMENT.has(k)))
}

function str(args: Args, key: string): string {
  const v = args[key]
  if (typeof v !== 'string' || !v.trim()) throw new Error(`${key} is required`)
  return v
}

function box(value: unknown): Box | undefined {
  if (!value || typeof value !== 'object') return undefined
  const b = value as Record<string, unknown>
  const n = (k: string): number => Number(b[k])
  if (![n('x'), n('y'), n('width'), n('height')].every(Number.isFinite)) throw new Error('A box needs x, y, width and height')
  return { x: n('x'), y: n('y'), width: n('width'), height: n('height') }
}

export async function loadDocAssets(studio: Studio, doc: StudioDoc): Promise<void> {
  const ids = doc.layers.flatMap((l) => (l.kind === 'image' ? [l.asset, ...(l.mask ? [l.mask] : [])] : []))
  await Promise.all(ids.map((id) => studio.assets.load(id)))
}

async function picture(c: HTMLCanvasElement, text: string): Promise<ToolReply> {
  return { text, image: { data: toBase64(await encode(c, 'image/jpeg', 0.9)), mime: 'image/jpeg' } }
}

function drawOutlines(c: HTMLCanvasElement, doc: StudioDoc): void {
  const g = ctx2d(c)
  g.font = '600 15px "Segoe UI"'
  g.textBaseline = 'top'
  for (const l of doc.layers) {
    if (!l.visible) continue
    g.save()
    g.translate(l.x + l.width / 2, l.y + l.height / 2)
    g.rotate((l.rotation * Math.PI) / 180)
    g.strokeStyle = '#00e5ff'
    g.lineWidth = 2
    g.setLineDash([6, 4])
    g.strokeRect(-l.width / 2, -l.height / 2, l.width, l.height)
    g.setLineDash([])
    const tag = `${l.id} ${l.name}`.slice(0, 32)
    g.fillStyle = 'rgba(0,0,0,0.75)'
    g.fillRect(-l.width / 2, -l.height / 2, g.measureText(tag).width + 8, 20)
    g.fillStyle = '#00e5ff'
    g.fillText(tag, -l.width / 2 + 4, -l.height / 2 + 2)
    g.restore()
  }
}

async function viewCanvas(studio: Studio, variantId: string, args: Args): Promise<Outcome> {
  const doc = studio.doc(variantId)
  await loadDocAssets(studio, doc)
  const only = typeof args.layer_id === 'string' ? findLayer(doc, args.layer_id).id : null
  let out = renderDoc(doc, studio.assets, only)
  if (args.outlines) drawOutlines(out, doc)
  const region = box(args.region)
  if (region) {
    const w = Math.max(8, region.width)
    const h = Math.max(8, region.height)
    const zoom = Math.min(doc.width / w, doc.height / h)
    const crop = canvas(w * zoom, h * zoom)
    const g = ctx2d(crop)
    g.imageSmoothingQuality = 'high'
    g.drawImage(out, region.x, region.y, w, h, 0, 0, crop.width, crop.height)
    out = crop
  }
  const what = only ? `layer ${only} alone` : region ? `region ${json(region)}` : `the full ${doc.width}x${doc.height} canvas`
  return { reply: await picture(out, `Render of ${what}.`), summary: only ? 'Looked at one layer' : 'Looked at the canvas' }
}

function patchSummary(l: Layer, ignored: string[]): ToolReply {
  const note = ignored.length ? ` Ignored (not valid for a ${l.kind} layer): ${ignored.join(', ')}.` : ''
  return { text: `Updated ${l.id}: ${json(describeLayer(l))}${note}` }
}

export async function executeTool(studio: Studio, v: string, name: string, args: Args): Promise<Outcome> {
  switch (name) {
    case 'get_document': {
      const doc = studio.doc(v)
      const assets = studio.state.assets
        .filter((a) => a.source === 'upload' || a.source === 'generated')
        .map(({ id, label, w, h, source }) => ({ id, label, width: w, height: h, source }))
      return {
        reply: {
          text: json({
            canvas: { width: doc.width, height: doc.height, background: doc.background },
            layers_top_to_bottom: [...doc.layers].reverse().map(describeLayer),
            assets
          })
        },
        summary: 'Read the canvas'
      }
    }

    case 'list_fonts': {
      const needle = typeof args.search === 'string' ? args.search.trim().toLowerCase() : ''
      const list = fontFamilies()
        .filter((f) => !needle || f.name.toLowerCase().includes(needle))
        .map((f) => `${f.name}${f.bundled ? ' (bundled)' : ''}: ${f.weights.join('/')}`)
      return {
        reply: { text: list.length ? list.join('\n') : 'No installed font matches "' + needle + '".' },
        summary: needle ? `Looked for fonts like "${needle}"` : 'Listed the installed fonts'
      }
    }

    case 'view_canvas':
      return viewCanvas(studio, v, args)

    case 'view_asset': {
      const info = studio.assets.info(str(args, 'asset_id'))
      const px = await studio.assets.get(info.id)
      return { reply: await picture(copyOf(px, 1280), `${info.id}: ${info.label}, ${info.w}x${info.h}`), summary: `Looked at ${info.label}` }
    }

    case 'add_image': {
      const info = studio.assets.info(str(args, 'asset_id'))
      const fit = args.fit === 'cover' ? 'cover' : 'contain'
      const placed = placeAsset(studio, v, info, fit, true)
      const extra = props(args)
      if (Object.keys(extra).length) studio.patch(v, placed.id, extra, undefined, true)
      if (typeof args.below_layer_id === 'string') studio.arrange(v, placed.id, studio.doc(v).layers.findIndex((l) => l.id === args.below_layer_id))
      const layer = findLayer(studio.doc(v), placed.id)
      return { reply: { text: `Added image layer ${layer.id}: ${json(describeLayer(layer))}` }, summary: `Placed ${info.label}` }
    }

    case 'add_text': {
      const base = makeText(studio.doc(v), str(args, 'text'))
      const { layer, ignored } = patchLayer(base, props(args))
      if (!('x' in args) && !('y' in args)) {
        layer.x = (studio.doc(v).width - layer.width) / 2
        layer.y = (studio.doc(v).height - layer.height) / 2
      }
      studio.addLayer(v, layer, typeof args.below_layer_id === 'string' ? args.below_layer_id : null, true)
      return { reply: patchSummary(layer, ignored), summary: `Added text ${label(layer)}` }
    }

    case 'add_shape': {
      const kind = args.shape === 'ellipse' || args.shape === 'polygon' ? args.shape : 'rect'
      const { layer, ignored } = patchLayer(makeShape(studio.doc(v), kind), props(args))
      studio.addLayer(v, layer, typeof args.below_layer_id === 'string' ? args.below_layer_id : null, true)
      return { reply: patchSummary(layer, ignored), summary: `Added ${kind === 'polygon' ? 'a shape' : 'an ' + kind}` }
    }

    case 'update_layer': {
      const id = str(args, 'layer_id')
      const { layer, ignored } = studio.patch(v, id, props(args), undefined, true)
      const keys = Object.keys(props(args)).filter((k) => !ignored.includes(k))
      return { reply: patchSummary(layer, ignored), summary: `Changed ${label(layer)} · ${keys.join(', ') || 'nothing'}` }
    }

    case 'arrange_layer': {
      const id = str(args, 'layer_id')
      const to = ['top', 'bottom', 'up', 'down'].includes(String(args.to)) ? (args.to as 'top') : 'top'
      studio.arrange(v, id, to, true)
      const order = [...studio.doc(v).layers].reverse().map((l) => l.id)
      return { reply: { text: 'Stack now (top to bottom): ' + order.join(', ') }, summary: `Moved ${label(findLayer(studio.doc(v), id))} ${to}` }
    }

    case 'duplicate_layer': {
      const layer = studio.duplicate(v, str(args, 'layer_id'), true)
      return { reply: { text: `Duplicated as ${layer.id}: ${json(describeLayer(layer))}` }, summary: `Duplicated ${label(layer)}` }
    }

    case 'delete_layer': {
      const layer = findLayer(studio.doc(v), str(args, 'layer_id'))
      studio.remove(v, layer.id)
      return { reply: { text: `Deleted ${layer.id}.` }, summary: `Deleted ${label(layer)}` }
    }

    case 'set_background': {
      studio.setBackground(v, asColor(args.color, 'color'))
      return { reply: { text: 'Background set to ' + args.color }, summary: 'Set the background colour' }
    }

    case 'cut_out': {
      const id = str(args, 'layer_id')
      const subject = typeof args.subject === 'string' ? args.subject : undefined
      const cost = await cutOut(studio, v, id, subject, box(args.box))
      return {
        reply: { text: `Cut-out mask written on ${id}. Check the edges with view_canvas (try layer_id or a zoomed region) and fix them with edit_mask.` },
        summary: `Cut out ${subject ?? 'the subject'}${money(cost)}`
      }
    }

    case 'edit_mask': {
      const id = str(args, 'layer_id')
      const action = str(args, 'action')
      const points = Array.isArray(args.points) ? (args.points as Pt[]) : []
      await editMask(studio, v, id, action, points, Number(args.radius) || 20)
      return { reply: { text: `Mask on ${id}: ${action} done.` }, summary: `Mask · ${action.replace('_', ' ')}` }
    }

    case 'generate_image': {
      const prompt = str(args, 'prompt')
      const refs = Array.isArray(args.reference_asset_ids) ? args.reference_asset_ids.map(String) : []
      const aspect = typeof args.aspect_ratio === 'string' ? args.aspect_ratio : '16:9'
      const { info, cost } = await generateAsset(studio, prompt, refs, aspect)
      let text = `Generated asset ${info.id} (${info.w}x${info.h}).`
      if (args.place) {
        const layer = placeAsset(studio, v, info, 'contain', true)
        text += ` Placed as layer ${layer.id}.`
        if (args.cut_out) {
          await cutOut(studio, v, layer.id)
          text += ' Subject cut out.'
        }
      }
      return { reply: { text }, summary: `Generated "${prompt.slice(0, 40)}"${money(cost)}` }
    }

    case 'generative_fill': {
      const region = box(args.region)
      if (!region) throw new Error('region is required')
      const prompt = str(args, 'prompt')
      const { layer, cost } = await generativeFill(studio, v, prompt, region, true)
      return {
        reply: { text: `Fill landed as layer ${layer.id}: ${json(describeLayer(layer))}` },
        summary: `Generative fill "${prompt.slice(0, 40)}"${money(cost)}`
      }
    }

    case 'undo':
      return {
        reply: { text: studio.undo(v) ? 'Undone.' : 'Nothing to undo.' },
        summary: 'Undid the last change'
      }

    default:
      throw new Error('Unknown tool ' + name)
  }
}
