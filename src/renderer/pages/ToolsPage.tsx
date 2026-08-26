import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { formatBytes } from '@shared/format'
import {
  IconExternal, IconMic, IconPlay, IconStop, IconTrash
} from '../components/Icons'
import { byProgress, useAppState, useStore } from '../state/store'
import { LOOPBACK_ID, listAudioSources, startRecording } from '../lib/recorder'
import type { AudioSource, RecorderHandle } from '../lib/recorder'
import p from './pages.module.css'
import ui from '../styles/ui.module.css'

const BARS = 150

interface Take {
  data: Uint8Array<ArrayBuffer>
  url: string
  seconds: number
  peaks: number[]
}

const clock = (seconds: number): string => {
  const total = Math.max(0, Math.floor(seconds))
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

function drawWave(
  node: HTMLCanvasElement,
  peaks: number[],
  live: boolean
): void {
  const ctx = node.getContext('2d')
  if (!ctx) return
  const dpr = window.devicePixelRatio || 1
  const width = (node.width = node.clientWidth * dpr)
  const height = (node.height = node.clientHeight * dpr)
  const mid = height / 2

  ctx.clearRect(0, 0, width, height)

  ctx.strokeStyle = 'rgba(255,255,255,0.07)'
  ctx.lineWidth = dpr
  ctx.beginPath()
  ctx.moveTo(0, mid)
  ctx.lineTo(width, mid)
  ctx.stroke()

  if (!peaks.length) return

  const slot = width / BARS
  const barWidth = Math.max(dpr, slot * 0.55)

  for (let i = 0; i < peaks.length; i++) {
    const amp = Math.min(1, peaks[i] * 1.6)
    const h = Math.max(dpr * 1.5, amp * (height * 0.46))
    const x = i * slot
    const fade = live ? 0.35 + 0.65 * (i / peaks.length) : 1
    ctx.fillStyle = `rgba(${225 + amp * 30}, ${29 + amp * 20}, ${33 + amp * 20}, ${fade})`
    ctx.fillRect(x, mid - h, barWidth, h * 2)
  }
}

function TakePlayer({ src, seconds }: { src: string; seconds: number }): ReactNode {
  const audio = useRef<HTMLAudioElement | null>(null)
  const [playing, setPlaying] = useState(false)
  const [time, setTime] = useState(0)

  const toggle = (): void => {
    const el = audio.current
    if (!el) return
    if (el.paused) void el.play()
    else el.pause()
  }

  const scrub = (e: React.MouseEvent<HTMLDivElement>): void => {
    const el = audio.current
    if (!el) return
    const box = e.currentTarget.getBoundingClientRect()
    el.currentTime = ((e.clientX - box.left) / box.width) * seconds
  }

  const pct = seconds > 0 ? Math.min(100, (time / seconds) * 100) : 0

  return (
    <div className={p.player}>
      <audio
        ref={audio}
        src={src}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
      />
      <button className={p.playButton} onClick={toggle} aria-label={playing ? 'Pause' : 'Play'}>
        {playing ? <IconStop size={13} /> : <IconPlay size={13} />}
      </button>
      <div className={p.seek} onClick={scrub}>
        <div className={p.seekFill} style={{ width: `${pct}%` }} />
      </div>
      <span className={p.playerTime}>
        {clock(time)} / {clock(seconds)}
      </span>
    </div>
  )
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
  const peaks = useRef<number[]>([])
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
    if (node && rec) {
      rec.readLevels()
      let peak = 0
      for (let i = 0; i < rec.levels.length; i++) {
        const v = Math.abs(rec.levels[i] / 128 - 1)
        if (v > peak) peak = v
      }
      peaks.current.push(peak)
      if (peaks.current.length > BARS) peaks.current.shift()
      drawWave(node, peaks.current, true)
      setElapsed(Date.now() - startedAt.current)
    }
    frame.current = requestAnimationFrame(draw)
  }, [])

  const begin = async (): Promise<void> => {
    if (take) discard()
    try {
      const rec = await startRecording(sourceId, gain / 100)
      handle.current = rec
      peaks.current = []
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
    setTake({ data, url, seconds, peaks: [...peaks.current] })
    setName('recording_' + new Date().toISOString().slice(11, 19).replace(/:/g, ''))
  }

  const discard = (): void => {
    if (take) URL.revokeObjectURL(take.url)
    setTake(null)
    peaks.current = []
    if (canvas.current) drawWave(canvas.current, [], false)
  }

  useEffect(() => {
    if (recording || !canvas.current) return
    drawWave(canvas.current, take?.peaks ?? [], false)
  }, [recording, take])

  useEffect(
    () => () => {
      cancelAnimationFrame(frame.current)
      handle.current?.cancel()
    },
    []
  )

  const save = async (): Promise<void> => {
    if (!take || !project) return
    const saved = await run(() => api.saveRecording(project, name || 'recording', take.data))
    if (saved) {
      notify(`Saved ${saved} to assets`)
      discard()
    }
  }

  return (
    <div className={`${ui.page} ${p.toolsPage} ${popped ? p.toolsPopped : ''}`}>
      {!popped && (
        <div className={ui.pageHead}>
          <div>
            <h1 className={ui.title}>Tools</h1>
            <p className={ui.sub}>Small utilities that sit beside the pipeline.</p>
          </div>
          <button className={ui.btn} onClick={() => void run(() => api.popoutTools())}>
            <IconExternal />
            Pop out
          </button>
        </div>
      )}

      <section className={p.tool}>
        <header className={p.toolHead}>
          <span className={p.toolIcon}>
            <IconMic size={15} />
          </span>
          <div>
            <h2 className={p.toolName}>Sound recorder</h2>
            <p className={p.toolDesc}>Capture whatever Windows is playing right now.</p>
          </div>
        </header>

        <div className={p.toolControls}>
          <label className={p.toolField}>
            <span className={p.fieldLabel}>Source</span>
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
            <span className={p.fieldLabel}>
              Level <b className={p.fieldValue}>{gain}%</b>
            </span>
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
        </div>

        <div className={`${p.waveBox} ${recording ? p.waveLive : ''}`}>
          <canvas ref={canvas} className={p.wave} />
          {!recording && !take && <span className={p.waveHint}>Waveform appears here</span>}
        </div>

        <footer className={p.toolFoot}>
          <span className={`${p.recClock} ${recording ? p.recClockLive : ''}`}>
            {clock(recording ? elapsed / 1000 : (take?.seconds ?? 0))}
          </span>
          {recording ? (
            <button className={`${ui.btn} ${ui.btnDanger}`} onClick={() => void finish()}>
              <IconStop size={14} />
              Stop
            </button>
          ) : (
            <button className={`${ui.btn} ${ui.btnPrimary}`} onClick={() => void begin()}>
              <IconMic size={14} />
              Record
            </button>
          )}
        </footer>
      </section>

      {take && (
        <section className={p.tool}>
          <header className={p.toolHead}>
            <div style={{ flex: 1 }}>
              <h2 className={p.toolName}>Take</h2>
              <p className={p.toolDesc}>
                {clock(take.seconds)} · {formatBytes(take.data.byteLength)} · WAV
              </p>
            </div>
            <button className={`${ui.btn} ${ui.btnGhost}`} onClick={discard}>
              <IconTrash size={14} />
              Discard
            </button>
          </header>

          <TakePlayer src={take.url} seconds={take.seconds} />

          <div className={p.toolControls}>
            <label className={p.toolField}>
              <span className={p.fieldLabel}>Name</span>
              <input
                className={ui.input}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="recording"
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
          {projects.length === 0 && (
            <p className={p.toolDesc} style={{ marginTop: 'var(--s-2)' }}>
              Create a video project first — recordings save into its assets folder.
            </p>
          )}
        </section>
      )}
    </div>
  )
}
