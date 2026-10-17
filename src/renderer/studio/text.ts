import type { TextLayer } from '@shared/studio'
import { nearestWeight } from './fonts'

interface Run {
  text: string
  highlight: boolean
  width: number
}

interface Line {
  runs: Run[]
  width: number
  ascent: number
  descent: number
}

type TextProps = Pick<
  TextLayer,
  'text' | 'font' | 'size' | 'weight' | 'italic' | 'uppercase' | 'letterSpacing' | 'lineHeight'
>

const scratch = document.createElement('canvas').getContext('2d')!

export function fontString(l: Pick<TextLayer, 'italic' | 'weight' | 'size' | 'font'>): string {
  const weight = nearestWeight(l.font, l.weight)
  return `${l.italic ? 'italic ' : ''}${weight} ${l.size}px "${l.font}"`
}

function prepare(ctx: CanvasRenderingContext2D, l: TextProps): void {
  ctx.font = fontString(l)
  ctx.letterSpacing = `${l.letterSpacing}px`
  ctx.textBaseline = 'alphabetic'
  ctx.textAlign = 'left'
}

function splitRuns(line: string): { text: string; highlight: boolean }[] {
  const out: { text: string; highlight: boolean }[] = []
  line.split('*').forEach((text, i) => {
    if (text) out.push({ text, highlight: i % 2 === 1 })
  })
  return out
}

function layout(ctx: CanvasRenderingContext2D, l: TextProps): Line[] {
  prepare(ctx, l)
  const source = l.uppercase ? l.text.toUpperCase() : l.text
  return source.split('\n').map((raw) => {
    const runs = splitRuns(raw).map((r) => ({ ...r, width: ctx.measureText(r.text).width }))
    const plain = raw.replace(/\*/g, '') || 'Hg'
    const m = ctx.measureText(plain)
    return {
      runs,
      width: runs.reduce((sum, r) => sum + r.width, 0),
      ascent: m.actualBoundingBoxAscent,
      descent: m.actualBoundingBoxDescent
    }
  })
}

export function measureText(l: TextProps): { width: number; height: number } {
  const lines = layout(scratch, l)
  const width = Math.max(1, ...lines.map((line) => line.width))
  return {
    width: Math.ceil(width + l.size * 0.04),
    height: Math.ceil(Math.max(1, lines.length * l.size * l.lineHeight))
  }
}

export function drawText(ctx: CanvasRenderingContext2D, l: TextLayer, offsetX: number, offsetY: number): void {
  const lines = layout(ctx, l)
  const lh = l.size * l.lineHeight
  const pad = l.size * 0.02
  lines.forEach((line, i) => {
    const room = l.width - pad * 2
    let x = offsetX + pad
    if (l.align === 'center') x += (room - line.width) / 2
    else if (l.align === 'right') x += room - line.width
    const baseline = offsetY + i * lh + lh / 2 + (line.ascent - line.descent) / 2
    for (const run of line.runs) {
      ctx.fillStyle = run.highlight ? l.highlight : l.fill
      ctx.fillText(run.text, x, baseline)
      x += run.width
    }
  })
}
