import { canvas, ctx2d } from './assets'

type Rgb = [number, number, number]

const dist = (a: Rgb, b: Rgb): number => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2
const hex = (c: Rgb): string => '#' + c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')

// Seeds are picked farthest-first, so a small but striking accent — a red eye, a neon
// sign — gets its own colour instead of being averaged into the background.
export function extractPalette(src: HTMLCanvasElement, k = 6): string[] {
  const w = 96
  const h = Math.max(1, Math.round((w * src.height) / src.width))
  const small = canvas(w, h)
  const g = ctx2d(small)
  g.drawImage(src, 0, 0, w, h)
  const d = g.getImageData(0, 0, w, h).data
  const px: Rgb[] = []
  for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 128) px.push([d[i], d[i + 1], d[i + 2]])
  if (!px.length) return []
  const mean = px.reduce<Rgb>((a, p) => [a[0] + p[0] / px.length, a[1] + p[1] / px.length, a[2] + p[2] / px.length], [0, 0, 0])
  const seeds: Rgb[] = [px.reduce((best, p) => (dist(p, mean) < dist(best, mean) ? p : best))]
  while (seeds.length < Math.min(k, px.length)) {
    let far = px[0]
    let gap = -1
    for (const p of px) {
      const near = Math.min(...seeds.map((s) => dist(p, s)))
      if (near > gap) [far, gap] = [p, near]
    }
    if (gap <= 0) break
    seeds.push(far)
  }
  let counts: number[] = []
  for (let round = 0; round < 10; round++) {
    const sums = seeds.map(() => [0, 0, 0])
    counts = seeds.map(() => 0)
    for (const p of px) {
      let best = 0
      for (let i = 1; i < seeds.length; i++) if (dist(p, seeds[i]) < dist(p, seeds[best])) best = i
      sums[best][0] += p[0]
      sums[best][1] += p[1]
      sums[best][2] += p[2]
      counts[best]++
    }
    seeds.forEach((s, i) => {
      if (counts[i]) seeds[i] = [sums[i][0] / counts[i], sums[i][1] / counts[i], sums[i][2] / counts[i]]
    })
  }
  const order = seeds.map((s, i) => ({ s, n: counts[i] })).filter((c) => c.n > 0).sort((a, b) => b.n - a.n)
  const kept: Rgb[] = []
  for (const { s } of order) if (kept.every((x) => dist(x, s) > 600)) kept.push(s)
  return kept.map(hex)
}
