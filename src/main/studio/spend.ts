import { dayKey } from '@shared/format'
import { imageModel } from '@shared/studio'
import type { ImageTask, SpendSummary } from '@shared/studio'
import { jsonStore } from './store'

interface Entry {
  at: string
  model: string
  task: ImageTask
  project: string
  cost: number | null
  ms?: number
}

interface Turn {
  at: string
  project: string
  ms: number
}

interface Ledger {
  entries: Entry[]
  turns?: Turn[]
}

const ledger = jsonStore<Ledger>('studio-spend.json', () => ({ entries: [], turns: [] }))

export async function record(entry: Omit<Entry, 'at'>): Promise<void> {
  await ledger.update((l) => ({
    ...l,
    entries: [...l.entries, { ...entry, at: new Date().toISOString() }]
  }))
}

// Claude costs nothing on a subscription, so its turns are kept for their duration alone.
export async function recordTurn(project: string, ms: number): Promise<void> {
  await ledger.update((l) => ({
    ...l,
    turns: [...(l.turns ?? []), { at: new Date().toISOString(), project, ms }]
  }))
}

// A project id scopes every figure to that thumbnail's studio; null covers the whole ledger.
export async function summary(projectId: string | null): Promise<SpendSummary> {
  const stored = await ledger.read()
  const mine = (row: { project: string }): boolean => projectId === null || row.project === projectId
  const entries = stored.entries.filter(mine)
  const turns = (stored.turns ?? []).filter(mine)
  const today = dayKey(new Date())
  const month = today.slice(0, 7)
  const out: SpendSummary = {
    total: 0, today: 0, month: 0, images: entries.length, unpriced: 0,
    since: entries[0]?.at ?? null, imageMs: 0, claudeMs: 0, turns: turns.length,
    models: [], months: [], tasks: { generate: 0, fill: 0, cutout: 0 }
  }
  for (const t of turns) out.claudeMs += t.ms
  const models = new Map<string, { id: string; label: string; cost: number; images: number; ms: number }>()
  const months = new Map<string, { key: string; cost: number; images: number; ms: number }>()
  for (const e of entries) {
    const cost = e.cost ?? 0
    const day = dayKey(new Date(e.at))
    if (e.cost == null) out.unpriced++
    out.total += cost
    if (day === today) out.today += cost
    if (day.startsWith(month)) out.month += cost
    out.tasks[e.task] = (out.tasks[e.task] ?? 0) + cost
    out.imageMs += e.ms ?? 0
    const m = models.get(e.model) ?? { id: e.model, label: imageModel(e.model).label, cost: 0, images: 0, ms: 0 }
    m.cost += cost
    m.images++
    m.ms += e.ms ?? 0
    models.set(e.model, m)
    const mo = months.get(day.slice(0, 7)) ?? { key: day.slice(0, 7), cost: 0, images: 0, ms: 0 }
    mo.cost += cost
    mo.images++
    mo.ms += e.ms ?? 0
    months.set(mo.key, mo)
  }
  out.models = [...models.values()].sort((a, b) => b.cost - a.cost)
  out.months = [...months.values()].sort((a, b) => b.key.localeCompare(a.key))
  return out
}
