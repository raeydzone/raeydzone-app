import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { formatBytes, formatClock } from '@shared/format'
import { IconExternal, IconMic, IconStop, IconTrash } from '../components/Icons'
import { byProgress, useAppState, useStore } from '../state/store'
import { LOOPBACK_ID, listAudioSources, startRecording } from '../lib/recorder'
import type { AudioSource, RecorderHandle } from '../lib/recorder'
import p from './pages.module.css'
import ui from '../styles/ui.module.css'

interface Take {
  data: Uint8Array<ArrayBuffer>
  url: string
  seconds: number
}

export default function ToolsPage({ popped = false }: { popped?: boolean }): ReactNode {
  const state = useAppState()
  const { run, notify } = useStore()
  const api = window.raeydzone

  const [sources, setSources] = useState<AudioSource[]>([])
  const [sourceId, setSourceId] = useState(LOOPBACK_ID)
  const [gain, setGain] = useState(100)
  const [recording, setRecording] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [take, setTake] = useState<Take | null>(null)
  const [name, setName] = useState('')
  const [project, setProject] = useState('')

  const handle = useRef<RecorderHandle | null>(null)
  const canvas = useRef<HTMLCanvasElement | null>(null)
  const frame = useRef(0)
  const startedAt = useRef(0)

  const projects = state.videos.slice().sort(byProgress)

  useEffect(() => {
    void listAudioSources().then(setSources)
  }, [])

  useEffect(() => {
    if (!project && projects.length) setProject(projects[0].id)
  }, [projects, project])

  const draw = useCallback(() => {
    const node = canvas.current
    const rec = handle.current
    if (!node || !rec) return
    const ctx = node.getContext('2d')
    if (!ctx) return

    const width = (node.width = node.clientWidth * devicePixelRatio)
    const height = (node.height = node.clientHeight * devicePixelRatio)
    rec.readLevels()

    ctx.clearRect(0, 0, width, height)
    ctx.lineWidth = 2 * devicePixelRatio
    ctx.strokeStyle = '#ff2a2a'
    ctx.shadowBlur = 12 * devicePixelRatio
    ctx.shadowColor = 'rgba(225,29,33,0.5)'
    ctx.beginPath()

    const step = width / rec.levels.length
    for (let i = 0; i < rec.levels.length; i++) {
      const v = rec.levels[i] / 128 - 1
      const y = height / 2 + v * (height / 2) * 0.9
      if (i === 0) ctx.moveTo(0, y)
      else ctx.lineTo(i * step, y)
    }
    ctx.stroke()

    setElapsed(Date.now() - startedAt.current)
    frame.current = requestAnimationFrame(draw)
  }, [])

  const begin = async (): Promise<void> => {
    if (take) discard()
    try {
      const rec = await startRecording(sourceId, gain / 100)
      handle.current = rec
      startedAt.current = Date.now()
      setRecording(true)
      frame.current = requestAnimationFrame(draw)
    } catch (err) {
      notify((err as Error).message, 'bad')
    }
  }

  const finish = async (): Promise<void> => {
    const rec = handle.current
    if (!rec) return
    cancelAnimationFrame(frame.current)
    const data = await rec.stop()
    handle.current = null
    setRecording(false)

    const seconds = (data.byteLength - 44) / (rec.sampleRate * rec.channels * 2)
    if (seconds < 0.05) {
      notify('That take was empty — no audio was playing.', 'bad')
      return
    }
    const url = URL.createObjectURL(new Blob([data], { type: 'audio/wav' }))
    setTake({ data, url, seconds })
    setName('recording_' + new Date().toISOString().slice(11, 19).replace(/:/g, ''))
  }

  const discard = (): void => {
    if (take) URL.revokeObjectURL(take.url)
    setTake(null)
  }

  useEffect(
    () => () => {
      cancelAnimationFrame(frame.current)
      handle.current?.cancel()
    },
    []
  )

  const save = async (): Promise<void> => {
    if (!take || !project) return
    const saved = await run(
      () => api.saveRecording(project, name || 'recording', take.data),
      undefined
    )
    if (saved) {
      notify(`Saved ${saved} to assets`)
      discard()
    }
  }

  return (
    <div className={ui.page} style={popped ? { padding: 'var(--s-4)' } : undefined}>
      {!popped && (
        <div className={ui.pageHead}>
          <div>
            <h1 className={ui.title}>Tools</h1>
            <p className={ui.sub}>Grab a sound straight off the desktop.</p>
          </div>
          <button className={ui.btn} onClick={() => void run(() => api.popoutTools())}>
            <IconExternal />
            Pop out
          </button>
        </div>
      )}

      <div className={ui.panel}>
        <div className={ui.sectionTitle}>Audio recorder</div>

        <label className={p.toolField}>
          <span className={ui.faint}>Source</span>
          <select
            className={ui.input}
            value={sourceId}
            disabled={recording}
            onChange={(e) => setSourceId(e.target.value)}
          >
            {sources.map((src) => (
              <option key={src.id} value={src.id}>
                {src.label}
              </option>
            ))}
          </select>
        </label>

        <label className={p.toolField}>
          <span className={ui.faint}>Level · {gain}%</span>
          <input
            type="range"
            className={p.slider}
            min={0}
            max={200}
            step={5}
            value={gain}
            onChange={(e) => {
              const next = Number(e.target.value)
              setGain(next)
              handle.current?.setGain(next / 100)
            }}
          />
        </label>

        <canvas ref={canvas} className={`${p.wave} ${recording ? p.waveLive : ''}`} />

        <div className={ui.between} style={{ marginTop: 'var(--s-4)' }}>
          <span className={`${p.clock} ${recording ? p.clockRunning : ''}`} style={{ fontSize: 28 }}>
            {formatClock(recording ? elapsed : (take?.seconds ?? 0) * 1000)}
          </span>
          {recording ? (
            <button className={`${ui.btn} ${ui.btnDanger}`} onClick={() => void finish()}>
              <IconStop size={15} />
              Stop
            </button>
          ) : (
            <button className={`${ui.btn} ${ui.btnPrimary}`} onClick={() => void begin()}>
              <IconMic />
              Record
            </button>
          )}
        </div>
      </div>

      {take && (
        <>
          <div style={{ height: 'var(--s-4)' }} />
          <div className={ui.panel}>
            <div className={ui.between} style={{ marginBottom: 'var(--s-3)' }}>
              <div className={ui.sectionTitle} style={{ margin: 0 }}>
                Take · {formatBytes(take.data.byteLength)}
              </div>
              <button className={`${ui.btn} ${ui.btnGhost}`} onClick={discard}>
                <IconTrash size={14} />
                Discard
              </button>
            </div>

            <audio className={p.player} src={take.url} controls />

            <label className={p.toolField}>
              <span className={ui.faint}>Name</span>
              <input
                className={ui.input}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="recording"
              />
            </label>

            <label className={p.toolField}>
              <span className={ui.faint}>Save into</span>
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

            <button
              className={`${ui.btn} ${ui.btnPrimary}`}
              style={{ width: '100%', justifyContent: 'center', marginTop: 'var(--s-4)' }}
              disabled={!project}
              onClick={() => void save()}
            >
              Save to assets
            </button>
            {projects.length === 0 && (
              <p className={ui.faint} style={{ marginTop: 'var(--s-2)' }}>
                Create a video project first — recordings save into its assets folder.
              </p>
            )}
          </div>
        </>
      )}
    </div>
  )
}
