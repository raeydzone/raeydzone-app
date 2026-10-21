import type { TextLayer, TextStyle } from '@shared/studio'
import { canvas, ctx2d } from './assets'
import { nearestWeight } from './fonts'

type TextProps = Pick<
  TextLayer,
  | 'text' | 'font' | 'size' | 'weight' | 'italic' | 'uppercase' | 'letterSpacing' | 'lineHeight'
  | 'wrap' | 'fit' | 'arc' | 'styles'
>

// One run is a stretch of characters that look the same: same font, size, fill and lift.
interface Run {
  text: string
  font: string
  size: number
  fill: string | null
  highlight: boolean
  rise: number
  width: number
  ascent: number
  descent: number
}

interface Line {
  runs: Run[]
  width: number
  height: number
  ascent: number
  descent: number
}

interface Look {
  font: string
  size: number
  fill: string | null
  highlight: boolean
  rise: number
}

const scratch = document.createElement('canvas').getContext('2d')!

export function fontString(l: Pick<TextLayer, 'italic' | 'weight' | 'size' | 'font'>): string {
  const weight = nearestWeight(l.font, l.weight)
  return `${l.italic ? 'italic ' : ''}${weight} ${l.size}px "${l.font}"`
}

function lookAt(l: TextProps, i: number, highlight: boolean, k: number): Look {
  const s: TextStyle = {} as TextStyle
  for (const st of l.styles) if (i >= st.start && i < st.end) Object.assign(s, st)
  const size = l.size * k * (s.scale ?? 1)
  const font = fontString({
    font: s.font ?? l.font,
    weight: s.weight ?? l.weight,
    italic: s.italic ?? l.italic,
    size
  })
  return { font, size, fill: s.fill ?? null, highlight, rise: (s.rise ?? 0) * k }
}

const same = (a: Look, b: Look): boolean =>
  a.font === b.font && a.fill === b.fill && a.highlight === b.highlight && a.rise === b.rise

function measure(ctx: CanvasRenderingContext2D, l: TextProps, run: Omit<Run, 'width' | 'ascent' | 'descent'>): Run {
  ctx.font = run.font
  ctx.letterSpacing = `${l.letterSpacing}px`
  const m = ctx.measureText(run.text)
  const probe = ctx.measureText(run.text.trim() || 'Hg')
  return { ...run, width: m.width, ascent: probe.actualBoundingBoxAscent, descent: probe.actualBoundingBoxDescent }
}

// Paragraphs of words, each word a list of runs. A '*' toggles the highlight and is not
// drawn; styles index the stored text, asterisks included, so offsets stay stable.
function words(ctx: CanvasRenderingContext2D, l: TextProps, k: number): Run[][][] {
  const paragraphs: Run[][][] = [[]]
  let word: Run[] = []
  let highlight = false
  const flush = (): void => {
    if (word.length) paragraphs[paragraphs.length - 1].push(word)
    word = []
  }
  for (let i = 0; i < l.text.length; i++) {
    const ch = l.text[i]
    if (ch === '*') {
      highlight = !highlight
      continue
    }
    if (ch === '\n') {
      flush()
      paragraphs.push([])
      continue
    }
    const look = lookAt(l, i, highlight, k)
    const text = l.uppercase ? ch.toUpperCase() : ch
    const last = word[word.length - 1]
    if (last && same(last, look)) last.text += text
    else word.push({ ...look, text, width: 0, ascent: 0, descent: 0 })
    if (ch === ' ') flush()
  }
  flush()
  return paragraphs.map((p) => p.map((w) => w.map((r) => measure(ctx, l, r))))
}

function lineOf(runs: Run[], l: TextProps, k: number): Line {
  const trimmed = runs.length ? [...runs] : []
  const tail = trimmed[trimmed.length - 1]
  if (tail && tail.text.endsWith(' ')) {
    const text = tail.text.replace(/ +$/, '')
    trimmed[trimmed.length - 1] = { ...tail, text, width: tail.width * (text.length / Math.max(1, tail.text.length)) }
  }
  const size = Math.max(l.size * k, ...trimmed.map((r) => r.size))
  return {
    runs: trimmed,
    width: trimmed.reduce((n, r) => n + r.width, 0),
    height: size * l.lineHeight,
    ascent: Math.max(size * 0.7, ...trimmed.map((r) => r.ascent + r.rise)),
    descent: Math.max(0, ...trimmed.map((r) => r.descent - r.rise))
  }
}

function breakLines(paragraphs: Run[][][], l: TextProps, k: number, wrap: number): Line[] {
  const lines: Line[] = []
  for (const para of paragraphs) {
    let current: Run[] = []
    let width = 0
    for (const word of para) {
      const w = word.reduce((n, r) => n + r.width, 0)
      const spare = word[word.length - 1]?.text.endsWith(' ') ? word[word.length - 1].width / word[word.length - 1].text.length : 0
      if (current.length && width + w - spare > wrap) {
        lines.push(lineOf(current, l, k))
        current = []
        width = 0
      }
      current.push(...word)
      width += w
    }
    lines.push(lineOf(current, l, k))
  }
  return lines
}

// Shrink-to-fit scales the whole block until its widest paragraph sits on one line inside
// the wrap width; two passes settle the letter spacing, which does not scale with the size.
function layout(ctx: CanvasRenderingContext2D, l: TextProps): { lines: Line[]; k: number } {
  let k = 1
  if (l.fit && l.wrap) {
    for (let pass = 0; pass < 2; pass++) {
      const natural = breakLines(words(ctx, l, k), l, k, Infinity)
      const widest = Math.max(1, ...natural.map((line) => line.width))
      if (widest <= l.wrap) break
      k *= l.wrap / widest
    }
    return { lines: breakLines(words(ctx, l, k), l, k, Infinity), k }
  }
  return { lines: breakLines(words(ctx, l, k), l, k, l.wrap ?? Infinity), k }
}

interface Glyph {
  ch: string
  run: Run
  x: number
  y: number
  angle: number
  advance: number
}

// Text on an arc: the widest line spans `arc` degrees, every line shares the centre, and
// each glyph stands upright on the curve. Positive arcs bow upwards like a rainbow.
function arcGlyphs(ctx: CanvasRenderingContext2D, lines: Line[], l: TextProps): Glyph[] {
  const sweep = (Math.abs(l.arc) * Math.PI) / 180
  const sign = l.arc > 0 ? 1 : -1
  const widest = Math.max(1, ...lines.map((line) => line.width))
  const radius = widest / sweep
  const glyphs: Glyph[] = []
  let depth = 0
  for (const line of lines) {
    const r = Math.max(1, radius - sign * depth)
    let x = -line.width / 2
    for (const run of line.runs) {
      ctx.font = run.font
      ctx.letterSpacing = '0px'
      for (const ch of run.text) {
        const advance = ctx.measureText(ch).width + l.letterSpacing
        const phi = (x + advance / 2) / r
        const rr = r + run.rise * sign
        glyphs.push({ ch, run, x: rr * Math.sin(phi), y: -sign * rr * Math.cos(phi), angle: sign * phi, advance })
        x += advance
      }
    }
    depth += line.height
  }
  return glyphs
}

function arcBounds(glyphs: Glyph[]): { x: number; y: number; width: number; height: number } {
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  for (const g of glyphs) {
    const cos = Math.cos(g.angle)
    const sin = Math.sin(g.angle)
    for (const [px, py] of [[-g.advance / 2, -g.run.size * 0.8], [g.advance / 2, -g.run.size * 0.8], [g.advance / 2, g.run.size * 0.25], [-g.advance / 2, g.run.size * 0.25]]) {
      const x = g.x + px * cos - py * sin
      const y = g.y + px * sin + py * cos
      x0 = Math.min(x0, x)
      y0 = Math.min(y0, y)
      x1 = Math.max(x1, x)
      y1 = Math.max(y1, y)
    }
  }
  return glyphs.length ? { x: x0, y: y0, width: x1 - x0, height: y1 - y0 } : { x: 0, y: 0, width: 1, height: 1 }
}

export function measureText(l: TextProps): { width: number; height: number } {
  const { lines, k } = layout(scratch, l)
  if (l.arc) {
    const b = arcBounds(arcGlyphs(scratch, lines, l))
    return { width: Math.ceil(b.width), height: Math.ceil(b.height) }
  }
  const widest = Math.max(1, ...lines.map((line) => line.width))
  return {
    width: Math.ceil(l.wrap && !l.fit ? l.wrap : widest + l.size * k * 0.04),
    height: Math.ceil(Math.max(1, lines.reduce((n, line) => n + line.height, 0)))
  }
}

function fillOf(run: Run, l: TextLayer, paint: string | CanvasGradient): string | CanvasGradient {
  return run.fill ?? (run.highlight ? l.highlight : paint)
}

function drawArc(
  ctx: CanvasRenderingContext2D,
  l: TextLayer,
  lines: Line[],
  offsetX: number,
  offsetY: number,
  paint: string | CanvasGradient
): void {
  const glyphs = arcGlyphs(ctx, lines, l)
  const b = arcBounds(glyphs)
  // A gradient must run across the whole word, not restart on every rotated glyph, so the
  // gradient-filled glyphs are stencilled first and the gradient laid over them in one pass.
  const stencil = typeof paint === 'string' ? null : canvas(ctx.canvas.width, ctx.canvas.height)
  for (const g of glyphs) {
    const fill = fillOf(g.run, l, paint)
    const target = stencil && fill === paint ? ctx2d(stencil) : ctx
    target.save()
    target.setTransform(ctx.getTransform())
    target.translate(offsetX + g.x - b.x, offsetY + g.y - b.y)
    target.rotate(g.angle)
    target.font = g.run.font
    target.letterSpacing = '0px'
    target.textBaseline = 'alphabetic'
    target.textAlign = 'center'
    target.fillStyle = target === ctx ? fill : '#fff'
    target.fillText(g.ch, 0, 0)
    target.restore()
  }
  if (stencil) {
    const sg = ctx2d(stencil)
    sg.globalCompositeOperation = 'source-in'
    sg.setTransform(ctx.getTransform())
    sg.fillStyle = paint
    sg.fillRect(offsetX, offsetY, l.width, l.height)
    ctx.save()
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.drawImage(stencil, 0, 0)
    ctx.restore()
  }
}

export function drawText(
  ctx: CanvasRenderingContext2D,
  l: TextLayer,
  offsetX: number,
  offsetY: number,
  paint: string | CanvasGradient = l.fill
): void {
  const { lines } = layout(ctx, l)
  if (l.arc) return drawArc(ctx, l, lines, offsetX, offsetY, paint)
  ctx.textBaseline = 'alphabetic'
  ctx.textAlign = 'left'
  ctx.letterSpacing = `${l.letterSpacing}px`
  const pad = l.size * 0.02
  let top = offsetY
  for (const line of lines) {
    const room = l.width - pad * 2
    let x = offsetX + pad
    if (l.align === 'center') x += (room - line.width) / 2
    else if (l.align === 'right') x += room - line.width
    const baseline = top + line.height / 2 + (line.ascent - line.descent) / 2
    for (const run of line.runs) {
      ctx.font = run.font
      ctx.fillStyle = fillOf(run, l, paint)
      ctx.fillText(run.text, x, baseline - run.rise)
      x += run.width
    }
    top += line.height
  }
}
