import { motion } from 'motion/react'
import { useState } from 'react'
import type { ReactNode } from 'react'
import type { Stream } from '@shared/types'
import { formatStamp } from '@shared/format'
import { DropZone, Prompt, RemoveDialog, Thumb } from '../components/Bits'
import {
  IconCalendar, IconCheck, IconFolder, IconImage, IconPlus, IconTrash
} from '../components/Icons'
import { lastStreamActivityAt, mediaUrl, useAppState, useStore } from '../state/store'
import mascot from '../assets/mascot.png'
import c from '../components/components.module.css'
import p from './pages.module.css'
import ui from '../styles/ui.module.css'

function toLocalInput(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export default function Streams(): ReactNode {
  const state = useAppState()
  const { run, rev, notify } = useStore()
  const [creating, setCreating] = useState(false)
  const [removing, setRemoving] = useState<Stream | null>(null)
  const api = window.raeydzone

  const upcoming = state.streams
    .filter((s) => !s.streamedAt)
    .slice()
    .sort((a, b) => {
      const at = a.scheduledAt ? new Date(a.scheduledAt).getTime() : Infinity
      const bt = b.scheduledAt ? new Date(b.scheduledAt).getTime() : Infinity
      return at === bt ? lastStreamActivityAt(b) - lastStreamActivityAt(a) : at - bt
    })
  const past = state.streams
    .filter((s) => s.streamedAt)
    .slice()
    .sort((a, b) => lastStreamActivityAt(b) - lastStreamActivityAt(a))

  const drop = async (stream: Stream, paths: string[], target: 'auto' | 'thumbnail') => {
    const res = await run(() => api.dropFiles('stream', stream.id, paths, target))
    if (!res) return
    if (res.moved.length) notify(`Moved ${res.moved.length} file(s)`)
    res.failed.forEach((f) => notify(`${f.name}: ${f.reason}`, 'bad'))
  }

  const card = (stream: Stream, i: number): ReactNode => {
    const due = stream.scheduledAt && new Date(stream.scheduledAt).getTime() < Date.now()
    return (
      <motion.div
        key={stream.id}
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.18, delay: Math.min(i * 0.02, 0.2) }}
      >
        <DropZone
          onDrop={(paths) => void drop(stream, paths, 'auto')}
          label="Drop into stream folder"
          className={p.streamCard}
        >
          <Thumb src={mediaUrl('stream', stream, stream.thumbnail, rev)} />

          <div className={p.streamHead}>
            <div className={p.cardName}>{stream.name}</div>
            <span
              className={`${c.statusPill} ${
                stream.streamedAt ? c.statusDone : due ? c.statusLive : ''
              }`}
            >
              {stream.streamedAt ? 'Streamed' : due ? 'Due' : 'Planned'}
            </span>
          </div>

          <div className={c.dateField}>
            <IconCalendar />
            <input
              type="datetime-local"
              className={c.dateInput}
              value={toLocalInput(stream.scheduledAt)}
              onChange={(e) =>
                void run(() =>
                  api.setSchedule(
                    stream.id,
                    e.target.value ? new Date(e.target.value).toISOString() : null
                  )
                )
              }
            />
          </div>

          {stream.streamedAt && (
            <div className={ui.faint}>Streamed {formatStamp(stream.streamedAt)}</div>
          )}

          <div className={p.streamActions}>
            <button
              className={`${ui.btn} ${stream.streamedAt ? '' : ui.btnPrimary}`}
              style={{ flex: 1, justifyContent: 'center' }}
              onClick={() => void run(() => api.setStreamed(stream.id, !stream.streamedAt))}
            >
              <IconCheck />
              {stream.streamedAt ? 'Reopen' : 'Mark streamed'}
            </button>
            <button
              className={`${ui.btn} ${p.iconBtn}`}
              title="Set thumbnail"
              onClick={async () => {
                const paths = await run(() => api.pickFiles('thumbnail'))
                if (paths?.length) await drop(stream, paths, 'thumbnail')
              }}
            >
              <IconImage />
            </button>
            <button
              className={`${ui.btn} ${p.iconBtn}`}
              title="Open folder"
              onClick={() => void run(() => api.reveal('stream', stream.id))}
            >
              <IconFolder />
            </button>
            <button
              className={`${ui.btn} ${p.iconBtn} ${ui.btnDanger}`}
              title="Remove this stream"
              onClick={() => setRemoving(stream)}
            >
              <IconTrash />
            </button>
          </div>
        </DropZone>
      </motion.div>
    )
  }

  return (
    <div className={ui.page}>
      <div className={ui.pageHead}>
        <div>
          <h1 className={ui.title}>Streams</h1>
          <p className={ui.sub}>
            {upcoming.length} upcoming · {past.length} done
          </p>
        </div>
        <button className={`${ui.btn} ${ui.btnPrimary}`} onClick={() => setCreating(true)}>
          <IconPlus />
          New stream
        </button>
      </div>

      {state.streams.length === 0 ? (
        <div className={ui.empty}>
          <img className={ui.emptyArt} src={mascot} alt="" />
          <div>No streams planned.</div>
        </div>
      ) : (
        <>
          {upcoming.length > 0 && (
            <>
              <div className={ui.sectionTitle}>Upcoming</div>
              <div className={ui.grid}>{upcoming.map(card)}</div>
            </>
          )}
          {past.length > 0 && (
            <>
              <div className={ui.divider} />
              <div className={ui.sectionTitle}>Streamed</div>
              <div className={ui.grid}>{past.map(card)}</div>
            </>
          )}
        </>
      )}

      <RemoveDialog
        open={removing !== null}
        name={removing?.name ?? ''}
        onOpenChange={(o) => !o && setRemoving(null)}
        onConfirm={(deleteFolder) => {
          if (!removing) return
          void run(
            () => api.removeStream(removing.id, deleteFolder),
            deleteFolder ? 'Folder moved to the Recycle Bin' : 'Removed — folder kept'
          )
        }}
      />

      <Prompt
        open={creating}
        title="New stream"
        placeholder="What are you streaming?"
        onConfirm={(name) => void run(() => api.createStream(name), 'Stream folder created')}
        onOpenChange={setCreating}
      />
    </div>
  )
}
