import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { ScreenSource, Video } from '@shared/types'
import { formatBytes } from '@shared/format'
import { LOOPBACK_ID, listAudioSources } from '../lib/recorder'
import type { AudioSource } from '../lib/recorder'
import { pickFormat, startClip } from '../lib/screen'
import type { Clip, ClipHandle } from '../lib/screen'
import { useAppState, useStore } from '../state/store'
import { IconStop, IconTrash } from '../components/Icons'
import { AreaPicker, useCaptureSources } from './capture'
import { Choice, EncoderPicker, Field, RecDot, SaveForm, Segmented, TakeCard, clock } from './kit'
import k from '../styles/soft.module.css'
import t from './tools.module.css'

interface Take extends Clip {
  url: string
}

const FPS = [24, 30, 60].map((n) => ({ id: n, label: n + ' fps' }))

export default function ScreenRecorder({ projects }: { projects: Video[] }): ReactNode {
  const { run, notify } = useStore()
  const { encoder } = useAppState()
  const api = window.raeydzone

  const capture = useCaptureSources()
  const [audioSources, setAudioSources] = useState<AudioSource[]>([])
  const [audioId, setAudioId] = useState<string>(LOOPBACK_ID)
  const [channels, setChannels] = useState(0)
  const [muted, setMuted] = useState(false)
  const [fps, setFps] = useState(30)

  const [recording, setRecording] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [take, setTake] = useState<Take | null>(null)

  const handle = useRef<ClipHandle | null>(null)
  const mounted = useRef(true)
  const format = pickFormat()

  useEffect(() => {
    void listAudioSources().then(setAudioSources)
  }, [])

  useEffect(() => {
    if (!recording) return
    const id = setInterval(() => setElapsed((n) => n + 1), 1000)
    return () => clearInterval(id)
  }, [recording])

  useEffect(() => {
    handle.current?.setMuted(muted)
  }, [muted])

  useEffect(() => {
    void api.showRegionFrame(capture.region).catch(() => undefined)
  }, [api, capture.region])

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      handle.current?.cancel()
      handle.current = null
      void window.raeydzone.showRegionFrame(null).catch(() => undefined)
    }
  }, [])

  const start = async (): Promise<void> => {
    if (!capture.sourceId) {
      notify('Pick something to record first.', 'bad')
      return
    }
    try {
      const active = await startClip({
        sourceId: capture.sourceId,
        region: capture.region,
        audioSourceId: audioId || null,
        fps
      })
      if (!mounted.current) {
        active.cancel()
        return
      }
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

  const save = async (project: string, name: string): Promise<void> => {
    if (!take) return
    const saved = await run(() => api.saveRecording(project, name, take.data, take.ext))
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
            disabled={recording}
            options={capture.sources.map((s: ScreenSource) => ({ id: s.id, label: s.name }))}
            onChange={capture.choose}
          />
        </Field>

        <Field label="Area">
          <AreaPicker capture={capture} disabled={recording} hint="Drag a box to record · Esc to cancel" />
        </Field>

        <Field label="Sound">
          <div className={t.inline}>
            <div className={t.grow}>
              <Choice
                label="Record sound from"
                value={audioId}
                disabled={recording}
                options={[
                  { id: '', label: 'Silent' },
                  ...audioSources.map((a) => ({ id: a.id, label: a.label }))
                ]}
                onChange={setAudioId}
              />
            </div>
            {audioId && (
              <button
                className={`${k.btn} ${muted ? k.btnDanger : k.btnGhost}`}
                onClick={() => setMuted((v) => !v)}
              >
                {muted ? 'Muted' : 'Mute'}
              </button>
            )}
          </div>
        </Field>

        <div className={t.pair}>
          <Field label="Frame rate">
            <Segmented value={fps} options={FPS} disabled={recording} onChange={setFps} />
          </Field>
          <Field label="Encoder">
            <EncoderPicker inline />
          </Field>
        </div>

        <div className={t.deck}>
          <span className={t.status}>
            {recording ? (
              <span className={`${t.status} ${t.clock} ${t.clockLive}`}>
                <RecDot live />
                {clock(elapsed)}
              </span>
            ) : (
              format.ext.toUpperCase() + ' · ' + (encoder.running === 'gpu' ? 'GPU' : 'CPU') + ' encode'
            )}
            {recording && channels === 1 && ' · mono'}
          </span>
          {recording ? (
            <button className={`${k.btn} ${k.btnDanger} ${t.action}`} onClick={() => void stop()}>
              <IconStop size={15} />
              Stop
            </button>
          ) : (
            <button className={`${k.btn} ${k.btnPrimary} ${t.action}`} onClick={() => void start()}>
              <RecDot />
              Record
            </button>
          )}
        </div>
      </section>

      {take && (
        <TakeCard
          title="Clip"
          meta={`${clock(take.seconds)} · ${formatBytes(take.data.byteLength)} · ${take.ext.toUpperCase()}`}
          actions={
            <button className={`${k.btn} ${k.btnGhost}`} onClick={discard}>
              <IconTrash size={14} />
              Discard
            </button>
          }
        >
          <video className={`${t.media} ${t.clip}`} src={take.url} controls />
          <SaveForm key={take.url} projects={projects} suggested="capture" onSave={save} />
        </TakeCard>
      )}
    </>
  )
}
