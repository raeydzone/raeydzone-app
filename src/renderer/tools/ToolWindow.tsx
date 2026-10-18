import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import { byProgress, useAppState } from '../state/store'
import { toolMeta } from './catalog'
import type { Tool } from './catalog'
import { ToolHeader } from './kit'
import ScreenRecorder from './ScreenRecorder'
import ScreenShot from './ScreenShot'
import SoundRecorder from './SoundRecorder'
import t from './tools.module.css'

export default function ToolWindow({ tool }: { tool: Tool }): ReactNode {
  const state = useAppState()
  const projects = state.videos.slice().sort(byProgress)
  const body = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const node = body.current
    if (!node) return
    const fit = (): void => window.raeydzone.fitTool(node.offsetTop + node.offsetHeight)
    const watch = new ResizeObserver(fit)
    watch.observe(node)
    return () => watch.disconnect()
  }, [state.ready])

  if (!state.ready) return <p className={t.waiting}>Set a root folder in the main window first.</p>

  return (
    <div ref={body} className={t.window}>
      <ToolHeader tool={toolMeta(tool)} />
      {tool === 'sound' && <SoundRecorder projects={projects} />}
      {tool === 'screen' && <ScreenRecorder projects={projects} />}
      {tool === 'shot' && <ScreenShot projects={projects} />}
    </div>
  )
}
