import type { StudioDoc } from '@shared/studio'
import { boundsOf } from './doc'
import type { Bounds } from './doc'

export interface SnapLine {
  axis: 'x' | 'y'
  at: number
}

function targets(doc: StudioDoc, skip: Set<string>, axis: 'x' | 'y'): number[] {
  const size = axis === 'x' ? doc.width : doc.height
  const out = [0, size / 2, size, ...doc.guides.filter((g) => g.axis === axis).map((g) => g.at)]
  for (const l of doc.layers) {
    if (!l.visible || skip.has(l.id) || l.kind === 'adjust') continue
    const b = boundsOf([l])
    const [start, len] = axis === 'x' ? [b.x, b.width] : [b.y, b.height]
    out.push(start, start + len / 2, start + len)
  }
  return out
}

function snapAxis(edges: number[], candidates: number[], tol: number): { d: number; hits: number[] } {
  let best = Infinity
  for (const e of edges) {
    for (const c of candidates) if (Math.abs(c - e) <= tol && Math.abs(c - e) < Math.abs(best)) best = c - e
  }
  if (!Number.isFinite(best)) return { d: 0, hits: [] }
  const hits = candidates.filter((c) => edges.some((e) => Math.abs(e + best - c) < 0.5))
  return { d: best, hits: [...new Set(hits)] }
}

// Edges and centres of what is being dragged pull onto the canvas edges and centre, the
// guides, and the edges and centres of every other visible layer.
export function snapMove(doc: StudioDoc, box: Bounds, skip: Set<string>, tol: number): { dx: number; dy: number; lines: SnapLine[] } {
  const x = snapAxis([box.x, box.x + box.width / 2, box.x + box.width], targets(doc, skip, 'x'), tol)
  const y = snapAxis([box.y, box.y + box.height / 2, box.y + box.height], targets(doc, skip, 'y'), tol)
  return {
    dx: x.d,
    dy: y.d,
    lines: [...x.hits.map((at) => ({ axis: 'x' as const, at })), ...y.hits.map((at) => ({ axis: 'y' as const, at }))]
  }
}
