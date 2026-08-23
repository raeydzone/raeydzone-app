import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type { LogEntry } from '@shared/types'
import { dayKey, dayLabel } from '@shared/format'
import { LogRows } from '../components/LogFeed'
import { useAppState } from '../state/store'
import p from './pages.module.css'
import ui from '../styles/ui.module.css'

const GROUPS = [
  { id: 'all', label: 'Everything', match: () => true },
  { id: 'video', label: 'Videos', match: (t: string) => t.startsWith('video.') },
  { id: 'stream', label: 'Streams', match: (t: string) => t.startsWith('stream.') },
  { id: 'timer', label: 'Timer', match: (t: string) => t.startsWith('timer.') },
  { id: 'system', label: 'System', match: (t: string) => t.startsWith('system.') }
]

export default function LogPage(): ReactNode {
  const { log } = useAppState()
  const [group, setGroup] = useState('all')
  const [query, setQuery] = useState('')

  const days = useMemo(() => {
    const matcher = GROUPS.find((g) => g.id === group)!.match
    const needle = query.trim().toLowerCase()
    const filtered = log.filter(
      (e) =>
        matcher(e.type) &&
        (!needle ||
          e.message.toLowerCase().includes(needle) ||
          (e.targetName ?? '').toLowerCase().includes(needle))
    )
    const buckets = new Map<string, LogEntry[]>()
    for (const entry of filtered) {
      const key = dayKey(new Date(entry.ts))
      if (!buckets.has(key)) buckets.set(key, [])
      buckets.get(key)!.push(entry)
    }
    return { buckets: [...buckets.entries()], count: filtered.length }
  }, [log, group, query])

  const today = dayKey(new Date())

  return (
    <div className={ui.page}>
      <div className={ui.pageHead}>
        <div>
          <h1 className={ui.title}>Log</h1>
          <p className={ui.sub}>{days.count} entries</p>
        </div>
        <input
          className={ui.input}
          style={{ width: 240 }}
          placeholder="Search…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      <div className={ui.row} style={{ marginBottom: 'var(--s-4)' }}>
        {GROUPS.map((g) => (
          <button
            key={g.id}
            className={`${ui.btn} ${group === g.id ? ui.btnPrimary : ui.btnGhost}`}
            onClick={() => setGroup(g.id)}
          >
            {g.label}
          </button>
        ))}
      </div>

      <div className={ui.panel}>
        {days.count === 0 ? (
          <p className={ui.faint}>Nothing matches.</p>
        ) : (
          days.buckets.map(([key, entries]) => (
            <div key={key}>
              <div className={p.logDay}>{key === today ? 'Today' : dayLabel(key)}</div>
              <LogRows entries={entries} />
            </div>
          ))
        )}
      </div>
    </div>
  )
}
