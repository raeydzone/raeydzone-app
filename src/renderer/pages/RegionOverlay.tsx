import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import r from './region.module.css'

const HINT =
  new URLSearchParams(window.location.search).get('hint') ??
  'Drag a box to record · Esc to cancel'

interface Point {
  x: number
  y: number
}

const rectOf = (
  a: Point,
  b: Point
): { x: number; y: number; width: number; height: number } => ({
  x: Math.min(a.x, b.x),
  y: Math.min(a.y, b.y),
  width: Math.abs(a.x - b.x),
  height: Math.abs(a.y - b.y)
})

export default function RegionOverlay(): ReactNode {
  const [anchor, setAnchor] = useState<Point | null>(null)
  const [cursor, setCursor] = useState<Point | null>(null)
  const [done, setDone] = useState(false)
  const settled = useRef(false)

  const settle = useCallback(
    (rect: { x: number; y: number; width: number; height: number } | null): void => {
      if (settled.current) return
      settled.current = true
      setDone(true)
      void window.raeydzone.finishRegion(rect).catch(() => undefined)
    },
    []
  )

  useEffect(() => {
    document.body.classList.add('regionOverlay')
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') settle(null)
    }
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.classList.remove('regionOverlay')
      window.removeEventListener('keydown', onKey)
    }
  }, [settle])

  const box = anchor && cursor ? rectOf(anchor, cursor) : null

  // Stop painting the moment the box is committed; the window teardown follows behind.
  if (done) return null

  return (
    <div
      className={r.overlay}
      onMouseDown={(e) => {
        const point = { x: e.clientX, y: e.clientY }
        setAnchor(point)
        setCursor(point)
      }}
      onMouseMove={(e) => {
        if (anchor) setCursor({ x: e.clientX, y: e.clientY })
      }}
      onMouseUp={() => {
        if (box && box.width >= 8 && box.height >= 8) settle(box)
        else setAnchor(null)
      }}
    >
      {box ? (
        <div
          className={r.box}
          style={{ left: box.x, top: box.y, width: box.width, height: box.height }}
        >
          <span className={r.size}>
            {Math.round(box.width)} × {Math.round(box.height)}
          </span>
        </div>
      ) : (
        <div className={r.scrim} />
      )}

      {!anchor && (
        <div className={r.hint}>{HINT}</div>
      )}
    </div>
  )
}
