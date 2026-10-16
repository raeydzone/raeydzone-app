import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { DragEvent, PointerEvent, ReactNode } from 'react'
import type { Layer, ShapeLayer } from '@shared/studio'
import { useStore } from '../../state/store'
import { editMask, placeAsset } from '../ai'
import type { Box } from '../ai'
import { makeShape, makeText, patchLayer } from '../doc'
import type { Studio, VariantState } from '../engine'
import type { Pt } from '../mask'
import { drawDoc, hitLayer, toLocal } from '../render'
import s from './studio.module.css'

export type Tool = 'move' | 'text' | 'rect' | 'ellipse' | 'pen' | 'lasso' | 'brush' | 'cut' | 'fill'

export interface ToolOptions {
  brush: number
  maskShow: boolean
  glowPen: boolean
}

type Drag =
  | { kind: 'move'; id: string; from: Pt; orig: Pt }
  | { kind: 'resize'; id: string; hx: number; hy: number; orig: Layer }
  | { kind: 'rotate'; id: string; orig: Layer }
  | { kind: 'anchor'; id: string; index: number; pts: Pt[] }
  | { kind: 'box'; from: Pt; to: Pt }
  | { kind: 'brush'; id: string; pts: Pt[] }

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
  setTool,
  onBox,
  onTextCreated
}: {
  studio: Studio
  variant: VariantState
  tool: Tool
  options: ToolOptions
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
  const [busy, setBusy] = useState(false)
  const [dropping, setDropping] = useState(false)
  const tick = studio.state.tick
  const scale = size.w / doc.width
  const unit = 1 / scale
  const selected = doc.layers.find((l) => l.id === variant.selected) ?? null
  const v = variant.id

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

  useEffect(() => setPoly([]), [tool, v])

  const at = (e: { clientX: number; clientY: number }): Pt => {
    const r = svgRef.current!.getBoundingClientRect()
    return [((e.clientX - r.left) / r.width) * doc.width, ((e.clientY - r.top) / r.height) * doc.height]
  }

  const maskTarget = (): string | null => {
    if (selected?.kind === 'image') return selected.id
    notify('Select an image layer first', 'bad')
    return null
  }

  const runMask = async (id: string, action: string, pts: Pt[], radius?: number): Promise<void> => {
    setBusy(true)
    try {
      await editMask(studio, v, id, action, pts, radius)
    } catch (err) {
      notify((err as Error).message, 'bad')
    } finally {
      setBusy(false)
    }
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
    }
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

    if (tool === 'move') {
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
      studio.select(v, target?.id ?? null)
      if (target && !target.locked) setDrag({ kind: 'move', id: target.id, from: p, orig: [target.x, target.y] })
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
    setDrag({ kind: 'box', from: p, to: p })
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
        studio.patch(v, drag.id, { x: Math.round(drag.orig[0] + dx), y: Math.round(drag.orig[1] + dy) }, 'move')
        break
      }
      case 'resize': {
        const o = drag.orig
        const box = resized(o, drag.hx, drag.hy, p, e.shiftKey || o.kind === 'shape')
        if (o.kind === 'text') {
          const k = box.width / o.width
          studio.patch(v, drag.id, { size: Math.max(6, o.size * k), x: box.x, y: box.y }, 'resize')
        } else studio.patch(v, drag.id, { ...box }, 'resize')
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
        setDrag({ ...drag, to: p })
        break
      case 'brush': {
        const last = drag.pts[drag.pts.length - 1]
        if (Math.hypot(last[0] - p[0], last[1] - p[1]) > 2 * unit) setDrag({ ...drag, pts: [...drag.pts, p] })
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
    if (d.kind !== 'box') return
    const box = normBox(d.from, d.to)
    const tiny = box.width < 6 || box.height < 6
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
  const box = drag?.kind === 'box' ? normBox(drag.from, drag.to) : null
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
        <svg
          ref={svgRef}
          className={`${s.overlay} ${drawing ? s.overlayDraw : ''}`}
          viewBox={`0 0 ${doc.width} ${doc.height}`}
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={up}
          onPointerLeave={() => {
            setPointer(null)
            setHover(null)
          }}
          onDoubleClick={() => (tool === 'pen' || tool === 'lasso') && poly.length >= 3 && finishPoly(poly)}
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
          {selected && <SelectionFrame layer={selected} hs={hs} unit={unit} editing={tool === 'move'} />}
          {box && <rect className={tool === 'fill' || tool === 'cut' ? s.aiBox : s.dragBox} {...box} />}
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
        </svg>
        {busy && <div className={s.stageBusy}>Updating mask…</div>}
      </div>
    </div>
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

