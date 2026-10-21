import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { DragEvent, PointerEvent, ReactNode } from 'react'
import type { Corners, Layer, ShapeLayer } from '@shared/studio'
import { useStore } from '../../state/store'
import { editMask, placeAsset } from '../ai'
import type { Box } from '../ai'
import { boundsOf, makeShape, makeText, patchLayer, refitText, scaleLayer } from '../doc'
import type { Bounds } from '../doc'
import type { Studio, VariantState } from '../engine'
import type { Pt } from '../mask'
import { paint } from '../paint'
import type { PaintMode } from '../paint'
import { drawDoc, hitLayer, renderDoc, toLocal } from '../render'
import { boxSelection, colorSelection, combine, lassoSelection, selectionOverlay } from '../selection'
import type { Combine, SelectShape } from '../selection'
import { forward } from '../warp'
import s from './studio.module.css'

export type Tool =
  | 'move' | 'text' | 'rect' | 'ellipse' | 'pen' | 'lasso' | 'brush' | 'cut' | 'fill'
  | 'select' | 'paint' | 'distort'

export interface ToolOptions {
  brush: number
  maskShow: boolean
  glowPen: boolean
  selectShape: SelectShape
  tolerance: number
  paintMode: PaintMode
  paintColor: string
  paintSize: number
  hardness: number
  paintOpacity: number
  cloneSource: Pt | null
}

export const DEFAULT_OPTIONS: ToolOptions = {
  brush: 24,
  maskShow: false,
  glowPen: true,
  selectShape: 'rect',
  tolerance: 32,
  paintMode: 'brush',
  paintColor: '#ffffff',
  paintSize: 18,
  hardness: 0.7,
  paintOpacity: 1,
  cloneSource: null
}

// Photoshop's modifiers: Shift adds to the selection, Alt takes away, both keep the overlap.
function combineFrom(e: { shiftKey: boolean; altKey: boolean }): Combine {
  if (e.shiftKey && e.altKey) return 'intersect'
  if (e.shiftKey) return 'add'
  if (e.altKey) return 'subtract'
  return 'replace'
}

function cornerPoints(l: Layer): Pt[] {
  const f = forward(l, l.width, l.height)
  const a = rad(l.rotation)
  return ([[0, 0], [1, 0], [1, 1], [0, 1]] as Pt[]).map(([u, v]) => {
    const [x, y] = f(u, v)
    const [rx, ry] = rotate([x - l.width / 2, y - l.height / 2], a)
    return [l.x + l.width / 2 + rx, l.y + l.height / 2 + ry]
  })
}

type Drag =
  | { kind: 'move'; from: Pt; orig: Record<string, Pt> }
  | { kind: 'marquee'; from: Pt; to: Pt; add: boolean }
  | { kind: 'resize'; id: string; hx: number; hy: number; orig: Layer }
  | { kind: 'rotate'; id: string; orig: Layer }
  | { kind: 'scale'; hx: number; hy: number; box: Bounds; orig: Layer[] }
  | { kind: 'anchor'; id: string; index: number; pts: Pt[] }
  | { kind: 'box'; from: Pt; to: Pt; mode: Combine }
  | { kind: 'brush'; id: string; pts: Pt[] }
  | { kind: 'paint'; id: string; pts: Pt[] }
  | { kind: 'corner'; id: string; index: number; orig: Layer }

const HANDLES: [number, number][] = [[-1, -1], [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0]]
const rad = (deg: number): number => (deg * Math.PI) / 180

function rotate([x, y]: Pt, a: number): Pt {
  return [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a)]
}

function anchorsOf(l: ShapeLayer): Pt[] {
  const c: Pt = [l.x + l.width / 2, l.y + l.height / 2]
  return l.points.map(([px, py]) => {
    const [rx, ry] = rotate([(px - 0.5) * l.width, (py - 0.5) * l.height], rad(l.rotation))
    return [c[0] + rx, c[1] + ry]
  })
}

function normBox(a: Pt, b: Pt): Box {
  return { x: Math.min(a[0], b[0]), y: Math.min(a[1], b[1]), width: Math.abs(a[0] - b[0]), height: Math.abs(a[1] - b[1]) }
}

function overlaps(l: Layer, b: Box): boolean {
  const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sy]) => {
    const [rx, ry] = rotate([(sx * l.width) / 2, (sy * l.height) / 2], rad(l.rotation))
    return [l.x + l.width / 2 + rx, l.y + l.height / 2 + ry]
  })
  const xs = corners.map((c) => c[0])
  const ys = corners.map((c) => c[1])
  return Math.min(...xs) < b.x + b.width && Math.max(...xs) > b.x && Math.min(...ys) < b.y + b.height && Math.max(...ys) > b.y
}

function resized(o: Layer, hx: number, hy: number, p: Pt, free: boolean): Box {
  const a = rad(o.rotation)
  const c: Pt = [o.x + o.width / 2, o.y + o.height / 2]
  const [lx, ly] = rotate([p[0] - c[0], p[1] - c[1]], -a)
  const fx = -hx * (o.width / 2)
  const fy = -hy * (o.height / 2)
  let w = hx ? Math.max(4, Math.abs(lx - fx)) : o.width
  let h = hy ? Math.max(4, Math.abs(ly - fy)) : o.height
  if (hx && hy && !free) {
    const k = Math.max(w / o.width, h / o.height)
    w = o.width * k
    h = o.height * k
  }
  const [cx, cy] = rotate([hx ? fx + (hx * w) / 2 : 0, hy ? fy + (hy * h) / 2 : 0], a)
  return { x: c[0] + cx - w / 2, y: c[1] + cy - h / 2, width: w, height: h }
}

export function Stage({
  studio,
  variant,
  tool,
  options,
  setOptions,
  setTool,
  onBox,
  onTextCreated
}: {
  studio: Studio
  variant: VariantState
  tool: Tool
  options: ToolOptions
  setOptions: (o: ToolOptions) => void
  setTool: (t: Tool) => void
  onBox: (tool: 'cut' | 'fill', box: Box) => void
  onTextCreated: (id: string) => void
}): ReactNode {
  const { notify } = useStore()
  const doc = variant.doc
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const [size, setSize] = useState({ w: 640, h: 360 })
  const [drag, setDrag] = useState<Drag | null>(null)
  const [poly, setPoly] = useState<Pt[]>([])
  const [pointer, setPointer] = useState<Pt | null>(null)
  const [hover, setHover] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const selRef = useRef<HTMLCanvasElement>(null)
  const lassoMode = useRef<Combine>('replace')
  const [dropping, setDropping] = useState(false)
  const tick = studio.state.tick
  const scale = size.w / doc.width
  const unit = 1 / scale
  const selected = doc.layers.find((l) => l.id === variant.selected) ?? null
  const v = variant.id
  const chosen = doc.layers.filter((l) => l.id === variant.selected || variant.picked.includes(l.id))
  const multi = chosen.length > 1 ? chosen.filter((l) => !l.locked) : []

  useLayoutEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const fit = (): void => {
      const css = getComputedStyle(el)
      const w = el.clientWidth - parseFloat(css.paddingLeft) - parseFloat(css.paddingRight)
      const h = el.clientHeight - parseFloat(css.paddingTop) - parseFloat(css.paddingBottom)
      const k = Math.min(w / doc.width, h / doc.height)
      setSize({ w: Math.max(1, Math.floor(doc.width * k)), h: Math.max(1, Math.floor(doc.height * k)) })
    }
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(el)
    return () => ro.disconnect()
  }, [doc.width, doc.height])

  useEffect(() => {
    const id = requestAnimationFrame(() => {
      const c = canvasRef.current
      if (c) drawDoc(c.getContext('2d')!, doc, studio.assets)
    })
    return () => cancelAnimationFrame(id)
  }, [doc, tick, studio])

  const marked = studio.selectionOf(v)
  useEffect(() => {
    const c = selRef.current
    if (!c) return
    const g = c.getContext('2d')!
    g.clearRect(0, 0, c.width, c.height)
    if (!marked) return
    const css = getComputedStyle(document.documentElement)
    g.drawImage(selectionOverlay(marked, css.getPropertyValue('--scrim').trim(), css.getPropertyValue('--accent-hot').trim()), 0, 0)
  }, [marked, studio.selectionRev])

  const work = async (label: string, fn: () => Promise<unknown>): Promise<void> => {
    setBusy(label)
    try {
      await fn()
    } catch (err) {
      notify((err as Error).message, 'bad')
    } finally {
      setBusy(null)
    }
  }

  const select = (shape: HTMLCanvasElement, mode: Combine): void =>
    studio.setSelection(v, combine(studio.selectionOf(v), shape, mode))

  useEffect(() => setPoly([]), [tool, v])

  const at = (e: { clientX: number; clientY: number }): Pt => {
    const r = svgRef.current!.getBoundingClientRect()
    return [((e.clientX - r.left) / r.width) * doc.width, ((e.clientY - r.top) / r.height) * doc.height]
  }

  const maskTarget = (): string | null => {
    if (selected) return selected.id
    notify('Select a layer first', 'bad')
    return null
  }

  const runMask = (id: string, action: string, pts: Pt[], radius?: number): Promise<void> =>
    work('Updating mask…', () => editMask(studio, v, id, action, pts, radius))

  const paintTarget = (): string | null => {
    if (selected?.kind === 'image') return selected.id
    notify('Select an image or paint layer first — or add a paint layer', 'bad')
    return null
  }

  const finishPoly = (pts: Pt[]): void => {
    setPoly([])
    if (pts.length < 3) return
    if (tool === 'pen') {
      const glow = options.glowPen
      const { layer } = patchLayer(makeShape(doc, 'polygon'), {
        points: pts,
        name: glow ? 'Glow shape' : 'Shape',
        fill: '#ff2a2a',
        feather: glow ? 36 : 0,
        blend: glow ? 'screen' : 'normal',
        opacity: glow ? 0.85 : 1
      })
      studio.addLayer(v, layer)
      studio.select(v, layer.id)
      setTool('move')
    } else if (tool === 'lasso') {
      const id = maskTarget()
      if (id) void runMask(id, options.maskShow ? 'show_polygon' : 'hide_polygon', pts)
    } else if (tool === 'select') select(lassoSelection(doc, pts), lassoMode.current)
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (!poly.length) return
      if (e.key === 'Enter') finishPoly(poly)
      else if (e.key === 'Escape') setPoly([])
      else if (e.key === 'Backspace') setPoly((p) => p.slice(0, -1))
      else return
      e.preventDefault()
      e.stopPropagation()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  })

  const down = (e: PointerEvent<SVGSVGElement>): void => {
    if (e.button !== 0 || busy) return
    const p = at(e)
    svgRef.current!.setPointerCapture(e.pointerId)
    const handle = (e.target as Element).getAttribute('data-handle')

    if (tool === 'distort') {
      if (handle?.startsWith('c') && selected && !selected.locked) {
        setDrag({ kind: 'corner', id: selected.id, index: Number(handle.slice(1)), orig: selected })
        return
      }
      const target = hitLayer(doc, studio.assets, p[0], p[1])
      if (target) studio.select(v, target.id)
      return
    }
    if (tool === 'select') {
      const mode = combineFrom(e)
      if (options.selectShape === 'wand' || options.selectShape === 'color') {
        const contiguous = options.selectShape === 'wand'
        void work('Selecting…', async () => {
          select(colorSelection(renderDoc(doc, studio.assets), p[0], p[1], options.tolerance, contiguous), mode)
        })
        return
      }
      if (options.selectShape === 'lasso') {
        if (!poly.length) lassoMode.current = mode
        const first = poly[0]
        if (first && poly.length >= 3 && Math.hypot(first[0] - p[0], first[1] - p[1]) < 10 * unit) finishPoly(poly)
        else if (e.detail >= 2 && poly.length >= 3) finishPoly(poly)
        else setPoly((pts) => [...pts, p])
        return
      }
      setDrag({ kind: 'box', from: p, to: p, mode })
      return
    }
    if (tool === 'paint') {
      if (e.altKey && (options.paintMode === 'clone' || options.paintMode === 'heal')) {
        setOptions({ ...options, cloneSource: p })
        return
      }
      const id = paintTarget()
      if (id) setDrag({ kind: 'paint', id, pts: [p] })
      return
    }
    if (tool === 'move') {
      if (handle?.startsWith('m') && multi.length) {
        const [hx, hy] = handle.slice(1).split(',').map(Number)
        setDrag({ kind: 'scale', hx, hy, box: boundsOf(multi), orig: multi })
        return
      }
      if (handle && selected) {
        if (handle === 'rotate') setDrag({ kind: 'rotate', id: selected.id, orig: selected })
        else if (handle.startsWith('a') && selected.kind === 'shape') {
          setDrag({ kind: 'anchor', id: selected.id, index: Number(handle.slice(1)), pts: anchorsOf(selected) })
        } else {
          const [hx, hy] = handle.split(',').map(Number)
          setDrag({ kind: 'resize', id: selected.id, hx, hy, orig: selected })
        }
        return
      }
      let target = hitLayer(doc, studio.assets, p[0], p[1])
      if (!target && selected && !selected.locked) {
        const [lx, ly] = toLocal(selected, p[0], p[1])
        if (Math.abs(lx) <= selected.width / 2 && Math.abs(ly) <= selected.height / 2) target = selected
      }
      const add = e.shiftKey || e.ctrlKey
      if (!target) {
        setDrag({ kind: 'marquee', from: p, to: p, add })
        return
      }
      const ids = studio.selection(v)
      if (add) studio.toggle(v, target.id)
      else if (ids.includes(target.id)) studio.pick(v, ids, target.id)
      else studio.pick(v, studio.withGroups(v, [target.id]), target.id)
      const group = studio.selection(v)
      if (!target.locked && group.includes(target.id)) {
        const orig = Object.fromEntries(doc.layers.filter((l) => group.includes(l.id) && !l.locked).map((l) => [l.id, [l.x, l.y] as Pt]))
        setDrag({ kind: 'move', from: p, orig })
      }
      return
    }
    if (tool === 'text') {
      const layer = makeText(doc)
      layer.x = p[0] - layer.width / 2
      layer.y = p[1] - layer.height / 2
      studio.addLayer(v, layer)
      studio.select(v, layer.id)
      setTool('move')
      onTextCreated(layer.id)
      return
    }
    if (tool === 'pen' || tool === 'lasso') {
      const first = poly[0]
      if (first && poly.length >= 3 && Math.hypot(first[0] - p[0], first[1] - p[1]) < 10 * unit) finishPoly(poly)
      else if (e.detail >= 2 && poly.length >= 3) finishPoly(poly)
      else setPoly((pts) => [...pts, p])
      return
    }
    if (tool === 'brush') {
      const id = maskTarget()
      if (id) setDrag({ kind: 'brush', id, pts: [p] })
      return
    }
    setDrag({ kind: 'box', from: p, to: p, mode: 'replace' })
  }

  const move = (e: PointerEvent<SVGSVGElement>): void => {
    const p = at(e)
    setPointer(p)
    if (!drag) {
      if (tool === 'move') setHover(hitLayer(doc, studio.assets, p[0], p[1])?.id ?? null)
      return
    }
    switch (drag.kind) {
      case 'move': {
        let dx = p[0] - drag.from[0]
        let dy = p[1] - drag.from[1]
        if (e.shiftKey && Math.abs(dx) > Math.abs(dy)) dy = 0
        else if (e.shiftKey) dx = 0
        const moved = Object.entries(drag.orig).map(([id, [x, y]]) => [id, [Math.round(x + dx), Math.round(y + dy)]])
        studio.place(v, Object.fromEntries(moved), 'move')
        break
      }
      case 'resize': {
        const o = drag.orig
        const box = resized(o, drag.hx, drag.hy, p, e.shiftKey || o.kind === 'shape')
        if (o.kind === 'text' && o.wrap && !o.fit && drag.hx && !drag.hy) {
          studio.patch(v, drag.id, { wrap: box.width, x: box.x, width: box.width }, 'resize')
        } else if (o.kind === 'text') {
          const k = box.width / o.width
          studio.patch(v, drag.id, {
            size: Math.max(6, o.size * k),
            x: box.x,
            y: box.y,
            ...(o.wrap ? { wrap: o.wrap * k } : {})
          }, 'resize')
        } else studio.patch(v, drag.id, { ...box }, 'resize')
        break
      }
      case 'scale': {
        const { box: b, hx, hy } = drag
        const ax = hx < 0 ? b.x + b.width : b.x
        const ay = hy < 0 ? b.y + b.height : b.y
        const k = Math.max(0.05, Math.abs(p[0] - ax) / Math.max(1, b.width), Math.abs(p[1] - ay) / Math.max(1, b.height))
        studio.replaceMany(v, drag.orig.map((l) => refitText(scaleLayer(l, k, ax, ay))), 'scale')
        break
      }
      case 'rotate': {
        const o = drag.orig
        let deg = (Math.atan2(p[1] - (o.y + o.height / 2), p[0] - (o.x + o.width / 2)) * 180) / Math.PI + 90
        if (e.shiftKey) deg = Math.round(deg / 15) * 15
        studio.patch(v, drag.id, { rotation: Math.round(((deg + 540) % 360) - 180) }, 'rotate')
        break
      }
      case 'anchor': {
        const pts = drag.pts.map((q, i) => (i === drag.index ? p : q))
        setDrag({ ...drag, pts })
        studio.patch(v, drag.id, { points: pts }, 'anchor')
        break
      }
      case 'box':
      case 'marquee':
        setDrag({ ...drag, to: p })
        break
      case 'brush':
      case 'paint': {
        const last = drag.pts[drag.pts.length - 1]
        if (Math.hypot(last[0] - p[0], last[1] - p[1]) > 2 * unit) setDrag({ ...drag, pts: [...drag.pts, p] })
        break
      }
      case 'corner': {
        const o = drag.orig
        const [lx, ly] = rotate([p[0] - (o.x + o.width / 2), p[1] - (o.y + o.height / 2)], -rad(o.rotation))
        const home: Pt = [[0, 0], [1, 0], [1, 1], [0, 1]][drag.index].map((t, i) => t * (i ? o.height : o.width)) as Pt
        const corners = (o.corners ?? [[0, 0], [0, 0], [0, 0], [0, 0]]).map((c, i) =>
          i === drag.index ? [Math.round(lx + o.width / 2 - home[0]), Math.round(ly + o.height / 2 - home[1])] : c
        ) as Corners
        studio.patch(v, drag.id, { corners }, 'corner')
      }
    }
  }

  const up = (): void => {
    const d = drag
    setDrag(null)
    if (!d) return
    if (d.kind === 'brush') {
      void runMask(d.id, options.maskShow ? 'show_brush' : 'hide_brush', d.pts, options.brush)
      return
    }
    if (d.kind === 'paint') {
      const stroke = {
        mode: options.paintMode,
        points: d.pts,
        radius: options.paintSize,
        color: options.paintColor,
        opacity: options.paintOpacity,
        hardness: options.hardness,
        source: options.cloneSource
      }
      void work('Painting…', () => paint(studio, v, d.id, stroke, studio.selectionOf(v)))
      return
    }
    if (d.kind === 'marquee') {
      const area = normBox(d.from, d.to)
      const touched = area.width < 4 * unit && area.height < 4 * unit ? [] : doc.layers.filter((l) => l.visible && !l.locked && overlaps(l, area)).map((l) => l.id)
      const hit = studio.withGroups(v, touched)
      if (!d.add) studio.pick(v, hit)
      else studio.pick(v, [...new Set([...studio.selection(v), ...hit])], variant.selected ?? hit[hit.length - 1] ?? null)
      return
    }
    if (d.kind !== 'box') return
    const box = normBox(d.from, d.to)
    const tiny = box.width < 6 || box.height < 6
    if (tool === 'select') {
      if (tiny) {
        if (d.mode === 'replace') studio.setSelection(v, null)
      } else select(boxSelection(doc, box, options.selectShape === 'ellipse'), d.mode)
      return
    }
    if (tool === 'rect' || tool === 'ellipse') {
      const shape = makeShape(doc, tool)
      const placed = tiny ? { x: d.from[0] - 150, y: d.from[1] - 100, width: 300, height: 200 } : box
      const layer = { ...shape, ...placed } as Layer
      studio.addLayer(v, layer)
      studio.select(v, layer.id)
      setTool('move')
    } else if ((tool === 'cut' || tool === 'fill') && !tiny) onBox(tool, box)
  }

  const dropFiles = async (e: DragEvent): Promise<void> => {
    e.preventDefault()
    setDropping(false)
    const paths = window.raeydzone.pathsOf(Array.from(e.dataTransfer.files)).filter(Boolean)
    if (!paths.length) return
    try {
      const added = await studio.importPaths(paths)
      let last: Layer | null = null
      for (const info of added) last = placeAsset(studio, v, info)
      if (last) studio.select(v, last.id)
      if (!added.length) notify('Only image files can be placed', 'bad')
    } catch (err) {
      notify((err as Error).message, 'bad')
    }
  }

  const outline = (l: Layer, cls: string): ReactNode => (
    <g transform={`translate(${l.x + l.width / 2} ${l.y + l.height / 2}) rotate(${l.rotation})`}>
      <rect className={cls} x={-l.width / 2} y={-l.height / 2} width={l.width} height={l.height} />
    </g>
  )

  const hs = 10 * unit
  const touched = variant.touched ? doc.layers.find((l) => l.id === variant.touched!.id) : null
  const hovered = hover && hover !== selected?.id ? doc.layers.find((l) => l.id === hover) : null
  const box = drag?.kind === 'box' || drag?.kind === 'marquee' ? normBox(drag.from, drag.to) : null
  const stroke = drag?.kind === 'paint' ? drag : null
  const ellipseBox = tool === 'select' && options.selectShape === 'ellipse'
  const others = doc.layers.filter((l) => l.id !== selected?.id && variant.picked.includes(l.id))
  const drawing = tool !== 'move'

  return (
    <div
      ref={wrapRef}
      className={s.stageWrap}
      onDragOver={(e) => {
        e.preventDefault()
        setDropping(true)
      }}
      onDragLeave={() => setDropping(false)}
      onDrop={(e) => void dropFiles(e)}
    >
      <div className={`${s.stage} ${dropping ? s.stageDrop : ''}`} style={{ width: size.w, height: size.h }}>
        <canvas ref={canvasRef} className={s.stageCanvas} width={doc.width} height={doc.height} />
        <canvas ref={selRef} className={s.stageCanvas} width={doc.width} height={doc.height} />
        <svg
          ref={svgRef}
          className={`${s.overlay} ${drawing ? s.overlayDraw : ''}`}
          viewBox={`0 0 ${doc.width} ${doc.height}`}
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={up}
          onContextMenu={(e) => {
            if (tool !== 'move') return
            const p = at(e)
            const target = hitLayer(doc, studio.assets, p[0], p[1])
            if (target && !studio.selection(v).includes(target.id)) studio.select(v, target.id)
          }}
          onPointerLeave={() => {
            setPointer(null)
            setHover(null)
          }}
          onDoubleClick={() =>
            (tool === 'pen' || tool === 'lasso' || tool === 'select') && poly.length >= 3 && finishPoly(poly)
          }
        >
          {hovered && tool === 'move' && outline(hovered, s.hoverBox)}
          <AnimatePresence>
            {touched && (
              <motion.g
                key={variant.touched!.at}
                initial={{ opacity: 1 }}
                animate={{ opacity: 0 }}
                transition={{ duration: 1.4, ease: 'easeOut' }}
              >
                {outline(touched, s.touchBox)}
              </motion.g>
            )}
          </AnimatePresence>
          {others.map((l) => <g key={l.id}>{outline(l, s.selBox)}</g>)}
          {selected && <SelectionFrame layer={selected} hs={hs} unit={unit} editing={tool === 'move' && !multi.length} />}
          {tool === 'move' && multi.length > 0 && <MultiFrame box={boundsOf(multi)} hs={hs} />}
          {box && !ellipseBox && <rect className={tool === 'fill' || tool === 'cut' ? s.aiBox : s.dragBox} {...box} />}
          {box && ellipseBox && (
            <ellipse className={s.dragBox} cx={box.x + box.width / 2} cy={box.y + box.height / 2} rx={box.width / 2} ry={box.height / 2} />
          )}
          {tool === 'distort' && selected && <DistortFrame layer={selected} hs={hs} />}
          {poly.length > 0 && (
            <>
              <polyline className={s.polyLine} points={[...poly, ...(pointer ? [pointer] : [])].map((q) => q.join(',')).join(' ')} />
              {poly.map((q, i) => (
                <circle key={i} className={i === 0 ? s.anchorFirst : s.anchor} cx={q[0]} cy={q[1]} r={hs / 2} />
              ))}
            </>
          )}
          {drag?.kind === 'brush' && (
            <polyline
              className={options.maskShow ? s.brushShow : s.brushHide}
              strokeWidth={options.brush * 2}
              points={drag.pts.map((q) => q.join(',')).join(' ')}
            />
          )}
          {tool === 'brush' && pointer && <circle className={s.brushCursor} cx={pointer[0]} cy={pointer[1]} r={options.brush} />}
          {stroke && (
            <polyline
              className={s.paintStroke}
              stroke={options.paintMode === 'brush' ? options.paintColor : undefined}
              strokeWidth={options.paintSize * 2}
              opacity={options.paintOpacity}
              points={stroke.pts.map((q) => q.join(',')).join(' ')}
            />
          )}
          {tool === 'paint' && pointer && (
            <circle className={s.brushCursor} cx={pointer[0]} cy={pointer[1]} r={options.paintSize} />
          )}
          {tool === 'paint' && options.cloneSource && (options.paintMode === 'clone' || options.paintMode === 'heal') && (
            <g className={s.cloneMark} transform={`translate(${options.cloneSource[0]} ${options.cloneSource[1]})`}>
              <circle r={hs} />
              <line x1={-hs * 1.6} x2={hs * 1.6} y1={0} y2={0} />
              <line y1={-hs * 1.6} y2={hs * 1.6} x1={0} x2={0} />
            </g>
          )}
        </svg>
        {busy && <div className={s.stageBusy}>{busy}</div>}
      </div>
    </div>
  )
}

function DistortFrame({ layer, hs }: { layer: Layer; hs: number }): ReactNode {
  const pts = cornerPoints(layer)
  return (
    <g>
      <polygon className={s.selBox} points={pts.map((q) => q.join(',')).join(' ')} />
      {!layer.locked &&
        pts.map((q, i) => (
          <circle key={i} className={s.cornerHandle} data-handle={'c' + i} cx={q[0]} cy={q[1]} r={hs / 1.5} />
        ))}
    </g>
  )
}

function MultiFrame({ box, hs }: { box: Bounds; hs: number }): ReactNode {
  return (
    <g>
      <rect className={s.groupBox} {...box} />
      {[[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([hx, hy]) => (
        <rect
          key={hx + ',' + hy}
          className={s.handle}
          data-handle={`m${hx},${hy}`}
          x={box.x + (hx > 0 ? box.width : 0) - hs / 2}
          y={box.y + (hy > 0 ? box.height : 0) - hs / 2}
          width={hs}
          height={hs}
          style={{ cursor: hx === hy ? 'nwse-resize' : 'nesw-resize' }}
        />
      ))}
    </g>
  )
}

function SelectionFrame({ layer, hs, unit, editing }: { layer: Layer; hs: number; unit: number; editing: boolean }): ReactNode {
  const { width: w, height: h } = layer
  const rotY = -h / 2 - 26 * unit
  return (
    <>
      <g transform={`translate(${layer.x + w / 2} ${layer.y + h / 2}) rotate(${layer.rotation})`}>
        <rect className={s.selBox} x={-w / 2} y={-h / 2} width={w} height={h} />
        {editing && !layer.locked && (
          <>
            <line className={s.selBox} x1={0} y1={-h / 2} x2={0} y2={rotY} />
            <circle className={s.rotHandle} data-handle="rotate" cx={0} cy={rotY} r={hs / 1.6} />
            {HANDLES.map(([hx, hy]) => (
              <rect
                key={hx + ',' + hy}
                className={s.handle}
                data-handle={hx + ',' + hy}
                x={(hx * w) / 2 - hs / 2}
                y={(hy * h) / 2 - hs / 2}
                width={hs}
                height={hs}
                style={{ cursor: hx && hy ? (hx === hy ? 'nwse-resize' : 'nesw-resize') : hx ? 'ew-resize' : 'ns-resize' }}
              />
            ))}
          </>
        )}
      </g>
      {editing && !layer.locked && layer.kind === 'shape' && layer.shape === 'polygon' &&
        anchorsOf(layer).map((q, i) => (
          <circle key={i} className={s.anchor} data-handle={'a' + i} cx={q[0]} cy={q[1]} r={hs / 1.8} />
        ))}
    </>
  )
}

