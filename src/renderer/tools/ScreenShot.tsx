import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { Video } from '@shared/types'
import { formatBytes } from '@shared/format'
import { copyShot, shotUrl, takeShot } from '../lib/shot'
import type { Shot, ShotExt } from '../lib/shot'
import { useStore } from '../state/store'
import { IconCamera, IconCopy, IconTrash } from '../components/Icons'
import { AreaPicker, useCaptureSources } from './capture'
import { Choice, Field, SaveForm, Segmented, TakeCard } from './kit'
import k from '../styles/soft.module.css'
import t from './tools.module.css'

interface Frame extends Shot {
  url: string
}

const FORMATS: { id: ShotExt; label: string }[] = [
  { id: 'png', label: 'PNG' },
  { id: 'jpg', label: 'JPG' }
]

const DELAYS = [
  { id: 0, label: 'None' },
  { id: 3, label: '3s' },
  { id: 5, label: '5s' },
  { id: 10, label: '10s' }
]

export default function ScreenShot({ projects }: { projects: Video[] }): ReactNode {
  const { run, notify } = useStore()
  const api = window.raeydzone

  const capture = useCaptureSources()
  const [ext, setExt] = useState<ShotExt>('png')
  const [delay, setDelay] = useState(0)

  const [countdown, setCountdown] = useState(0)
  const [busy, setBusy] = useState(false)
  const [frame, setFrame] = useState<Frame | null>(null)

  const latest = useRef<Frame | null>(null)
  latest.current = frame

  useEffect(
    () => () => {
      if (latest.current) URL.revokeObjectURL(latest.current.url)
    },
    []
  )

  const shoot = async (): Promise<void> => {
    if (!capture.sourceId) {
      notify('Pick something to capture first.', 'bad')
      return
    }
    setBusy(true)
    try {
      for (let left = delay; left > 0; left--) {
        setCountdown(left)
        await new Promise((resolve) => setTimeout(resolve, 1000))
      }
      setCountdown(0)
      const shot = await takeShot({ sourceId: capture.sourceId, region: capture.region, ext })
      setFrame((old) => {
        if (old) URL.revokeObjectURL(old.url)
        return { ...shot, url: shotUrl(shot) }
      })
    } catch (err) {
      notify((err as Error).message, 'bad')
    } finally {
      setCountdown(0)
      setBusy(false)
    }
  }

  const discard = useCallback((): void => {
    setFrame((old) => {
      if (old) URL.revokeObjectURL(old.url)
      return null
    })
  }, [])

  const copy = async (): Promise<void> => {
    if (!frame) return
    try {
      await copyShot(frame)
      notify('Copied to the clipboard')
    } catch (err) {
      notify((err as Error).message, 'bad')
    }
  }

  const save = async (project: string, name: string): Promise<void> => {
    if (!frame) return
    const saved = await run(() => api.saveRecording(project, name, frame.data, frame.ext))
    if (!saved) return
    notify('Saved ' + saved)
    discard()
  }

  return (
    <>
      <section className={t.panel}>
        <Field label="Capture">
          <Choice
            label="Screen or window"
            value={capture.sourceId}
            disabled={busy}
            options={capture.sources.map((s) => ({ id: s.id, label: s.name }))}
            onChange={capture.choose}
          />
        </Field>

        <Field label="Area">
          <AreaPicker capture={capture} disabled={busy} hint="Drag a box to capture · Esc to cancel" />
        </Field>

        <div className={t.pair}>
          <Field label="Format">
            <Segmented value={ext} options={FORMATS} disabled={busy} onChange={setExt} />
          </Field>
          <Field label="Delay">
            <Segmented value={delay} options={DELAYS} disabled={busy} onChange={setDelay} />
          </Field>
        </div>

        <div className={t.deck}>
          <span className={countdown > 0 ? `${t.status} ${t.clock} ${t.clockLive}` : t.status}>
            {countdown > 0 ? countdown : ext.toUpperCase() + (delay ? ` · ${delay}s delay` : '')}
          </span>
          <button
            className={`${k.btn} ${k.btnPrimary} ${t.action}`}
            disabled={busy}
            onClick={() => void shoot()}
          >
            <IconCamera size={15} />
            Capture
          </button>
        </div>
      </section>

      {frame && (
        <TakeCard
          title="Shot"
          meta={`${frame.width} × ${frame.height} · ${formatBytes(frame.data.byteLength)} · ${frame.ext.toUpperCase()}`}
          actions={
            <>
              <button className={`${k.btn} ${k.btnGhost}`} onClick={() => void copy()}>
                <IconCopy size={14} />
                Copy
              </button>
              <button className={`${k.btn} ${k.btnGhost}`} onClick={discard}>
                <IconTrash size={14} />
                Discard
              </button>
            </>
          }
        >
          <img className={t.media} src={frame.url} alt="" />
          <SaveForm key={frame.url} projects={projects} suggested="screenshot" onSave={save} />
        </TakeCard>
      )}
    </>
  )
}
