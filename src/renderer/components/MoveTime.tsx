import * as Dialog from '@radix-ui/react-dialog'
import { motion } from 'motion/react'
import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { dayKey, dayLabel, formatDuration } from '@shared/format'
import { useAppState, useStore, useTodayMs } from '../state/store'
import s from './components.module.css'
import ui from '../styles/ui.module.css'

const WINDOW_DAYS = 30
const MINUTE = 60_000

function shortDays(days: Record<string, { totalMs: number }>, goal: number): string[] {
  const today = new Date()
  const earliest = Object.keys(days).sort()[0]
  if (!earliest) return []
  const out: string[] = []
  for (let i = 1; i <= WINDOW_DAYS; i++) {
    const d = new Date(today)
    d.setDate(today.getDate() - i)
    const key = dayKey(d)
    if (key < earliest) break
    if ((days[key]?.totalMs ?? 0) < goal) out.push(key)
  }
  return out
}

export function MoveTime({ disabled }: { disabled: boolean }): ReactNode {
  const state = useAppState()
  const { run } = useStore()
  const today = useTodayMs()
  const [open, setOpen] = useState(false)
  const [target, setTarget] = useState<string | null>(null)
  const [minutes, setMinutes] = useState<string | null>(null)

  const goal = state.dailyGoalMs
  const candidates = useMemo(() => shortDays(state.days, goal), [state.days, goal])
  const chosen = target && candidates.includes(target) ? target : (candidates[0] ?? null)
  const have = chosen ? (state.days[chosen]?.totalMs ?? 0) : 0
  const gap = Math.max(0, goal - have)

  const amount =
    minutes === null
      ? Math.min(today, gap)
      : Math.min(today, Math.max(0, Math.round(Number(minutes) || 0) * MINUTE))

  const reset = (next: boolean): void => {
    setOpen(next)
    setTarget(null)
    setMinutes(null)
  }

  const submit = (): void => {
    if (!chosen || amount <= 0) return
    void run(async () => {
      await window.raeydzone.moveTime(dayKey(new Date()), chosen, amount)
      reset(false)
    }, `Moved ${formatDuration(amount)} to ${dayLabel(chosen)}`)
  }

  return (
    <Dialog.Root open={open} onOpenChange={reset}>
      <Dialog.Trigger asChild>
        <button
          className={ui.btn}
          disabled={disabled || today < MINUTE}
          title={
            disabled
              ? 'Stop the timer first'
              : 'Give time you worked today to an earlier day that fell short'
          }
        >
          Move time…
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className={s.overlay} />
        <Dialog.Content className={s.modal} aria-describedby={undefined} asChild>
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.16, ease: [0.22, 0.61, 0.36, 1] }}
          >
            <Dialog.Title className={s.modalTitle}>Move time to an earlier day</Dialog.Title>
            <p className={s.modalText}>
              Today has <b>{formatDuration(today)}</b>. Pick a day that fell short and
              give it some of that time.
            </p>

            {candidates.length === 0 ? (
              <p className={`${ui.faint} ${s.moveEmpty}`}>
                No earlier day is short of the goal.
              </p>
            ) : (
              <div className={s.dayList} role="radiogroup" aria-label="Day to top up">
                {candidates.map((key) => {
                  const ms = state.days[key]?.totalMs ?? 0
                  return (
                    <button
                      key={key}
                      role="radio"
                      aria-checked={key === chosen}
                      className={`${s.dayRow} ${key === chosen ? s.dayRowOn : ''}`}
                      onClick={() => {
                        setTarget(key)
                        setMinutes(null)
                      }}
                    >
                      <span>{dayLabel(key)}</span>
                      <span className={ui.faint}>
                        {formatDuration(ms)} of {formatDuration(goal)}
                      </span>
                    </button>
                  )
                })}
              </div>
            )}

            {chosen && (
              <>
                <div className={s.moveAmount}>
                  <label className={ui.faint} htmlFor="move-minutes">
                    Minutes to move
                  </label>
                  <input
                    id="move-minutes"
                    className={`${ui.input} ${s.moveInput}`}
                    type="number"
                    min={1}
                    value={minutes ?? String(Math.ceil(amount / MINUTE))}
                    onChange={(e) => setMinutes(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && submit()}
                  />
                </div>
                <p className={s.moveResult}>
                  {dayLabel(chosen)}: {formatDuration(have)} → <b>{formatDuration(have + amount)}</b>
                  <br />
                  Today: {formatDuration(today)} → <b>{formatDuration(today - amount)}</b>
                </p>
              </>
            )}

            <div className={s.modalActions}>
              <Dialog.Close asChild>
                <button className={`${ui.btn} ${ui.btnGhost}`}>Cancel</button>
              </Dialog.Close>
              <button
                className={`${ui.btn} ${ui.btnPrimary}`}
                onClick={submit}
                disabled={!chosen || amount <= 0}
              >
                Move
              </button>
            </div>
          </motion.div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
