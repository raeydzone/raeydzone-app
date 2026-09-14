import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { Region, ScreenSource, Video } from '@shared/types'
import { formatBytes } from '@shared/format'
import { copyShot, shotUrl, takeShot } from '../lib/shot'
import type { Shot, ShotExt } from '../lib/shot'
import { useStore } from '../state/store'
import { IconCamera, IconClose, IconCopy, IconImage, IconTrash } from './Icons'
import p from '../pages/pages.module.css'
import ui from '../styles/ui.module.css'

interface Frame extends Shot {
  url: string
}

export default function ScreenShot({ projects }: { projects: Video[] }): ReactNode {
  const { run, notify } = useStore()
  const api = window.raeydzone

  const [sources, setSources] = useState<ScreenSource[]>([])
  const [sourceId, setSourceId] = useState('')
  const [region, setRegion] = useState<Region | null>(null)
  const [ext, setExt] = useState<ShotExt>('png')
  const [delay, setDelay] = useState(0)

  const [countdown, setCountdown] = useState(0)
  const [busy, setBusy] = useState(false)
  const [frame, setFrame] = useState<Frame | null>(null)
  const [name, setName] = useState('')
  const [project, setProject] = useState('')

  const latest = useRef<Frame | null>(null)
  latest.current = frame

  useEffect(() => {
    void run(() => api.screenSources()).then((found) => {
      if (!found) return
      setSources(found)
      setSourceId((current) => current || (found[0]?.id ?? ''))
    })
  }, [api, run])

  useEffect(() => {
    if (!projects.length) return
    setProject((current) => current || projects[0].id)
  }, [projects])

  useEffect(
    () => () => {
      if (latest.current) URL.revokeObjectURL(latest.current.url)
    },
    []
  )

  const pickRegion = async (): Promise<void> => {
    const picked = await run(() => api.selectRegion('Drag a box to capture · Esc to cancel'))
    if (!picked) return
    setRegion(picked)
    const match = sources.find((s) => s.displayId === picked.displayId)
    if (match) setSourceId(match.id)
  }

  const capture = async (): Promise<void> => {
    if (!sourceId) {
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
      const shot = await takeShot({ sourceId, region, ext })
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

  const save = async (): Promise<void> => {
    if (!frame || !project) return
    const saved = await run(() =>
      api.saveRecording(project, name || 'screenshot', frame.data, frame.ext)
    )
    if (!saved) return
    notify('Saved ' + saved)
    discard()
    setName('')
  }

  return (
    <>
      <section className={p.tool}>
        <header className={p.toolHead}>
          <span className={p.toolIcon}>
            <IconImage size={15} />
          </span>
          <div>
            <h2 className={p.toolName}>Screenshot</h2>
            <p className={p.toolDesc}>
              Grab the whole screen or a box you draw, then save or copy it.
            </p>
          </div>
        </header>

        <div className={p.toolControls}>
          <label className={p.toolField}>
            <span className={p.fieldLabel}>Capture</span>
            <select
              className={ui.input}
              value={sourceId}
              disabled={busy}
              onChange={(e) => setSourceId(e.target.value)}
            >
              {sources.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>

          <label className={p.toolField}>
            <span className={p.fieldLabel}>Format</span>
            <select
              className={ui.input}
              value={ext}
              disabled={busy}
              onChange={(e) => setExt(e.target.value as ShotExt)}
            >
              <option value="png">PNG</option>
              <option value="jpg">JPG</option>
            </select>
          </label>
        </div>

        <div className={p.toolControls}>
          <div className={p.toolField}>
            <span className={p.fieldLabel}>Area</span>
            <div className={ui.row}>
              <button className={ui.btn} disabled={busy} onClick={() => void pickRegion()}>
                Draw box…
              </button>
              <span className={p.fieldValue}>
                {region ? region.width + ' × ' + region.height : 'Whole screen'}
              </span>
              {region && !busy && (
                <button
                  className={`${ui.btn} ${ui.btnGhost}`}
                  title="Clear the box and capture the whole screen"
                  onClick={() => setRegion(null)}
                >
                  <IconClose size={13} />
                </button>
              )}
            </div>
          </div>

          <label className={p.toolField}>
            <span className={p.fieldLabel}>Delay</span>
            <select
              className={ui.input}
              value={delay}
              disabled={busy}
              onChange={(e) => setDelay(Number(e.target.value))}
            >
              <option value={0}>None</option>
              <option value={3}>3 seconds</option>
              <option value={5}>5 seconds</option>
              <option value={10}>10 seconds</option>
            </select>
          </label>
        </div>

        <footer className={p.toolFoot}>
          <span className={p.fieldValue}>
            {countdown > 0 ? 'Capturing in ' + countdown + '…' : ext.toUpperCase()}
          </span>
          <button
            className={`${ui.btn} ${ui.btnPrimary}`}
            disabled={busy}
            onClick={() => void capture()}
          >
            <IconCamera size={14} />
            Capture
          </button>
        </footer>
      </section>

      {frame && (
        <section className={p.tool}>
          <header className={p.toolHead}>
            <div style={{ flex: 1 }}>
              <h2 className={p.toolName}>Shot</h2>
              <p className={p.toolDesc}>
                {frame.width} × {frame.height} · {formatBytes(frame.data.byteLength)} ·{' '}
                {frame.ext.toUpperCase()}
              </p>
            </div>
            <button className={`${ui.btn} ${ui.btnGhost}`} onClick={() => void copy()}>
              <IconCopy size={14} />
              Copy
            </button>
            <button className={`${ui.btn} ${ui.btnGhost}`} onClick={discard}>
              <IconTrash size={14} />
              Discard
            </button>
          </header>

          <img className={p.shotPreview} src={frame.url} alt="" />

          <div className={p.toolControls}>
            <label className={p.toolField}>
              <span className={p.fieldLabel}>Name</span>
              <input
                className={ui.input}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="screenshot"
              />
            </label>

            <label className={p.toolField}>
              <span className={p.fieldLabel}>Save into</span>
              <select
                className={ui.input}
                value={project}
                onChange={(e) => setProject(e.target.value)}
              >
                {projects.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <button
            className={`${ui.btn} ${ui.btnPrimary} ${p.saveButton}`}
            disabled={!project}
            onClick={() => void save()}
          >
            Save to assets
          </button>
        </section>
      )}
    </>
  )
}
