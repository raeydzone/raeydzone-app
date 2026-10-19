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
}

const ledger = jsonStore<{ entries: Entry[] }>('studio-spend.json', () => ({ entries: [] }))

export async function record(entry: Omit<Entry, 'at'>): Promise<void> {
  await ledger.update((l) => ({ entries: [...l.entries, { ...entry, at: new Date().toISOString() }] }))
}

// A project id scopes every figure to that thumbnail's studio; null covers the whole ledger.
export async function summary(projectId: string | null): Promise<SpendSummary> {
  const entries = (await ledger.read()).entries.filter((e) => projectId === null || e.project === projectId)
  const today = dayKey(new Date())
  const month = today.slice(0, 7)
  const out: SpendSummary = {
    total: 0, today: 0, month: 0, images: entries.length, unpriced: 0,
    since: entries[0]?.at ?? null, models: [], months: [], tasks: { generate: 0, fill: 0, cutout: 0 }
  }
  const models = new Map<string, { id: string; label: string; cost: number; images: number }>()
  const months = new Map<string, { key: string; cost: number; images: number }>()
  for (const e of entries) {
    const cost = e.cost ?? 0
    const day = dayKey(new Date(e.at))
    if (e.cost == null) out.unpriced++
    out.total += cost
    if (day === today) out.today += cost
    if (day.startsWith(month)) out.month += cost
    out.tasks[e.task] = (out.tasks[e.task] ?? 0) + cost
    const m = models.get(e.model) ?? { id: e.model, label: imageModel(e.model).label, cost: 0, images: 0 }
    m.cost += cost
    m.images++
    models.set(e.model, m)
    const mo = months.get(day.slice(0, 7)) ?? { key: day.slice(0, 7), cost: 0, images: 0 }
    mo.cost += cost
    mo.images++
    months.set(mo.key, mo)
  }
  out.models = [...models.values()].sort((a, b) => b.cost - a.cost)
  out.months = [...months.values()].sort((a, b) => b.key.localeCompare(a.key))
  return out
}
