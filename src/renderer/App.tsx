import { AnimatePresence, motion } from 'motion/react'
import { useState } from 'react'
import type { ReactNode } from 'react'
import { Sidebar, TitleBar, Toasts } from './components/Chrome'
import type { Route } from './components/Chrome'
import Dashboard from './pages/Dashboard'
import LogPage from './pages/LogPage'
import SettingsPage from './pages/SettingsPage'
import Setup from './pages/Setup'
import Streams from './pages/Streams'
import TimerPage from './pages/TimerPage'
import ToolsPage from './pages/ToolsPage'
import Videos from './pages/Videos'
import { useStore } from './state/store'
import app from './App.module.css'

const POPPED_VIEW = new URLSearchParams(window.location.search).get('view')

export default function App(): ReactNode {
  const { state } = useStore()
  const [route, setRoute] = useState<Route>(
    () => (localStorage.getItem('route') as Route | null) ?? 'dashboard'
  )

  const navigate = (next: Route): void => {
    localStorage.setItem('route', next)
    setRoute(next)
  }

  if (!state) {
    return (
      <div className={app.shell}>
        <TitleBar />
      </div>
    )
  }

  if (POPPED_VIEW === 'tools') {
    return (
      <div className={app.shell}>
        <TitleBar />
        <main className={app.main}>
          {state.ready ? (
            <ToolsPage popped />
          ) : (
            <p className={app.poppedNote}>Set a root folder in the main window first.</p>
          )}
        </main>
        <Toasts />
      </div>
    )
  }

  if (!state.ready) {
    return (
      <div className={app.shell}>
        <TitleBar />
        <Setup />
        <Toasts />
      </div>
    )
  }

  const pages: Record<Route, ReactNode> = {
    dashboard: <Dashboard onNavigate={navigate} />,
    videos: <Videos />,
    streams: <Streams />,
    timer: <TimerPage />,
    tools: <ToolsPage />,
    log: <LogPage />,
    settings: <SettingsPage />
  }

  return (
    <div className={app.shell}>
      <TitleBar />
      <div className={app.body}>
        <Sidebar route={route} onNavigate={navigate} />
        <main className={app.main}>
          <AnimatePresence mode="wait">
            <motion.div
              key={route}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.16, ease: [0.22, 0.61, 0.36, 1] }}
            >
              {pages[route]}
            </motion.div>
          </AnimatePresence>
        </main>
      </div>
      <Toasts />
    </div>
  )
}
