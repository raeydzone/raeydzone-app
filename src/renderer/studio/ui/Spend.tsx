import * as Popover from '@radix-ui/react-popover'
import { motion } from 'motion/react'
import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { formatMoney, formatStamp, monthLabel } from '@shared/format'
import { IMAGE_TASKS } from '@shared/studio'
import type { OpenRouterStatus, SpendSummary, StudioProject } from '@shared/studio'
import { IconChevron } from '../../components/Icons'
import k from '../../styles/soft.module.css'
import s from './insights.module.css'

export function useSpend(projectId: string | null): SpendSummary | null {
  const [summary, setSummary] = useState<SpendSummary | null>(null)
  useEffect(() => {
    const load = (): void => void window.raeydzone.studio.spend(projectId).then(setSummary).catch(() => {})
    load()
    return window.raeydzone.studio.onSpendChanged(load)
  }, [projectId])
  return summary
}

function Stat({ label, value }: { label: string; value: string }): ReactNode {
  return (
    <div className={s.stat}>
      <span className={s.statLabel}>{label}</span>
      <span className={s.statValue}>{value}</span>
    </div>
  )
}

function Bars({ title, rows }: { title: string; rows: { id: string; label: string; images: number; cost: number }[] }): ReactNode {
  const top = Math.max(...rows.map((r) => r.cost), 0.0001)
  return (
    <div className={s.block}>
      <span className={s.kicker}>{title}</span>
      {rows.map((r) => (
        <div key={r.id} className={s.modelRow}>
          <span className={s.modelName}>{r.label}</span>
          <span className={s.modelCount}>{r.images}×</span>
          <span className={s.modelCost}>{formatMoney(r.cost)}</span>
          <span className={s.bar}>
            <motion.span
              className={s.barFill}
              initial={{ width: 0 }}
              animate={{ width: `${(r.cost / top) * 100}%` }}
              transition={{ duration: 0.2, ease: [0.22, 0.61, 0.36, 1] }}
            />
          </span>
        </div>
      ))}
    </div>
  )
}

function Breakdown({ summary }: { summary: SpendSummary }): ReactNode {
  if (!summary.models.length) return null
  return (
    <>
      <Bars title="By model" rows={summary.models} />
      <div className={s.tasks}>
        {IMAGE_TASKS.map((t) => (
          <span key={t.id} className={k.tag}>
            {t.label} · {formatMoney(summary.tasks[t.id] ?? 0)}
          </span>
        ))}
      </div>
    </>
  )
}

const requests = (summary: SpendSummary | null): string => {
  const n = summary?.images ?? 0
  return `${n} ${n === 1 ? 'request' : 'requests'}${summary?.since ? ` since ${formatStamp(summary.since)}` : ''}`
}

export function SpendPill({ project }: { project: StudioProject }): ReactNode {
  const summary = useSpend(project.id)
  const what = project.kind === 'stream' ? 'stream' : 'video'

  return (
    <Popover.Root>
      <Popover.Trigger className={k.pill} title={`What image generation has cost for this ${what}'s thumbnail`}>
        <span className={s.pillLabel}>AI spend</span>
        <span className={s.pillValue}>{formatMoney(summary?.total ?? 0)}</span>
        <IconChevron size={12} />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content className={`${k.menu} ${s.spend}`} align="end" sideOffset={6} collisionPadding={12}>
          <div className={s.spendHead}>
            <span className={s.kicker}>Spent on this thumbnail</span>
            <span className={s.total}>{formatMoney(summary?.total ?? 0)}</span>
            <span className={s.sub}>{requests(summary)}</span>
          </div>
          {summary && <Breakdown summary={summary} />}
          <div className={s.foot}>
            {!!summary?.unpriced && <span>{summary.unpriced} requests came back without a price.</span>}
            <span>Monthly and all-time totals across every thumbnail are in Settings → AI spend.</span>
            <span>Claude runs on your subscription, so it adds no API cost here.</span>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}

export function SpendOverview(): ReactNode {
  const summary = useSpend(null)
  const [account, setAccount] = useState<OpenRouterStatus | null>(null)

  useEffect(() => {
    void window.raeydzone.ai.openrouterStatus().then(setAccount).catch(() => {})
  }, [])

  return (
    <div className={s.overview}>
      <div className={s.spendHead}>
        <span className={s.kicker}>All time</span>
        <span className={s.total}>{formatMoney(summary?.total ?? 0)}</span>
        <span className={s.sub}>{requests(summary)}</span>
      </div>
      <div className={s.stats}>
        <Stat label="This month" value={formatMoney(summary?.month ?? 0)} />
        <Stat label="Today" value={formatMoney(summary?.today ?? 0)} />
        <Stat label="Requests" value={String(summary?.images ?? 0)} />
      </div>
      {!!summary?.months.length && (
        <Bars title="By month" rows={summary.months.map((m) => ({ ...m, id: m.key, label: monthLabel(m.key) }))} />
      )}
      {summary && <Breakdown summary={summary} />}
      <div className={s.foot}>
        {account?.ok && (
          <span>
            OpenRouter key: {account.usage != null ? `${formatMoney(account.usage)} used in total` : 'connected'}
            {account.remaining != null ? ` · ${formatMoney(account.remaining)} credit left` : ''}
          </span>
        )}
        {!!summary?.unpriced && <span>{summary.unpriced} requests came back without a price.</span>}
        <span>Each Thumbnail Studio shows what its own thumbnail cost.</span>
      </div>
    </div>
  )
}
