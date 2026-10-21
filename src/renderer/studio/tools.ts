import type { Layer, StudioDoc, ToolReply, Variant } from '@shared/studio'
import { canvas, ctx2d, copyOf, encode, toBase64 } from './assets'
import { cutOut, editMask, generateAsset, generativeFill, placeAsset } from './ai'
import type { Box } from './ai'
import {
  arrangeGroup, asColor, boundsOf, describeGroups, describeLayer, findGroup, findLayer, groupMembers, makeShape,
  makeText, patchLayer, refitText, scaleLayer
} from './doc'
import type { Studio } from './engine'
import type { Pt } from './mask'
import { fontFamilies } from './fonts'
import { bringAssets, importLayers, openSource } from './library'
import type { Source } from './library'
import { loadDocAssets, renderDoc } from './render'

type Args = Record<string, unknown>

interface Outcome {
  reply: ToolReply
  summary: string
  cost?: number | null
}

const PLACEMENT = new Set(['asset_id', 'fit', 'below_layer_id', 'layer_id'])
const label = (l: Layer): string => (l.kind === 'text' ? `"${l.text.replace(/\*/g, '').slice(0, 30)}"` : l.name)
const json = (value: unknown): string => JSON.stringify(value)

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
  await loadDocAssets(studio.assets, doc)
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

const list = (args: Args, key: string): string[] => (Array.isArray(args[key]) ? (args[key] as unknown[]).map(String) : [])
const round = (n: number): number => Math.round(n * 10) / 10

function versionOf(src: Source, args: Args): Variant {
  const id = typeof args.version_id === 'string' ? args.version_id : src.file.activeId
  const found = src.file.variants.find((x) => x.id === id) ?? (typeof args.version_id === 'string' ? null : src.file.variants[0])
  if (!found) throw new Error('No such version. Call list_projects for version ids.')
  return found
}

function groupReply(studio: Studio, v: string, id: string, text: string): ToolReply {
  const group = describeGroups(studio.doc(v)).find((g) => g.id === id)
  return { text: `${text} ${json(group ?? { id, removed: true })}` }
}

async function listProjects(studio: Studio, v: string, args: Args): Promise<Outcome> {
  const needle = typeof args.search === 'string' ? args.search.trim().toLowerCase() : ''
  const projects = (await window.raeydzone.studio.projects()).filter((p) => !needle || p.name.toLowerCase().includes(needle))
  const rows: unknown[] = []
  for (const p of projects.slice(0, 15)) {
    const src = await openSource(studio, p.id).catch(() => null)
    if (!src) continue
    rows.push({
      project_id: p.id,
      kind: p.kind,
      name: p.name,
      current: p.id === studio.projectId || undefined,
      edited: p.updatedAt,
      versions: src.file.variants.filter((x) => x.id !== v).map((x) => ({
        version_id: x.id,
        name: x.name,
        layers: x.doc.layers.length,
        groups: x.doc.groups.map((g) => g.name),
        last_open: x.id === src.file.activeId || undefined
      }))
    })
  }
  return {
    reply: { text: rows.length ? json(rows) : needle ? `No project matches "${needle}".` : 'There are no other thumbnail studios yet.' },
    summary: needle ? `Looked for projects like "${needle}"` : 'Listed earlier thumbnails'
  }
}

async function browseProject(studio: Studio, args: Args): Promise<Outcome> {
  const src = await openSource(studio, str(args, 'project_id'))
  const version = versionOf(src, args)
  const doc = version.doc
  await loadDocAssets(src.assets, doc)
  const out = renderDoc(doc, src.assets)
  if (args.outlines) drawOutlines(out, doc)
  const layers = [...doc.layers].reverse().map((l) => ({
    id: l.id,
    name: l.name,
    kind: l.kind,
    group: l.group,
    ...(l.kind === 'text' ? { text: l.text } : {}),
    box: { x: round(l.x), y: round(l.y), width: round(l.width), height: round(l.height) }
  }))
  const assets = src.file.assets
    .filter((a) => a.source === 'upload' || a.source === 'generated')
    .map(({ id, label, w, h }) => ({ id, label, width: w, height: h }))
  const text = json({ version: { id: version.id, name: version.name }, layers_top_to_bottom: layers, groups: describeGroups(doc), assets })
  return { reply: await picture(out, text), summary: `Looked at ${version.name} of another thumbnail` }
}

async function importFromProject(studio: Studio, v: string, args: Args): Promise<Outcome> {
  const src = await openSource(studio, str(args, 'project_id'))
  const doc = versionOf(src, args).doc
  const groupIds = list(args, 'group_ids').map((id) => findGroup(doc, id).id)
  const wanted = new Set([
    ...list(args, 'layer_ids').map((id) => findLayer(doc, id).id),
    ...doc.layers.filter((l) => l.group && groupIds.includes(l.group)).map((l) => l.id)
  ])
  const layers = doc.layers
    .filter((l) => wanted.has(l.id))
    .map((l) => (l.group && !groupIds.includes(l.group) ? ({ ...l, group: null } as Layer) : l))
  const assetIds = list(args, 'asset_ids')
  if (!layers.length && !assetIds.length) throw new Error('Pass layer_ids, group_ids or asset_ids to import.')
  const all = [...src.assets.infos.values()]
  const added = layers.length
    ? await importLayers(studio, v, src.projectId, layers, doc.groups.filter((g) => groupIds.includes(g.id)), all)
    : []
  const assets = await bringAssets(studio, src.projectId, assetIds.map((id) => src.assets.info(id)))
  const now = studio.doc(v)
  const groups = describeGroups(now).filter((g) => now.layers.some((l) => added.includes(l.id) && l.group === g.id))
  return {
    reply: {
      text: json({
        layers: added.map((id) => describeLayer(findLayer(now, id))),
        groups,
        assets: [...assets.values()]
      })
    },
    summary: `Imported ${added.length ? added.length + ' layers' : ''}${added.length && assets.size ? ' and ' : ''}${assets.size ? assets.size + ' assets' : ''} from another thumbnail`
  }
}

function updateGroup(studio: Studio, v: string, args: Args): Outcome {
  const id = str(args, 'group_id')
  const group = findGroup(studio.doc(v), id)
  if (typeof args.name === 'string' && args.name.trim()) studio.renameGroup(v, id, args.name.trim())
  let members = groupMembers(studio.doc(v), id)
  const k = args.scale === undefined ? 1 : Number(args.scale)
  if (!Number.isFinite(k) || k <= 0) throw new Error('scale must be a positive number')
  if (k !== 1) {
    const b = boundsOf(members)
    members = members.map((l) => refitText(scaleLayer(l, k, b.x + b.width / 2, b.y + b.height / 2)))
  }
  const b = boundsOf(members)
  const dx = typeof args.x === 'number' ? args.x - b.x : Number(args.dx) || 0
  const dy = typeof args.y === 'number' ? args.y - b.y : Number(args.dy) || 0
  members = members.map((l) => ({
    ...l,
    x: l.x + dx,
    y: l.y + dy,
    ...(typeof args.visible === 'boolean' ? { visible: args.visible } : {}),
    ...(typeof args.locked === 'boolean' ? { locked: args.locked } : {})
  }) as Layer)
  studio.replaceMany(v, members)
  const to = String(args.arrange)
  if (['top', 'bottom', 'up', 'down'].includes(to)) studio.update(v, (d) => arrangeGroup(d, id, to as 'top'))
  return { reply: groupReply(studio, v, id, 'Updated group'), summary: `Changed group ${group.name}` }
}

// patchLayer has no view of the document, so the clip target is checked here.
function checkClip(doc: StudioDoc, args: Args): void {
  const clip = args.clip
  if (!clip || typeof clip !== 'object') return
  const from = (clip as Record<string, unknown>).from
  if (typeof from !== 'string' || !from) return
  if (doc.layers.some((l) => l.id === from) || doc.groups.some((g) => g.id === from)) return
  throw new Error(`clip.from "${from}" is not a layer or group in this document.`)
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
            groups: describeGroups(doc),
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
      checkClip(studio.doc(v), args)
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
      checkClip(studio.doc(v), args)
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
      checkClip(studio.doc(v), args)
      const kind = args.shape === 'ellipse' || args.shape === 'polygon' ? args.shape : 'rect'
      const { layer, ignored } = patchLayer(makeShape(studio.doc(v), kind), props(args))
      studio.addLayer(v, layer, typeof args.below_layer_id === 'string' ? args.below_layer_id : null, true)
      return { reply: patchSummary(layer, ignored), summary: `Added ${kind === 'polygon' ? 'a shape' : 'an ' + kind}` }
    }

    case 'update_layer': {
      checkClip(studio.doc(v), args)
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

    case 'group_layers': {
      const doc = studio.doc(v)
      const ids = list(args, 'layer_ids').map((id) => findLayer(doc, id).id)
      const id = studio.group(v, ids, str(args, 'name'), true)
      return { reply: groupReply(studio, v, id, `Grouped as ${id}:`), summary: `Grouped ${ids.length} layers as ${String(args.name)}` }
    }

    case 'update_group':
      return updateGroup(studio, v, args)

    case 'duplicate_group': {
      const members = groupMembers(studio.doc(v), findGroup(studio.doc(v), str(args, 'group_id')).id)
      const copies = studio.duplicateMany(v, members.map((l) => l.id))
      const dx = Number(args.dx) || 0
      const dy = Number(args.dy) || 0
      if (dx || dy) {
        const now = studio.doc(v).layers.filter((l) => copies.includes(l.id))
        studio.place(v, Object.fromEntries(now.map((l) => [l.id, [l.x + dx, l.y + dy]])))
      }
      const copy = findLayer(studio.doc(v), copies[0]).group ?? ''
      return { reply: groupReply(studio, v, copy, `Duplicated as ${copy}:`), summary: 'Duplicated a group' }
    }

    case 'ungroup': {
      const group = findGroup(studio.doc(v), str(args, 'group_id'))
      studio.ungroup(v, group.id)
      return { reply: { text: `Ungrouped ${group.id}.` }, summary: `Ungrouped ${group.name}` }
    }

    case 'delete_group': {
      const group = findGroup(studio.doc(v), str(args, 'group_id'))
      studio.removeMany(v, groupMembers(studio.doc(v), group.id).map((l) => l.id))
      return { reply: { text: `Deleted group ${group.id} and its layers.` }, summary: `Deleted group ${group.name}` }
    }

    case 'list_projects':
      return listProjects(studio, v, args)

    case 'browse_project':
      return browseProject(studio, args)

    case 'import_from_project':
      return importFromProject(studio, v, args)

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
        summary: `Cut out ${subject ?? 'the subject'}`,
        cost
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
      const { info, cost, transparent, model } = await generateAsset(studio, v, {
        prompt,
        refs: list(args, 'reference_asset_ids'),
        layers: list(args, 'reference_layer_ids'),
        canvas: !!args.reference_canvas,
        aspect: typeof args.aspect_ratio === 'string' ? args.aspect_ratio : undefined,
        transparent: !!args.transparent
      })
      let total = cost
      let text = `${model} generated asset ${info.id} (${info.w}x${info.h})` +
        (args.transparent ? (transparent ? ' with a transparent background.' : '. This model cannot make transparent backgrounds — use cut_out.') : '.')
      if (args.place) {
        const layer = placeAsset(studio, v, info, 'contain', true)
        text += ` Placed as layer ${layer.id}.`
        if (args.cut_out && !transparent) {
          total = (total ?? 0) + ((await cutOut(studio, v, layer.id)) ?? 0)
          text += ' Subject cut out.'
        }
      }
      return { reply: { text }, summary: `Generated "${prompt.slice(0, 40)}" · ${model}`, cost: total }
    }

    case 'generative_fill': {
      const region = box(args.region)
      if (!region) throw new Error('region is required')
      const prompt = str(args, 'prompt')
      const { layer, cost } = await generativeFill(studio, v, prompt, region, true, args.keep_contents === true)
      return {
        reply: { text: `Fill landed as layer ${layer.id}: ${json(describeLayer(layer))}` },
        summary: `Generative fill "${prompt.slice(0, 40)}"`,
        cost
      }
    }

    case 'undo':
      return {
        reply: { text: studio.undo(v) ? 'Undone.' : 'Nothing to undo.' },
        summary: 'Undid the last change'
      }

    case 'report_missing_feature': {
      const title = str(args, 'title').trim()
      const repeat = await window.raeydzone.studio.report({
        kind: args.kind === 'bug' ? 'bug' : 'missing',
        title,
        detail: str(args, 'detail').trim(),
        workaround: typeof args.workaround === 'string' && args.workaround.trim() ? args.workaround.trim() : null,
        project: studio.project.name,
        model: studio.state.variants.find((x) => x.id === v)?.claude.model ?? ''
      })
      return {
        reply: { text: (repeat ? 'Logged — this gap was already reported, so its count went up.' : 'Logged for the developers.') + ' Carry on with the best workaround.' },
        summary: `Flagged for the developers: ${title}`
      }
    }

    default:
      throw new Error('Unknown tool ' + name)
  }
}
