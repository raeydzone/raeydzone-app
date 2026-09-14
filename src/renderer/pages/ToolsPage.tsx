import type { ReactNode } from 'react'
import { IconExternal } from '../components/Icons'
import ScreenRecorder from '../components/ScreenRecorder'
import ScreenShot from '../components/ScreenShot'
import SoundRecorder from '../components/SoundRecorder'
import { byProgress, useAppState, useStore } from '../state/store'
import p from './pages.module.css'
import ui from '../styles/ui.module.css'

export type Tool = 'sound' | 'screen' | 'shot'

export default function ToolsPage({ tool }: { tool?: Tool }): ReactNode {
  const state = useAppState()
  const { run } = useStore()
  const api = window.raeydzone

  const projects = state.videos.slice().sort(byProgress)

  if (tool) {
    return (
      <div className={`${ui.page} ${p.toolsPage} ${p.toolsPopped}`}>
        {tool === 'sound' && <SoundRecorder projects={projects} />}
        {tool === 'screen' && <ScreenRecorder projects={projects} />}
        {tool === 'shot' && <ScreenShot projects={projects} />}
      </div>
    )
  }

  const popOut = (which: Tool): ReactNode => (
    <button
      className={`${ui.btn} ${ui.btnGhost} ${p.toolPop}`}
      title="Open this tool in its own window"
      onClick={() => void run(() => api.popoutTool(which))}
    >
      <IconExternal size={13} />
      Pop out
    </button>
  )

  return (
    <div className={`${ui.page} ${p.toolsPage}`}>
      <div className={ui.pageHead}>
        <div>
          <h1 className={ui.title}>Tools</h1>
          <p className={ui.sub}>Small utilities that sit beside the pipeline.</p>
        </div>
      </div>

      <div className={p.toolGroup}>
        {popOut('sound')}
        <SoundRecorder projects={projects} />
      </div>

      <div className={p.toolGroup}>
        {popOut('screen')}
        <ScreenRecorder projects={projects} />
      </div>

      <div className={p.toolGroup}>
        {popOut('shot')}
        <ScreenShot projects={projects} />
      </div>
    </div>
  )
}
