import { DEFAULT_CLAUDE, DEFAULT_IMAGE_MODELS, variantBrief } from '@shared/studio'
import type {
  AssetInfo, ChatImage, ChatItem, ClaudeChoice, ImageModels, ImageTask, Layer, StudioProject, StudioDoc, StudioEvent, StudioFile, ToolCall,
  ToolReply, Variant, VariantStatus
} from '@shared/studio'
import { AssetStore, copyOf, encode } from './assets'
import {
  arrangeLayer, duplicateLayer, emptyDoc, findLayer, insertLayer, patchLayer, refitText,
  removeLayer, replaceLayer
} from './doc'
import type { PatchResult } from './doc'
import { loadFonts } from './fonts'
import { executeTool } from './tools'

export interface VariantState extends Variant {
  status: VariantStatus
  past: StudioDoc[]
  future: StudioDoc[]
  selected: string | null
  picked: string[]
  touched: { id: string; at: number } | null
}

export interface StudioState {
  ready: boolean
  error: string | null
  assets: AssetInfo[]
  variants: VariantState[]
  activeId: string | null
  usage: { fiveHour: number | null; weekly: number | null } | null
  tick: number
  claude: ClaudeChoice
  imageModels: ImageModels
}

interface CommitOptions {
  coalesce?: string
  touched?: string | null
  record?: boolean
}

const HISTORY = 80
const COALESCE_MS = 900
const api = (): typeof window.raeydzone.studio => window.raeydzone.studio
const now = (): string => new Date().toISOString()
const itemId = (): string => Math.random().toString(36).slice(2, 10)

type ChatDraft =
  | Omit<Extract<ChatItem, { kind: 'user' }>, 'id' | 'at'>
  | Omit<Extract<ChatItem, { kind: 'assistant' }>, 'id' | 'at'>
  | Omit<Extract<ChatItem, { kind: 'tool' }>, 'id' | 'at'>
  | Omit<Extract<ChatItem, { kind: 'note' }>, 'id' | 'at'>

export class Studio {
  state: StudioState = {
    ready: false, error: null, assets: [], variants: [], activeId: null, usage: null, tick: 0,
    claude: { ...DEFAULT_CLAUDE }, imageModels: { ...DEFAULT_IMAGE_MODELS }
  }
  assets: AssetStore
  private listeners = new Set<() => void>()
  private saveTimer: ReturnType<typeof setTimeout> | null = null
  private lastRecord: { variantId: string; key: string; at: number } | null = null
  project: StudioProject

  constructor(public projectId: string, project: StudioProject) {
    this.project = project
    this.assets = new AssetStore(projectId, () => this.set({ tick: this.state.tick + 1 }, false))
  }

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  getState = (): StudioState => this.state

  private set(patch: Partial<StudioState>, persist = true): void {
    this.state = { ...this.state, ...patch }
    for (const fn of this.listeners) fn()
    if (persist && this.state.ready) this.scheduleSave()
  }

  private setVariant(id: string, fn: (v: VariantState) => VariantState, persist = true): void {
    this.set({ variants: this.state.variants.map((v) => (v.id === id ? fn(v) : v)) }, persist)
  }

  async load(): Promise<void> {
    try {
      const [file] = await Promise.all([api().load(this.projectId), loadFonts()])
      const claude = { ...DEFAULT_CLAUDE, ...file?.claude }
      const variants = (file?.variants ?? []).map((v) => ({
        ...v,
        claude: { ...claude, ...v.claude },
        doc: { ...v.doc, layers: v.doc.layers.map(refitText) },
        status: 'idle' as VariantStatus,
        past: [],
        future: [],
        selected: null,
        picked: [],
        touched: null
      }))
      const used = new Set(variants.flatMap((v) => v.doc.layers.flatMap((l) => (l.kind === 'image' ? [l.asset, l.mask] : []))))
      const assets = (file?.assets ?? []).filter((a) => a.source === 'upload' || a.source === 'generated' || used.has(a.id))
      this.assets.register(assets)
      this.set(
        {
          ready: true,
          claude,
          imageModels: { ...DEFAULT_IMAGE_MODELS, ...file?.imageModels },
          assets,
          variants,
          activeId: variants.some((v) => v.id === file?.activeId) ? file!.activeId : variants[0]?.id ?? null
        },
        false
      )
      void api().prune(this.projectId, this.referencedFiles()).catch(() => {})
    } catch (err) {
      this.set({ error: (err as Error).message }, false)
    }
  }

  private referencedFiles(): string[] {
    return this.state.assets.map((a) => a.file)
  }

  private scheduleSave(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = setTimeout(() => void this.flush(), 700)
  }

  async flush(): Promise<void> {
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = null
    const file: StudioFile = {
      version: 1,
      assets: this.state.assets,
      activeId: this.state.activeId,
      claude: this.state.claude,
      imageModels: this.state.imageModels,
      variants: this.state.variants.map(({ id, name, createdAt, doc, chat, sessionId, claude }) => ({
        id, name, createdAt, doc, chat: chat.slice(-400), sessionId, claude
      }))
    }
    await api().save(this.projectId, JSON.stringify(file)).catch(() => {})
  }

  has(variantId: string): boolean {
    return this.state.variants.some((v) => v.id === variantId)
  }

  variant(id: string): VariantState {
    const v = this.state.variants.find((x) => x.id === id)
    if (!v) throw new Error('That version no longer exists.')
    return v
  }

  doc(variantId: string): StudioDoc {
    return this.variant(variantId).doc
  }

  commit(variantId: string, next: StudioDoc, opts: CommitOptions = {}): void {
    const at = Date.now()
    const last = this.lastRecord
    const merge =
      !!opts.coalesce && !!last && last.variantId === variantId && last.key === opts.coalesce && at - last.at < COALESCE_MS
    this.lastRecord = { variantId, key: opts.coalesce ?? '', at }
    this.setVariant(variantId, (v) => ({
      ...v,
      doc: next,
      past: opts.record === false || merge ? v.past : [...v.past.slice(-HISTORY + 1), v.doc],
      future: opts.record === false || merge ? v.future : [],
      touched: opts.touched ? { id: opts.touched, at } : v.touched,
      selected: v.selected && next.layers.some((l) => l.id === v.selected) ? v.selected : null,
      picked: v.picked.filter((id) => next.layers.some((l) => l.id === id))
    }))
  }

  update(variantId: string, fn: (doc: StudioDoc) => StudioDoc, opts: CommitOptions = {}): void {
    this.commit(variantId, fn(this.doc(variantId)), opts)
  }

  undo(variantId: string): boolean {
    const v = this.variant(variantId)
    const prev = v.past[v.past.length - 1]
    if (!prev) return false
    this.lastRecord = null
    this.setVariant(variantId, (x) => ({ ...x, doc: prev, past: x.past.slice(0, -1), future: [x.doc, ...x.future] }))
    return true
  }

  redo(variantId: string): boolean {
    const v = this.variant(variantId)
    const next = v.future[0]
    if (!next) return false
    this.lastRecord = null
    this.setVariant(variantId, (x) => ({ ...x, doc: next, past: [...x.past, x.doc], future: x.future.slice(1) }))
    return true
  }

  select(variantId: string, layerId: string | null): void {
    this.pick(variantId, layerId ? [layerId] : [])
  }

  pick(variantId: string, ids: string[], primary: string | null = ids[ids.length - 1] ?? null): void {
    this.setVariant(variantId, (v) => ({ ...v, selected: primary, picked: ids }), false)
  }

  toggle(variantId: string, layerId: string): void {
    const v = this.variant(variantId)
    const ids = this.selection(variantId)
    if (!ids.includes(layerId)) return this.pick(variantId, [...ids, layerId], layerId)
    const rest = ids.filter((id) => id !== layerId)
    this.pick(variantId, rest, v.selected === layerId ? rest[rest.length - 1] ?? null : v.selected)
  }

  selection(variantId: string): string[] {
    const v = this.variant(variantId)
    const ids = new Set([...v.picked, ...(v.selected ? [v.selected] : [])])
    return v.doc.layers.filter((l) => ids.has(l.id)).map((l) => l.id)
  }

  place(variantId: string, positions: Record<string, [number, number]>, coalesce?: string): void {
    this.update(variantId, (d) => ({
      ...d,
      layers: d.layers.map((l) => (positions[l.id] ? { ...l, x: positions[l.id][0], y: positions[l.id][1] } : l))
    }), { coalesce: coalesce ? Object.keys(positions).join() + ':' + coalesce : undefined })
  }

  removeMany(variantId: string, ids: string[]): void {
    this.update(variantId, (d) => ({ ...d, layers: d.layers.filter((l) => !ids.includes(l.id)) }))
  }

  duplicateMany(variantId: string, ids: string[]): void {
    let doc = this.doc(variantId)
    const copies: string[] = []
    for (const id of ids) {
      const out = duplicateLayer(doc, id)
      doc = out.doc
      copies.push(out.layer.id)
    }
    this.commit(variantId, doc)
    this.pick(variantId, copies)
  }

  setActive(id: string | null): void {
    this.set({ activeId: id })
  }

  addLayer(variantId: string, layer: Layer, below?: string | null, touched = false): Layer {
    this.update(variantId, (d) => insertLayer(d, layer, below), { touched: touched ? layer.id : null })
    return layer
  }

  patch(variantId: string, layerId: string, patch: Record<string, unknown>, coalesce?: string, touched = false): PatchResult {
    const result = patchLayer(findLayer(this.doc(variantId), layerId), patch)
    this.update(variantId, (d) => replaceLayer(d, result.layer), {
      coalesce: coalesce ? layerId + ':' + coalesce : undefined,
      touched: touched ? layerId : null
    })
    return result
  }

  arrange(variantId: string, layerId: string, to: 'top' | 'bottom' | 'up' | 'down' | number, touched = false): void {
    this.update(variantId, (d) => arrangeLayer(d, layerId, to), { touched: touched ? layerId : null })
  }

  duplicate(variantId: string, layerId: string, touched = false): Layer {
    const { doc, layer } = duplicateLayer(this.doc(variantId), layerId)
    this.commit(variantId, doc, { touched: touched ? layer.id : null })
    return layer
  }

  remove(variantId: string, layerId: string): void {
    this.update(variantId, (d) => removeLayer(d, layerId))
  }

  setBackground(variantId: string, color: string, coalesce?: string): void {
    this.update(variantId, (d) => ({ ...d, background: color }), { coalesce })
  }

  addAsset(info: AssetInfo): void {
    if (!this.state.assets.some((a) => a.id === info.id)) this.set({ assets: [...this.state.assets, info] })
  }

  async importPaths(paths: string[]): Promise<AssetInfo[]> {
    const imported = await window.raeydzone.studio.importFiles(this.projectId, paths)
    const out: AssetInfo[] = []
    for (const f of imported) {
      const info = await this.assets.addFile(f.file, f.name.replace(/\.[^.]+$/, ''), 'upload')
      this.addAsset(info)
      out.push(info)
    }
    return out
  }

  async pasteClipboard(): Promise<AssetInfo | null> {
    const pasted = await window.raeydzone.studio.paste(this.projectId)
    if (!pasted) return null
    const info = await this.assets.addFile(pasted.file, pasted.name, 'upload')
    this.addAsset(info)
    return info
  }

  addVariant(doc: StudioDoc = emptyDoc(), claude: ClaudeChoice = this.state.claude): VariantState {
    const used = this.state.variants.map((v) => Number(/(\d+)$/.exec(v.name)?.[1] ?? 0))
    const v: VariantState = {
      id: crypto.randomUUID(),
      name: 'Version ' + (Math.max(0, ...used) + 1),
      createdAt: now(),
      doc,
      chat: [],
      sessionId: null,
      claude: { ...claude },
      status: 'idle',
      past: [],
      future: [],
      selected: null,
      picked: [],
      touched: null
    }
    this.set({ variants: [...this.state.variants, v], activeId: v.id })
    return v
  }

  duplicateVariant(id: string): VariantState {
    const source = this.variant(id)
    const copy = this.addVariant(source.doc, source.claude)
    this.setVariant(copy.id, (v) => ({ ...v, name: source.name + ' copy' }))
    return copy
  }

  setClaude(variantId: string | null, patch: Partial<ClaudeChoice>): void {
    if (variantId) this.setVariant(variantId, (v) => ({ ...v, claude: { ...v.claude, ...patch } }))
    else this.set({ claude: { ...this.state.claude, ...patch } })
  }

  setImageModel(task: ImageTask, model: string): void {
    this.set({ imageModels: { ...this.state.imageModels, [task]: model } })
  }

  removeVariant(id: string): void {
    void api().stop(id).catch(() => {})
    const variants = this.state.variants.filter((v) => v.id !== id)
    this.set({
      variants,
      activeId: this.state.activeId === id ? variants[variants.length - 1]?.id ?? null : this.state.activeId
    })
  }

  pushChat(variantId: string, draft: ChatDraft): string {
    const id = itemId()
    this.setVariant(variantId, (v) => ({ ...v, chat: [...v.chat, { ...draft, id, at: now() } as ChatItem] }))
    return id
  }

  patchChat(variantId: string, id: string, patch: Partial<ChatItem>): void {
    this.setVariant(variantId, (v) => ({
      ...v,
      chat: v.chat.map((c) => (c.id === id ? ({ ...c, ...patch } as ChatItem) : c))
    }))
  }

  private async chatImages(assets: AssetInfo[]): Promise<ChatImage[]> {
    const out: ChatImage[] = []
    for (const a of assets) {
      const px = await this.assets.get(a.id)
      out.push({ data: await encode(copyOf(px, 1568), 'image/jpeg', 0.9), mime: 'image/jpeg' })
    }
    return out
  }

  private describeAttachments(assets: AssetInfo[]): string {
    if (!assets.length) return ''
    const list = assets.map((a) => `- ${a.id}: "${a.label}", ${a.w}x${a.h}`).join('\n')
    return `\n\nAttached images, stored as assets you can place with add_image:\n${list}`
  }

  private async dispatch(variantId: string, text: string, attachments: AssetInfo[], images: ChatImage[]): Promise<void> {
    const v = this.variant(variantId)
    this.setVariant(variantId, (x) => ({ ...x, status: 'working' }), false)
    try {
      await api().send({
        projectId: this.projectId,
        variantId,
        text: text + this.describeAttachments(attachments),
        images,
        resume: v.sessionId,
        claude: v.claude
      })
    } catch (err) {
      this.setVariant(variantId, (x) => ({ ...x, status: 'error' }), false)
      this.pushChat(variantId, { kind: 'note', text: (err as Error).message, bad: true })
    }
  }

  async generate(brief: string, attachments: AssetInfo[], count: number): Promise<void> {
    const images = await this.chatImages(attachments)
    const created: VariantState[] = []
    for (let i = 0; i < count; i++) created.push(this.addVariant())
    this.setActive(created[0].id)
    await Promise.all(
      created.map((v, i) => {
        this.pushChat(v.id, { kind: 'user', text: brief, images: attachments.map((a) => a.id) })
        return this.dispatch(v.id, variantBrief(this.project, brief, i + 1, count), attachments, images)
      })
    )
  }

  async message(variantId: string, text: string, attachments: AssetInfo[]): Promise<void> {
    this.pushChat(variantId, { kind: 'user', text, images: attachments.map((a) => a.id) })
    await this.dispatch(variantId, text, attachments, await this.chatImages(attachments))
  }

  stop(variantId: string): void {
    void api().stop(variantId).catch(() => {})
  }

  onEvent(variantId: string, ev: StudioEvent): void {
    if (!this.has(variantId)) return
    if (ev.type === 'text') this.pushChat(variantId, { kind: 'assistant', text: ev.text })
    else if (ev.type === 'session') this.setVariant(variantId, (v) => ({ ...v, sessionId: ev.sessionId }))
    else if (ev.type === 'usage') this.set({ usage: { fiveHour: ev.fiveHour, weekly: ev.weekly } }, false)
    else {
      this.setVariant(variantId, (v) => ({ ...v, status: ev.status }), false)
      if (ev.status === 'error') this.pushChat(variantId, { kind: 'note', text: ev.error ?? 'Claude stopped with an error.', bad: true })
      if (ev.status === 'stopped') this.pushChat(variantId, { kind: 'note', text: 'Stopped.', bad: false })
    }
  }

  async runTool(call: ToolCall): Promise<ToolReply> {
    const id = this.pushChat(call.variantId, {
      kind: 'tool', name: call.name, summary: call.name.replace(/_/g, ' '), status: 'running', detail: null
    })
    try {
      const { reply, summary, cost } = await executeTool(this, call.variantId, call.name, call.args)
      this.patchChat(call.variantId, id, { status: reply.isError ? 'error' : 'done', summary, cost, detail: reply.isError ? reply.text : null })
      return reply
    } catch (err) {
      const text = (err as Error).message
      this.patchChat(call.variantId, id, { status: 'error', detail: text })
      return { text, isError: true }
    }
  }
}

const studios = new Map<string, Studio>()
let wired = false

function owner(variantId: string): Studio | undefined {
  return [...studios.values()].find((s) => s.has(variantId))
}

function wire(): void {
  if (wired) return
  wired = true
  api().onTool(async (call) => {
    const studio = owner(call.variantId)
    const reply = studio
      ? await studio.runTool(call)
      : { text: 'This version is not open in the studio any more.', isError: true }
    await api().toolDone(call.callId, reply).catch(() => {})
  })
  api().onEvent((variantId, event) => owner(variantId)?.onEvent(variantId, event))
}

export function openStudio(project: StudioProject): Studio {
  wire()
  let studio = studios.get(project.id)
  if (!studio) {
    studio = new Studio(project.id, project)
    studios.set(project.id, studio)
    void studio.load()
  }
  studio.project = project
  return studio
}
