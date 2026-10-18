import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { Video } from '@shared/types'
import { formatBytes } from '@shared/format'
import { IconPlay, IconStop, IconTrash } from '../components/Icons'
import { useStore } from '../state/store'
import { LOOPBACK_ID, listAudioSources, startRecording } from '../lib/recorder'
import type { AudioSource, RecorderHandle } from '../lib/recorder'
import { Choice, Field, Range, RecDot, SaveForm, TakeCard, clock } from './kit'
import k from '../styles/soft.module.css'
import t from './tools.module.css'

const BARS = 150

interface Take {
  data: Uint8Array<ArrayBuffer>
  url: string
  seconds: number
  peaks: number[]
  name: string
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
    <div className={t.player}>
      <audio
        ref={audio}
        src={src}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
      />
      <button className={t.playButton} onClick={toggle} aria-label={playing ? 'Pause' : 'Play'}>
        {playing ? <IconStop size={13} /> : <IconPlay size={13} />}
      </button>
      <div className={t.seek} onClick={scrub}>
        <div className={t.seekFill} style={{ width: `${pct}%` }} />
      </div>
      <span className={t.playerTime}>
        {clock(time)} / {clock(seconds)}
      </span>
    </div>
  )
}

export default function SoundRecorder({ projects }: { projects: Video[] }): ReactNode {
  const { run, notify } = useStore()
  const api = window.raeydzone

  const [sources, setSources] = useState<AudioSource[]>([])
  const [sourceId, setSourceId] = useState(LOOPBACK_ID)
  const [gain, setGain] = useState(100)
  const [recording, setRecording] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [take, setTake] = useState<Take | null>(null)

  const handle = useRef<RecorderHandle | null>(null)
  const canvas = useRef<HTMLCanvasElement | null>(null)
  const peaks = useRef<number[]>([])
  const frame = useRef(0)
  const startedAt = useRef(0)

  useEffect(() => {
    void listAudioSources().then(setSources)
  }, [])

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

  const discard = (): void => {
    if (take) URL.revokeObjectURL(take.url)
    setTake(null)
    peaks.current = []
    if (canvas.current) drawWave(canvas.current, [], false)
  }

  const begin = async (): Promise<void> => {
    if (take) discard()
    try {
      const rec = await startRecording(sourceId, gain / 100)
      handle.current = rec
      peaks.current = []
      startedAt.current = Date.now()
      setElapsed(0)
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
    const name = 'recording_' + new Date().toTimeString().slice(0, 8).replace(/:/g, '')
    setTake({ data, url, seconds, peaks: [...peaks.current], name })
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

  const save = async (project: string, name: string): Promise<void> => {
    if (!take) return
    const saved = await run(() => api.saveRecording(project, name, take.data, 'wav'))
    if (saved) {
      notify(`Saved ${saved} to assets`)
      discard()
    }
  }

  return (
    <>
      <section className={t.panel}>
        <Field label="Source">
          <Choice
            label="Record from"
            value={sourceId}
            disabled={recording}
            options={sources.map((src) => ({ id: src.id, label: src.label }))}
            onChange={setSourceId}
          />
        </Field>

        <Field label="Level" value={gain + '%'}>
          <Range
            label="Level"
            value={gain}
            min={0}
            max={200}
            step={5}
            onChange={(next) => {
              setGain(next)
              handle.current?.setGain(next / 100)
            }}
          />
        </Field>

        <div className={`${t.waveBox} ${recording ? t.waveLive : ''}`}>
          <canvas ref={canvas} className={t.wave} />
          {!recording && !take && <span className={t.waveHint}>The waveform draws here while you record</span>}
        </div>

        <div className={t.deck}>
          <span className={`${t.status} ${t.clock} ${recording ? t.clockLive : ''}`}>
            {recording && <RecDot live />}
            {clock(recording ? elapsed / 1000 : (take?.seconds ?? 0))}
          </span>
          {recording ? (
            <button className={`${k.btn} ${k.btnDanger} ${t.action}`} onClick={() => void finish()}>
              <IconStop size={15} />
              Stop
            </button>
          ) : (
            <button className={`${k.btn} ${k.btnPrimary} ${t.action}`} onClick={() => void begin()}>
              <RecDot />
              Record
            </button>
          )}
        </div>
      </section>

      {take && (
        <TakeCard
          title="Take"
          meta={`${clock(take.seconds)} · ${formatBytes(take.data.byteLength)} · WAV`}
          actions={
            <button className={`${k.btn} ${k.btnGhost}`} onClick={discard}>
              <IconTrash size={14} />
              Discard
            </button>
          }
        >
          <TakePlayer src={take.url} seconds={take.seconds} />
          <SaveForm
            key={take.url}
            projects={projects}
            suggested={take.name}
            onSave={save}
          />
        </TakeCard>
      )}
    </>
  )
}
