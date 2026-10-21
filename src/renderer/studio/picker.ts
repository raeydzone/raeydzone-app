import { useSyncExternalStore } from 'react'

// A colour field asks; the canvas, which can sample the composite, answers on the next click.
let pending: ((color: string | null) => void) | null = null
const listeners = new Set<() => void>()
const notify = (): void => listeners.forEach((fn) => fn())

export function pickFromCanvas(): Promise<string | null> {
  pending?.(null)
  return new Promise((resolve) => {
    pending = resolve
    notify()
  })
}

export function deliverPick(color: string | null): void {
  const done = pending
  pending = null
  done?.(color)
  notify()
}

export function usePicking(): boolean {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
    () => pending !== null
  )
}

export function sampleAt(c: HTMLCanvasElement, x: number, y: number): string {
  const d = c.getContext('2d')!.getImageData(Math.max(0, Math.min(c.width - 1, Math.floor(x))), Math.max(0, Math.min(c.height - 1, Math.floor(y))), 1, 1).data
  return '#' + [d[0], d[1], d[2]].map((v) => v.toString(16).padStart(2, '0')).join('')
}
