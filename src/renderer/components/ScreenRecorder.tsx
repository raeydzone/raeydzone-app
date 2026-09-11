import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { Region, ScreenSource, Video } from '@shared/types'
import { formatBytes } from '@shared/format'
import { LOOPBACK_ID, listAudioSources } from '../lib/recorder'
import type { AudioSource } from '../lib/recorder'
import { pickFormat, startClip } from '../lib/screen'
import type { Clip, ClipHandle } from '../lib/screen'
import { useStore } from '../state/store'
import { IconClose, IconStop, IconTrash, IconVideo } from './Icons'
import p from '../pages/pages.module.css'
import ui from '../styles/ui.module.css'

const clock = (seconds: number): string => {
  const s = Math.max(0, Math.round(seconds))
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0')
}

interface Take extends Clip {
  url: string
}

export default function ScreenRecorder({ projects }: { projects: Video[] }): ReactNode {
  const { run, notify } = useStore()
  const api = window.raeydzone

  const [sources, setSources] = useState<ScreenSource[]>([])
  const [sourceId, setSourceId] = useState('')
  const [region, setRegion] = useState<Region | null>(null)
  const [audioSources, setAudioSources] = useState<AudioSource[]>([])
  const [audioId, setAudioId] = useState<string>(LOOPBACK_ID)
  const [channels, setChannels] = useState(0)
  const [muted, setMuted] = useState(false)
  const [fps, setFps] = useState(30)

  const [recording, setRecording] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [take, setTake] = useState<Take | null>(null)
  const [name, setName] = useState('')
  const [project, setProject] = useState('')

  const handle = useRef<ClipHandle | null>(null)
  const format = pickFormat()

  useEffect(() => {
    void run(() => api.screenSources()).then((found) => {
      if (!found) return
      setSources(found)
      setSourceId((current) => current || (found[0]?.id ?? ''))
    })
  }, [api, run])

  useEffect(() => {
    void listAudioSources().then(setAudioSources)
  }, [])

  useEffect(() => {
    if (!projects.length) return
    setProject((current) => current || projects[0].id)
  }, [projects])

  useEffect(() => {
    if (!recording) return
    const id = setInterval(() => setElapsed((n) => n + 1), 1000)
    return () => clearInterval(id)
  }, [recording])

  useEffect(() => {
    handle.current?.setMuted(muted)
  }, [muted])

  const pickRegion = async (): Promise<void> => {
    const picked = await run(() => api.selectRegion())
    if (!picked) return
    setRegion(picked)
    const match = sources.find((s) => s.displayId === picked.displayId)
    if (match) setSourceId(match.id)
  }

  const start = async (): Promise<void> => {
    if (!sourceId) {
      notify('Pick something to record first.', 'bad')
      return
    }
    try {
      const active = await startClip({
        sourceId,
        region,
        audioSourceId: audioId || null,
        fps
      })
      active.setMuted(muted)
      handle.current = active
      setChannels(active.audioChannels)
      setElapsed(0)
      setRecording(true)
    } catch (err) {
      notify((err as Error).message, 'bad')
    }
  }

  const stop = async (): Promise<void> => {
    const active = handle.current
    if (!active) return
    handle.current = null
    setRecording(false)
    try {
      const clip = await active.stop()
      const url = URL.createObjectURL(new Blob([clip.data], { type: 'video/' + clip.ext }))
      setTake((old) => {
        if (old) URL.revokeObjectURL(old.url)
        return { ...clip, url }
      })
    } catch (err) {
      notify((err as Error).message, 'bad')
    }
  }

  const discard = useCallback((): void => {
    setTake((old) => {
      if (old) URL.revokeObjectURL(old.url)
      return null
    })
  }, [])

  const save = async (): Promise<void> => {
    if (!take || !project) return
    const saved = await run(() =>
      api.saveRecording(project, name || 'capture', take.data, take.ext)
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
            <IconVideo size={15} />
          </span>
          <div>
            <h2 className={p.toolName}>Screen recorder</h2>
            <p className={p.toolDesc}>
              Record the whole screen or a box you draw, with desktop audio.
            </p>
          </div>
        </header>

        <div className={p.toolControls}>
          <label className={p.toolField}>
            <span className={p.fieldLabel}>Capture</span>
            <select
              className={ui.input}
              value={sourceId}
              disabled={recording}
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
            <span className={p.fieldLabel}>Frame rate</span>
            <select
              className={ui.input}
              value={fps}
              disabled={recording}
              onChange={(e) => setFps(Number(e.target.value))}
            >
              <option value={24}>24 fps</option>
              <option value={30}>30 fps</option>
              <option value={60}>60 fps</option>
            </select>
          </label>
        </div>

        <div className={p.toolControls}>
          <div className={p.toolField}>
            <span className={p.fieldLabel}>Area</span>
            <div className={ui.row}>
              <button
                className={ui.btn}
                disabled={recording}
                onClick={() => void pickRegion()}
              >
                Draw box…
              </button>
              <span className={p.fieldValue}>
                {region ? region.width + ' × ' + region.height : 'Whole screen'}
              </span>
              {region && !recording && (
                <button
                  className={`${ui.btn} ${ui.btnGhost}`}
                  title="Clear the box and record the whole screen"
                  onClick={() => setRegion(null)}
                >
                  <IconClose size={13} />
                </button>
              )}
            </div>
          </div>

          <div className={p.toolField}>
            <span className={p.fieldLabel}>Sound</span>
            <div className={ui.row}>
              <select
                className={ui.input}
                value={audioId}
                disabled={recording}
                onChange={(e) => setAudioId(e.target.value)}
              >
                <option value="">Silent</option>
                {audioSources.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.label}
                  </option>
                ))}
              </select>
              {audioId && (
                <button
                  className={`${ui.btn} ${muted ? ui.btnDanger : ui.btnGhost}`}
                  onClick={() => setMuted((v) => !v)}
                >
                  {muted ? 'Muted' : 'Mute'}
                </button>
              )}
            </div>
          </div>
        </div>

        <footer className={p.toolFoot}>
          <span className={p.fieldValue}>
            {recording
              ? 'Recording · ' + clock(elapsed) + (channels === 1 ? ' · mono' : '')
              : format.ext.toUpperCase()}
          </span>
          {recording ? (
            <button className={`${ui.btn} ${ui.btnDanger}`} onClick={() => void stop()}>
              <IconStop size={14} />
              Stop
            </button>
          ) : (
            <button className={`${ui.btn} ${ui.btnPrimary}`} onClick={() => void start()}>
              <IconVideo size={14} />
              Record
            </button>
          )}
        </footer>
      </section>

      {take && (
        <section className={p.tool}>
          <header className={p.toolHead}>
            <div style={{ flex: 1 }}>
              <h2 className={p.toolName}>Clip</h2>
              <p className={p.toolDesc}>
                {clock(take.seconds)} · {formatBytes(take.data.byteLength)} ·{' '}
                {take.ext.toUpperCase()}
              </p>
            </div>
            <button className={`${ui.btn} ${ui.btnGhost}`} onClick={discard}>
              <IconTrash size={14} />
              Discard
            </button>
          </header>

          <video className={p.clipPreview} src={take.url} controls />

          <div className={p.toolControls}>
            <label className={p.toolField}>
              <span className={p.fieldLabel}>Name</span>
              <input
                className={ui.input}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="capture"
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
