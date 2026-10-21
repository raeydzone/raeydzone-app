const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
]

const pad = (n: number): string => String(n).padStart(2, '0')

export function formatStamp(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return `${pad(d.getDate())}, ${MONTHS[d.getMonth()]} ${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function formatMoney(usd: number): string {
  return '$' + usd.toFixed(usd > 0 && usd < 1 ? 3 : 2)
}

export function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  return `${h}:${pad(m)}:${pad(s)}`
}

export function formatDuration(ms: number): string {
  const mins = Math.round(ms / 60000)
  if (mins < 60) return `${mins}m`
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return m === 0 ? `${h}h` : `${h}h ${m}m`
}

// AI work is measured in seconds; formatDuration rounds to minutes for the day's goal.
export function formatSpan(ms: number): string {
  const secs = Math.max(0, ms) / 1000
  if (secs < 9.95) return secs.toFixed(1) + 's'
  const total = Math.round(secs)
  if (total < 60) return total + 's'
  const m = Math.floor(total / 60)
  if (m < 60) return `${m}m ${pad(total % 60)}s`
  return `${Math.floor(m / 60)}h ${pad(m % 60)}m`
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`
  return `${bytes} B`
}

export function dayKey(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function dayLabel(key: string): string {
  const [y, m, d] = key.split('-').map(Number)
  return `${pad(d)}, ${MONTHS[m - 1]} ${y}`
}

export function monthLabel(key: string): string {
  const [y, m] = key.split('-').map(Number)
  return `${MONTHS[m - 1]} ${y}`
}
