import { AnimatePresence, motion } from 'motion/react'
import type { ReactNode } from 'react'
import mascot from '../assets/mascot.png'
import { useAppState, useStore, useTodayMs } from '../state/store'
import {
  IconClose, IconDashboard, IconLog, IconMaximize, IconMinimize, IconSettings,
  IconStream, IconTimer, IconTools, IconVideo
} from './Icons'
import s from './components.module.css'
import ui from '../styles/ui.module.css'

export type Route =
  | 'dashboard' | 'videos' | 'streams' | 'timer' | 'tools' | 'log' | 'settings'

export function TitleBar(): ReactNode {
  const api = window.raeydzone
  return (
    <div className={s.titlebar}>
      <div className={s.brand}>
        <img className={s.brandMark} src={mascot} alt="" />
        <span className={s.brandText}>
          RAEYD<b>ZONE</b>
        </span>
      </div>
      <div className={s.winButtons}>
        <button className={s.winButton} onClick={api.minimize} aria-label="Minimize">
          <IconMinimize />
        </button>
        <button className={s.winButton} onClick={api.maximize} aria-label="Maximize">
          <IconMaximize />
        </button>
        <button
          className={`${s.winButton} ${s.winClose}`}
          onClick={api.close}
          aria-label="Close"
        >
          <IconClose />
        </button>
      </div>
    </div>
  )
}

const NAV: { id: Route; label: string; icon: ReactNode }[] = [
  { id: 'dashboard', label: 'Dashboard', icon: <IconDashboard /> },
  { id: 'videos', label: 'Videos', icon: <IconVideo /> },
  { id: 'streams', label: 'Streams', icon: <IconStream /> },
  { id: 'timer', label: 'Timer', icon: <IconTimer /> },
  { id: 'tools', label: 'Tools', icon: <IconTools /> },
  { id: 'log', label: 'Log', icon: <IconLog /> },
  { id: 'settings', label: 'Settings', icon: <IconSettings /> }
]

export function Sidebar({
  route,
  onNavigate
}: {
  route: Route
  onNavigate: (r: Route) => void
}): ReactNode {
  const state = useAppState()
  const today = useTodayMs()
  const pct = Math.min(100, (today / state.dailyGoalMs) * 100)

  const counts: Partial<Record<Route, number>> = {
    videos: state.videos.filter((v) => Object.values(v.steps).some((t) => t === null)).length,
    streams: state.streams.filter((x) => !x.streamedAt).length
  }

  return (
    <nav className={s.sidebar}>
      {NAV.map((item) => (
        <button
          key={item.id}
          className={`${s.navItem} ${route === item.id ? s.navActive : ''}`}
          onClick={() => onNavigate(item.id)}
        >
          <span className={s.navIcon}>{item.icon}</span>
          {item.label}
          {counts[item.id] ? <span className={s.navCount}>{counts[item.id]}</span> : null}
        </button>
      ))}

      <div className={s.sidebarFoot}>
        {state.update.status === 'ready' && (
          <motion.button
            className={s.updateBtn}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            onClick={() => void window.raeydzone.installUpdate()}
          >
            Update to {state.update.version}
          </motion.button>
        )}
        {state.update.status === 'downloading' && (
          <div className={s.updateNote}>
            Downloading {state.update.version}… {state.update.percent}%
          </div>
        )}
        {state.update.status === 'error' && (
          <button
            className={s.updateFail}
            title={state.update.error ?? 'Update failed'}
            onClick={() => void window.raeydzone.checkUpdate()}
          >
            Update failed — retry
          </button>
        )}

        <div className={s.miniGoal}>
          <span>Today</span>
          <span className={ui.mono}>{Math.round(pct)}%</span>
        </div>
        <div className={ui.bar}>
          <motion.div
            className={ui.barFill}
            animate={{ width: `${pct}%` }}
            transition={{ duration: 0.2, ease: [0.22, 0.61, 0.36, 1] }}
          />
        </div>
      </div>
    </nav>
  )
}

export function Toasts(): ReactNode {
  const { toasts, dismiss } = useStore()
  return (
    <div className={s.toasts}>
      <AnimatePresence>
        {toasts.map((t) => (
          <motion.button
            key={t.id}
            className={`${s.toast} ${t.tone === 'bad' ? s.toastBad : ''}`}
            initial={{ opacity: 0, y: 12, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 6, scale: 0.97 }}
            transition={{ duration: 0.16, ease: [0.22, 0.61, 0.36, 1] }}
            onClick={() => dismiss(t.id)}
          >
            {t.text}
          </motion.button>
        ))}
      </AnimatePresence>
    </div>
  )
}
