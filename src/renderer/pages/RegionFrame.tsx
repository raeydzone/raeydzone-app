import { useEffect } from 'react'
import type { ReactNode } from 'react'
import f from './region.module.css'

const params = new URLSearchParams(window.location.search)
const num = (key: string): number => Number(params.get(key) ?? 0)

// The border is laid in the ring OUTSIDE the recorded rectangle: the element is inflated
// by the border width on every side, so its transparent interior is exactly the capture.
const BORDER = 2

export default function RegionFrame(): ReactNode {
  useEffect(() => {
    document.body.classList.add('regionOverlay')
    return () => document.body.classList.remove('regionOverlay')
  }, [])

  return (
    <div
      className={f.guide}
      style={{
        left: num('x') - BORDER,
        top: num('y') - BORDER,
        width: num('w') + BORDER * 2,
        height: num('h') + BORDER * 2,
        borderWidth: BORDER
      }}
    />
  )
}
