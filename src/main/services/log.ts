import { randomUUID } from 'node:crypto'
import * as db from './db'
import type { LogEntry, LogType } from '@shared/types'

export function log(
  type: LogType,
  message: string,
  target?: { id: string; name: string }
): LogEntry {
  const entry: LogEntry = {
    id: randomUUID(),
    ts: new Date().toISOString(),
    type,
    targetId: target?.id ?? null,
    targetName: target?.name ?? null,
    message
  }
  db.addLog(entry)
  return entry
}
