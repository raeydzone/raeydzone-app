import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState
} from 'react'
import type { ReactNode } from 'react'
import { dayKey } from '@shared/format'
import type { AppState, Stream, Video } from '@shared/types'

export interface Toast {
  id: number
  tone: 'ok' | 'bad'
  text: string
}

interface Store {
  state: AppState | null
  rev: number
  toasts: Toast[]
  notify: (text: string, tone?: Toast['tone']) => void
  dismiss: (id: number) => void
  run: <T>(fn: () => Promise<T>, success?: string) => Promise<T | null>
  refresh: () => Promise<void>
}

const Ctx = createContext<Store | null>(null)

export function StoreProvider({ children }: { children: ReactNode }): ReactNode {
  const [state, setState] = useState<AppState | null>(null)
  const [rev, setRev] = useState(0)
  const [toasts, setToasts] = useState<Toast[]>([])
  const nextId = useRef(1)

  const apply = useCallback((next: AppState) => {
    setState(next)
    setRev((r) => r + 1)
  }, [])

  const refresh = useCallback(async () => {
    apply(await window.raeydzone.getState())
  }, [apply])

  useEffect(() => {
    void refresh()
    return window.raeydzone.onStateChanged(apply)
  }, [refresh, apply])

  const dismiss = useCallback((id: number) => {
    setToasts((list) => list.filter((t) => t.id !== id))
  }, [])

  const notify = useCallback(
    (text: string, tone: Toast['tone'] = 'ok') => {
      const id = nextId.current++
      setToasts((list) => [...list, { id, tone, text }])
      setTimeout(() => dismiss(id), 4200)
    },
    [dismiss]
  )

  const run = useCallback(
    async <T,>(fn: () => Promise<T>, success?: string): Promise<T | null> => {
      try {
        const value = await fn()
        if (success) notify(success)
        return value
      } catch (err) {
        notify((err as Error).message, 'bad')
        return null
      }
    },
    [notify]
  )

  const value = useMemo(
    () => ({ state, rev, toasts, notify, dismiss, run, refresh }),
    [state, rev, toasts, notify, dismiss, run, refresh]
  )

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useStore(): Store {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useStore outside provider')
  return ctx
}

export function useAppState(): AppState {
  const { state } = useStore()
  if (!state) throw new Error('state not loaded')
  return state
}

export function useTick(active: boolean, ms = 1000): number {
  const [n, setN] = useState(0)
  useEffect(() => {
    if (!active) return
    const id = setInterval(() => setN((v) => v + 1), ms)
    return () => clearInterval(id)
  }, [active, ms])
  return n
}

export function useTodayMs(): number {
  const { days, running } = useAppState()
  useTick(!!running)
  const key = dayKey(new Date())
  const base = days[key]?.totalMs ?? 0
  if (!running) return base
  const startedToday = dayKey(new Date(running.start)) === key
  const from = startedToday
    ? new Date(running.start).getTime()
    : new Date().setHours(0, 0, 0, 0)
  return base + Math.max(0, Date.now() - from)
}

export function mediaUrl(
  kind: 'video' | 'stream',
  entity: Video | Stream,
  file: string | null,
  rev: number
): string | null {
  if (!file) return null
  const dir = kind === 'video' ? 'Videos' : 'Streams'
  const parts = [dir, entity.folder, file].map(encodeURIComponent).join('/')
  return `raeydzone://media/${parts}?r=${rev}`
}

export function isComplete(v: Video): boolean {
  return Object.values(v.steps).every((t) => t !== null)
}
