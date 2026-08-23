import type { ReactNode } from 'react'
import type { LogEntry } from '@shared/types'
import { IconSettings, IconStream, IconTimer, IconVideo } from './Icons'
import p from '../pages/pages.module.css'

export function badgeFor(type: string): { icon: ReactNode; tone: string } {
  if (type.startsWith('video.')) return { icon: <IconVideo size={13} />, tone: p.logVideo }
  if (type.startsWith('stream.')) return { icon: <IconStream size={13} />, tone: p.logStream }
  if (type.startsWith('timer.')) return { icon: <IconTimer size={13} />, tone: p.logTimer }
  return { icon: <IconSettings size={13} />, tone: '' }
}

export function clockOf(iso: string): string {
  const d = new Date(iso)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

export function LogRows({ entries }: { entries: LogEntry[] }): ReactNode {
  return (
    <>
      {entries.map((e) => {
        const badge = badgeFor(e.type)
        return (
          <div key={e.id} className={p.logEntry}>
            <span className={`${p.logBadge} ${badge.tone}`}>{badge.icon}</span>
            <span className={p.logClock}>{clockOf(e.ts)}</span>
            <span>{e.message}</span>
          </div>
        )
      })}
    </>
  )
}
