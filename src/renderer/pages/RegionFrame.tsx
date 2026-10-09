import { useEffect } from 'react'
import type { ReactNode } from 'react'
import f from './region.module.css'

const params = new URLSearchParams(window.location.search)
const num = (key: string): number => Number(params.get(key) ?? 0)

export default function RegionFrame(): ReactNode {
  useEffect(() => {
    document.body.classList.add('regionOverlay')
    return () => document.body.classList.remove('regionOverlay')
  }, [])

  return (
    <div
      className={f.guide}
      style={{
        left: `calc(${num('x')}px - var(--guide-stroke))`,
        top: `calc(${num('y')}px - var(--guide-stroke))`,
        width: `calc(${num('w')}px + var(--guide-stroke) * 2)`,
        height: `calc(${num('h')}px + var(--guide-stroke) * 2)`
      }}
    >
      {[0, 1, 2, 3].map((corner) => (
        <i key={corner} className={f.guideCorner} />
      ))}
    </div>
  )
}
