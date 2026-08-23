import { motion } from 'motion/react'
import { useState } from 'react'
import type { ReactNode } from 'react'
import { dayKey, dayLabel, formatClock, formatDuration } from '@shared/format'
import { IconPlay, IconStop } from '../components/Icons'
import { useAppState, useStore, useTick, useTodayMs } from '../state/store'
import p from './pages.module.css'
import ui from '../styles/ui.module.css'

const DAYS_SHOWN = 30

function lastDays(n: number): string[] {
  const out: string[] = []
  const d = new Date()
  for (let i = n - 1; i >= 0; i--) {
    const day = new Date(d)
    day.setDate(d.getDate() - i)
    out.push(dayKey(day))
  }
  return out
}

export default function TimerPage(): ReactNode {
  const state = useAppState()
  const { run } = useStore()
  const [hover, setHover] = useState<number | null>(null)
  const today = useTodayMs()
  useTick(!!state.running)

  const goal = state.dailyGoalMs
  const pct = Math.min(100, (today / goal) * 100)
  const over = today - goal

  const keys = lastDays(DAYS_SHOWN)
  const values = keys.map((k) =>
    k === dayKey(new Date()) ? today : (state.days[k]?.totalMs ?? 0)
  )
  const peak = Math.max(goal * 1.25, ...values)
  const hitCount = values.filter((v) => v >= goal).length

  return (
    <div className={ui.page}>
      <div className={ui.pageHead}>
        <div>
          <h1 className={ui.title}>Timer</h1>
          <p className={ui.sub}>
            Goal {formatDuration(goal)} a day · {hitCount} of {DAYS_SHOWN} days hit
          </p>
        </div>
      </div>

      <div className={ui.panel}>
        <div className={p.timerPanel}>
          <div className={`${p.clock} ${state.running ? p.clockRunning : ''}`}>
            {formatClock(today)}
          </div>

          <button
            className={p.bigButton}
            onClick={() =>
              void run(async () => {
                if (state.running) await window.raeydzone.stopTimer()
                else await window.raeydzone.startTimer()
              })
            }
            aria-label={state.running ? 'Stop timer' : 'Start timer'}
          >
            {state.running ? <IconStop size={24} /> : <IconPlay size={24} />}
          </button>

          <div style={{ width: 'min(520px, 100%)' }}>
            <div className={ui.between} style={{ marginBottom: 6 }}>
              <span className={ui.faint}>
                {state.running ? 'Running' : 'Stopped'} · today
              </span>
              <span className={`${ui.faint} ${ui.mono}`}>
                {Math.round(pct)}%{over > 0 ? ` · +${formatDuration(over)}` : ''}
              </span>
            </div>
            <div className={ui.bar} style={{ height: 12 }}>
              <motion.div
                className={ui.barFill}
                animate={{ width: `${pct}%` }}
                transition={{ duration: 0.2, ease: [0.22, 0.61, 0.36, 1] }}
              />
            </div>
          </div>
        </div>
      </div>

      <div style={{ height: 'var(--s-4)' }} />

      <div className={ui.panel}>
        <div className={ui.sectionTitle}>Last {DAYS_SHOWN} days</div>
        <div className={p.chartWrap}>
          {hover !== null && (
            <div
              className={p.chartTip}
              style={{
                left: `${((hover + 0.5) / DAYS_SHOWN) * 100}%`,
                translate:
                  hover < 3 ? '0 0' : hover > DAYS_SHOWN - 4 ? '-100% 0' : '-50% 0'
              }}
            >
              <div className={p.chartTipDay}>
                {keys[hover] === dayKey(new Date()) ? 'Today' : dayLabel(keys[hover])}
              </div>
              <div className={p.chartTipVal}>
                {values[hover] === 0 ? 'Nothing logged' : formatDuration(values[hover])}
              </div>
              <div className={p.chartTipGoal}>
                {values[hover] >= goal
                  ? `Goal hit · +${formatDuration(values[hover] - goal)} over`
                  : `${Math.round((values[hover] / goal) * 100)}% of goal · ${formatDuration(
                      goal - values[hover]
                    )} short`}
              </div>
            </div>
          )}
          <div className={p.chart} onMouseLeave={() => setHover(null)}>
            <div className={p.goalLine} style={{ bottom: `${(goal / peak) * 100}%` }} />
            {values.map((ms, i) => (
              <motion.div
                key={keys[i]}
                className={`${p.chartCol} ${ms >= goal ? p.chartColHit : ''}`}
                initial={{ height: 0 }}
                animate={{ height: `${Math.max(2, (ms / peak) * 100)}%` }}
                transition={{ duration: 0.24, delay: i * 0.008 }}
                onMouseEnter={() => setHover(i)}
              />
            ))}
          </div>
        </div>
        <div className={ui.between} style={{ marginTop: 'var(--s-3)' }}>
          <span className={ui.faint}>{dayLabel(keys[0])}</span>
          <span className={ui.faint}>{dayLabel(keys[keys.length - 1])}</span>
        </div>
      </div>
    </div>
  )
}
