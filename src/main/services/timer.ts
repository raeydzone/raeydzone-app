import * as db from './db'
import { log } from './log'
import { dayKey, dayLabel, formatDuration } from '@shared/format'

const HEARTBEAT_MS = 30_000
let ticker: NodeJS.Timeout | null = null

function addSpan(startIso: string, endIso: string): number {
  let cursor = new Date(startIso)
  const end = new Date(endIso)
  let total = 0

  while (cursor < end) {
    const midnight = new Date(cursor)
    midnight.setHours(24, 0, 0, 0)
    const slice = midnight < end ? midnight : end
    const ms = slice.getTime() - cursor.getTime()
    const key = dayKey(cursor)
    const rec = db.state().days[key] ?? { date: key, totalMs: 0, sessions: [] }
    rec.sessions.push({ start: cursor.toISOString(), end: slice.toISOString() })
    rec.totalMs += ms
    db.saveDay(rec)
    total += ms
    cursor = slice
  }
  return total
}

function beat(): void {
  const running = db.state().running
  if (running) db.setRunning({ ...running, heartbeat: new Date().toISOString() })
}

export function recover(): void {
  const running = db.state().running
  if (!running) return
  const ms = addSpan(running.start, running.heartbeat)
  db.setRunning(null)
  if (ms > 0) {
    log('timer.recovered', 'Recovered ' + formatDuration(ms) + ' from an interrupted session')
  }
}

export function start(): void {
  if (db.state().running) return
  const now = new Date().toISOString()
  db.setRunning({ start: now, heartbeat: now })
  ticker = setInterval(beat, HEARTBEAT_MS)
  log('timer.start', 'Timer started')
}

export function stop(): number {
  const running = db.state().running
  if (!running) return 0
  if (ticker) clearInterval(ticker)
  ticker = null

  const elapsed = addSpan(running.start, new Date().toISOString())
  db.setRunning(null)
  log('timer.stop', 'Session ended — ' + formatDuration(elapsed))
  return elapsed
}

const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/

export function moveTime(fromKey: string, toKey: string, ms: number): void {
  if (!DAY_KEY.test(fromKey) || !DAY_KEY.test(toKey)) throw new Error('Not a valid day.')
  if (toKey >= fromKey) throw new Error('Time can only move to an earlier day.')
  if (db.state().running) throw new Error('Stop the timer before moving time.')

  const amount = Math.round(ms)
  const from = db.state().days[fromKey]
  if (!(amount > 0)) throw new Error('Pick an amount to move.')
  if (!from || from.totalMs < amount) {
    throw new Error('That day does not have that much time to move.')
  }

  const to = db.state().days[toKey] ?? { date: toKey, totalMs: 0, sessions: [] }
  db.saveDay({ ...from, totalMs: from.totalMs - amount })
  db.saveDay({ ...to, totalMs: to.totalMs + amount })
  log(
    'timer.move',
    'Moved ' + formatDuration(amount) + ' from ' + dayLabel(fromKey) + ' to ' + dayLabel(toKey)
  )
}

export function shutdown(): void {
  if (db.state().running) stop()
}
