import * as Popover from '@radix-ui/react-popover'
import { motion } from 'motion/react'
import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { formatMoney, formatStamp } from '@shared/format'
import { IMAGE_TASKS } from '@shared/studio'
import type { OpenRouterStatus, SpendSummary, StudioProject } from '@shared/studio'
import { IconChevron } from '../../components/Icons'
import k from '../../styles/soft.module.css'
import s from './insights.module.css'

function useSpend(projectId: string): SpendSummary | null {
  const [summary, setSummary] = useState<SpendSummary | null>(null)
  useEffect(() => {
    const load = (): void => void window.raeydzone.studio.spend(projectId).then(setSummary).catch(() => {})
    load()
    return window.raeydzone.studio.onSpendChanged(load)
  }, [projectId])
  return summary
}

function Stat({ label, value }: { label: string; value: number }): ReactNode {
  return (
    <div className={s.stat}>
      <span className={s.statLabel}>{label}</span>
      <span className={s.statValue}>{formatMoney(value)}</span>
    </div>
  )
}

export function SpendPill({ project }: { project: StudioProject }): ReactNode {
  const summary = useSpend(project.id)
  const [account, setAccount] = useState<OpenRouterStatus | null>(null)
  const top = Math.max(...(summary?.models.map((m) => m.cost) ?? [0]), 0.0001)

  return (
    <Popover.Root onOpenChange={(open) => open && void window.raeydzone.ai.openrouterStatus().then(setAccount).catch(() => {})}>
      <Popover.Trigger className={k.pill} title="What image generation has cost across every studio">
        <span className={s.pillLabel}>AI spend</span>
        <span className={s.pillValue}>{formatMoney(summary?.total ?? 0)}</span>
        <IconChevron size={12} />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content className={`${k.menu} ${s.spend}`} align="end" sideOffset={6} collisionPadding={12}>
          <div className={s.spendHead}>
            <span className={s.kicker}>Spent on image AI · all time</span>
            <span className={s.total}>{formatMoney(summary?.total ?? 0)}</span>
            <span className={s.sub}>
              {summary?.images ?? 0} requests{summary?.since ? ` since ${formatStamp(summary.since)}` : ''}
            </span>
          </div>

          <div className={s.stats}>
            <Stat label="Today" value={summary?.today ?? 0} />
            <Stat label="This month" value={summary?.month ?? 0} />
            <Stat label={project.kind === 'stream' ? 'This stream' : 'This video'} value={summary?.project ?? 0} />
          </div>

          {!!summary?.models.length && (
            <div className={s.block}>
              <span className={s.kicker}>By model</span>
              {summary.models.map((m) => (
                <div key={m.id} className={s.modelRow}>
                  <span className={s.modelName}>{m.label}</span>
                  <span className={s.modelCount}>{m.images}×</span>
                  <span className={s.modelCost}>{formatMoney(m.cost)}</span>
                  <span className={s.bar}>
                    <motion.span
                      className={s.barFill}
                      initial={{ width: 0 }}
                      animate={{ width: `${(m.cost / top) * 100}%` }}
                      transition={{ duration: 0.2, ease: [0.22, 0.61, 0.36, 1] }}
                    />
                  </span>
                </div>
              ))}
              <div className={s.tasks}>
                {IMAGE_TASKS.map((t) => (
                  <span key={t.id} className={k.tag}>
                    {t.label} · {formatMoney(summary.tasks[t.id] ?? 0)}
                  </span>
                ))}
              </div>
            </div>
          )}

          <div className={s.foot}>
            {account?.ok && (
              <span>
                OpenRouter key: {account.usage != null ? `${formatMoney(account.usage)} used in total` : 'connected'}
                {account.remaining != null ? ` · ${formatMoney(account.remaining)} credit left` : ''}
              </span>
            )}
            {!!summary?.unpriced && <span>{summary.unpriced} requests came back without a price.</span>}
            <span>Claude runs on your subscription, so it adds no API cost here.</span>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
