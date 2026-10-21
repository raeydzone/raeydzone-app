import { canvas, ctx2d } from './assets'

export function colorize(src: HTMLCanvasElement, color: string): HTMLCanvasElement {
  const out = canvas(src.width, src.height)
  const g = ctx2d(out)
  g.drawImage(src, 0, 0)
  g.globalCompositeOperation = 'source-in'
  g.fillStyle = color
  g.fillRect(0, 0, out.width, out.height)
  return out
}

export function dilate(src: HTMLCanvasElement, radius: number): HTMLCanvasElement {
  const out = canvas(src.width, src.height)
  const g = ctx2d(out)
  const rings = radius > 6 ? [radius, radius * 0.66, radius * 0.33] : [radius]
  for (const r of rings) {
    const steps = Math.min(72, Math.max(12, Math.ceil((Math.PI * 2 * r) / 2)))
    for (let i = 0; i < steps; i++) {
      const a = (i / steps) * Math.PI * 2
      g.drawImage(src, Math.cos(a) * r, Math.sin(a) * r)
    }
  }
  g.drawImage(src, 0, 0)
  return out
}

export function invertAlpha(src: HTMLCanvasElement): HTMLCanvasElement {
  const out = canvas(src.width, src.height)
  const g = ctx2d(out)
  g.fillStyle = '#fff'
  g.fillRect(0, 0, out.width, out.height)
  g.globalCompositeOperation = 'destination-out'
  g.drawImage(src, 0, 0)
  return out
}

// Grown inwards: invert, dilate the hole, invert back.
export function erode(src: HTMLCanvasElement, radius: number): HTMLCanvasElement {
  return invertAlpha(dilate(invertAlpha(src), radius))
}

export function softened(src: HTMLCanvasElement, px: number): HTMLCanvasElement {
  const out = canvas(src.width, src.height)
  const g = ctx2d(out)
  g.filter = `blur(${px / 2}px)`
  g.drawImage(src, 0, 0)
  return out
}

export function subtract(from: HTMLCanvasElement, what: HTMLCanvasElement): HTMLCanvasElement {
  const out = canvas(from.width, from.height)
  const g = ctx2d(out)
  g.drawImage(from, 0, 0)
  g.globalCompositeOperation = 'destination-out'
  g.drawImage(what, 0, 0)
  return out
}

export function intersect(a: HTMLCanvasElement, b: HTMLCanvasElement): HTMLCanvasElement {
  const out = canvas(a.width, a.height)
  const g = ctx2d(out)
  g.drawImage(a, 0, 0)
  g.globalCompositeOperation = 'destination-in'
  g.drawImage(b, 0, 0)
  return out
}

export function union(a: HTMLCanvasElement, b: HTMLCanvasElement): HTMLCanvasElement {
  const out = canvas(a.width, a.height)
  const g = ctx2d(out)
  g.drawImage(a, 0, 0)
  g.drawImage(b, 0, 0)
  return out
}

function mapAlpha(src: HTMLCanvasElement, fn: (a: number, i: number, d: Uint8ClampedArray) => number): HTMLCanvasElement {
  const out = canvas(src.width, src.height)
  const g = ctx2d(out)
  g.drawImage(src, 0, 0)
  const img = g.getImageData(0, 0, out.width, out.height)
  const d = img.data
  for (let i = 0; i < d.length; i += 4) {
    const a = fn(d[i + 3], i, d)
    d[i] = d[i + 1] = d[i + 2] = 255
    d[i + 3] = a
  }
  g.putImageData(img, 0, 0)
  return out
}

export function lumaToAlpha(src: HTMLCanvasElement): HTMLCanvasElement {
  return mapAlpha(src, (a, i, d) => Math.round(a * ((0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) / 255)))
}

// Pulls a soft edge towards hard: 0 leaves it, 1 snaps it to a clean cut at half coverage.
export function steepen(src: HTMLCanvasElement, amount: number): HTMLCanvasElement {
  const k = 1 + amount * 12
  return mapAlpha(src, (a) => Math.max(0, Math.min(255, Math.round((a - 128) * k + 128))))
}

// Blurring then re-hardening rounds off jagged lasso corners and pixel stair-steps.
export function smoothEdge(src: HTMLCanvasElement, px: number): HTMLCanvasElement {
  return steepen(softened(src, px), 0.5)
}

export function isEmpty(src: HTMLCanvasElement): boolean {
  const d = ctx2d(src).getImageData(0, 0, src.width, src.height).data
  for (let i = 3; i < d.length; i += 4) if (d[i] > 8) return false
  return true
}

export function boundsOfAlpha(src: HTMLCanvasElement): { x: number; y: number; width: number; height: number } | null {
  const { width, height } = src
  const d = ctx2d(src).getImageData(0, 0, width, height).data
  let x0 = width
  let y0 = height
  let x1 = -1
  let y1 = -1
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (d[(y * width + x) * 4 + 3] <= 8) continue
      if (x < x0) x0 = x
      if (x > x1) x1 = x
      if (y < y0) y0 = y
      if (y > y1) y1 = y
    }
  }
  return x1 < 0 ? null : { x: x0, y: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 }
}
