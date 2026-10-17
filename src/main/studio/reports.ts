import { randomUUID } from 'node:crypto'
import type { FeatureReport, ReportInput } from '@shared/studio'
import { jsonStore } from './store'

const store = jsonStore<{ reports: FeatureReport[] }>('studio-feedback.json', () => ({ reports: [] }))

const sameGap = (a: string, b: string): boolean =>
  a.trim().toLowerCase().replace(/\s+/g, ' ') === b.trim().toLowerCase().replace(/\s+/g, ' ')

export async function list(): Promise<FeatureReport[]> {
  return (await store.read()).reports
}

// A gap Claude hits again bumps the existing report instead of adding a duplicate, so the
// count shows which missing features actually get in the way most.
export async function add(input: ReportInput): Promise<{ reports: FeatureReport[]; repeat: boolean }> {
  const at = new Date().toISOString()
  let repeat = false
  const { reports } = await store.update(({ reports }) => {
    const hit = reports.find((r) => !r.done && sameGap(r.title, input.title))
    repeat = !!hit
    if (!hit) {
      return { reports: [{ ...input, id: randomUUID(), firstAt: at, lastAt: at, count: 1, done: false }, ...reports] }
    }
    const bumped = { ...hit, ...input, title: hit.title, lastAt: at, count: hit.count + 1 }
    return { reports: [bumped, ...reports.filter((r) => r !== hit)] }
  })
  return { reports, repeat }
}

export async function setDone(id: string, done: boolean): Promise<FeatureReport[]> {
  return (await store.update(({ reports }) => ({ reports: reports.map((r) => (r.id === id ? { ...r, done } : r)) }))).reports
}

export async function remove(id: string): Promise<FeatureReport[]> {
  return (await store.update(({ reports }) => ({ reports: reports.filter((r) => r.id !== id) }))).reports
}
