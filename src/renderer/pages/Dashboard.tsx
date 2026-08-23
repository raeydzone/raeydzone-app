import { motion } from 'motion/react'
import type { ReactNode } from 'react'
import { STEP_IDS } from '@shared/types'
import { formatClock, formatDuration, formatStamp } from '@shared/format'
import { LogRows } from '../components/LogFeed'
import { StepPips, Thumb } from '../components/Bits'
import { IconPlay, IconStop } from '../components/Icons'
import {
  byProgress, isComplete, mediaUrl, useAppState, useStore, useTick, useTodayMs
} from '../state/store'
import mascot from '../assets/mascot.png'
import type { Route } from '../components/Chrome'
import p from './pages.module.css'
import ui from '../styles/ui.module.css'

export default function Dashboard({
  onNavigate
}: {
  onNavigate: (r: Route) => void
}): ReactNode {
  const state = useAppState()
  const { run, rev } = useStore()
  const today = useTodayMs()
  useTick(!!state.running)

  const pct = Math.min(100, (today / state.dailyGoalMs) * 100)
  const active = state.videos
    .filter((v) => !isComplete(v))
    .slice()
    .sort(byProgress)
    .slice(0, 6)
  const nextStream = state.streams
    .filter((s) => !s.streamedAt && s.scheduledAt)
    .sort((a, b) => (a.scheduledAt! < b.scheduledAt! ? -1 : 1))[0]

  return (
    <div className={ui.page}>
      <div className={ui.pageHead}>
        <div>
          <h1 className={ui.title}>Dashboard</h1>
          <p className={ui.sub}>
            {active.length} in the pipeline · {state.videos.filter(isComplete).length} shipped
          </p>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 'var(--s-4)' }}>
        <div className={ui.panel}>
          <div className={ui.between}>
            <div className={ui.sectionTitle} style={{ margin: 0 }}>
              Today
            </div>
            <button
              className={`${ui.btn} ${state.running ? '' : ui.btnPrimary}`}
              onClick={() =>
                void run(async () => {
                  if (state.running) await window.raeydzone.stopTimer()
                  else await window.raeydzone.startTimer()
                })
              }
            >
              {state.running ? <IconStop size={15} /> : <IconPlay size={15} />}
              {state.running ? 'Stop' : 'Start'}
            </button>
          </div>

          <div
            className={`${p.clock} ${state.running ? p.clockRunning : ''}`}
            style={{ fontSize: 46, margin: 'var(--s-4) 0 var(--s-3)' }}
          >
            {formatClock(today)}
          </div>

          <div className={ui.bar} style={{ height: 10 }}>
            <motion.div
              className={ui.barFill}
              animate={{ width: `${pct}%` }}
              transition={{ duration: 0.2, ease: [0.22, 0.61, 0.36, 1] }}
            />
          </div>
          <div className={ui.between} style={{ marginTop: 6 }}>
            <span className={ui.faint}>Goal {formatDuration(state.dailyGoalMs)}</span>
            <span className={`${ui.faint} ${ui.mono}`}>{Math.round(pct)}%</span>
          </div>
        </div>

        <div className={ui.panel}>
          <div className={ui.sectionTitle}>Next stream</div>
          {nextStream ? (
            <>
              <div className={p.cardName}>{nextStream.name}</div>
              <div className={ui.faint} style={{ marginTop: 6 }}>
                {formatStamp(nextStream.scheduledAt)}
              </div>
              <button
                className={ui.btn}
                style={{ marginTop: 'var(--s-4)' }}
                onClick={() => onNavigate('streams')}
              >
                Open streams
              </button>
            </>
          ) : (
            <p className={ui.faint}>Nothing scheduled.</p>
          )}
        </div>
      </div>

      <div style={{ height: 'var(--s-5)' }} />

      <div className={ui.between} style={{ marginBottom: 'var(--s-3)' }}>
        <div className={ui.sectionTitle} style={{ margin: 0 }}>
          In progress
        </div>
        <button className={`${ui.btn} ${ui.btnGhost}`} onClick={() => onNavigate('videos')}>
          All videos →
        </button>
      </div>

      {active.length === 0 ? (
        <div className={ui.empty}>
          <img className={ui.emptyArt} src={mascot} alt="" />
          <div>Pipeline is clear.</div>
        </div>
      ) : (
        <div className={ui.grid}>
          {active.map((video, i) => (
            <motion.button
              key={video.id}
              className={p.card}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.18, delay: Math.min(i * 0.02, 0.2) }}
              onClick={() => onNavigate('videos')}
            >
              <Thumb src={mediaUrl('video', video, video.thumbnail, rev)} />
              <div className={p.cardName}>{video.name}</div>
              <StepPips steps={video.steps} />
              <div className={p.cardMeta}>
                <span>{STEP_IDS.filter((s) => video.steps[s]).length} / 6</span>
              </div>
            </motion.button>
          ))}
        </div>
      )}

      <div style={{ height: 'var(--s-5)' }} />

      <div className={ui.panel}>
        <div className={ui.between} style={{ marginBottom: 'var(--s-3)' }}>
          <div className={ui.sectionTitle} style={{ margin: 0 }}>
            Recent activity
          </div>
          <button className={`${ui.btn} ${ui.btnGhost}`} onClick={() => onNavigate('log')}>
            Full log →
          </button>
        </div>
        {state.log.length === 0 ? (
          <p className={ui.faint}>Nothing logged yet.</p>
        ) : (
          <div className={p.logList}>
            <LogRows entries={state.log.slice(0, 8)} />
          </div>
        )}
      </div>
    </div>
  )
}
