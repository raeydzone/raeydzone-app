import { useCallback, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { Region, ScreenSource } from '@shared/types'
import { IconClose, IconRect } from '../components/Icons'
import { useStore } from '../state/store'
import t from './tools.module.css'

export interface CaptureTarget {
  sources: ScreenSource[]
  sourceId: string
  region: Region | null
  choose: (id: string) => void
  pickRegion: (hint: string) => Promise<void>
  clearRegion: () => void
}

export function useCaptureSources(): CaptureTarget {
  const { run, notify } = useStore()
  const api = window.raeydzone
  const [sources, setSources] = useState<ScreenSource[]>([])
  const [sourceId, setSourceId] = useState('')
  const [region, setRegion] = useState<Region | null>(null)

  useEffect(() => {
    void run(() => api.screenSources()).then((found) => {
      if (!found) return
      setSources(found)
      setSourceId((current) => current || (found[0]?.id ?? ''))
    })
  }, [api, run])

  const choose = useCallback((id: string) => {
    setSourceId(id)
    setRegion(null)
  }, [])

  // A box is drawn on one display, so the capture source has to follow it there.
  const pickRegion = async (hint: string): Promise<void> => {
    const picked = await run(() => api.selectRegion(hint))
    if (!picked) return
    const found = await run(() => api.screenSources())
    if (!found) return
    setSources(found)
    const match = found.find((s) => s.displayId === picked.displayId)
    if (!match) {
      notify('That display is no longer available. Pick the area again.', 'bad')
      return
    }
    setRegion(picked)
    setSourceId(match.id)
  }

  return { sources, sourceId, region, choose, pickRegion, clearRegion: () => setRegion(null) }
}

export function AreaPicker({
  capture,
  disabled,
  hint
}: {
  capture: CaptureTarget
  disabled: boolean
  hint: string
}): ReactNode {
  const { region } = capture
  return (
    <div className={t.area}>
      <span className={`${t.areaText} ${region ? t.areaOn : ''}`}>
        {region ? region.width + ' × ' + region.height : 'Whole screen'}
      </span>
      {region && (
        <button
          className={t.miniBtn}
          disabled={disabled}
          title="Clear the box and use the whole screen"
          onClick={capture.clearRegion}
        >
          <IconClose size={12} />
        </button>
      )}
      <button className={t.miniBtn} disabled={disabled} onClick={() => void capture.pickRegion(hint)}>
        <IconRect size={13} />
        {region ? 'Redraw' : 'Draw box'}
      </button>
    </div>
  )
}
