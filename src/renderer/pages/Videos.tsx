import { motion } from 'motion/react'
import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { STEP_IDS } from '@shared/types'
import type { Video } from '@shared/types'
import { formatStamp } from '@shared/format'
import {
  CardSteps, DropZone, Prompt, RemoveDialog, Thumb, Timeline, Toggle
} from '../components/Bits'
import { LogRows } from '../components/LogFeed'
import { FilesPanel } from '../components/FilesPanel'
import {
  IconFolder, IconImage, IconPlus, IconPremiere, IconSearch, IconTrash, IconVideo
} from '../components/Icons'
import c from '../components/components.module.css'
import {
  byProgress, isComplete, lastProgressAt, mediaUrl, useAppState, useStore
} from '../state/store'
import mascot from '../assets/mascot.png'
import p from './pages.module.css'
import ui from '../styles/ui.module.css'

export default function Videos(): ReactNode {
  const state = useAppState()
  const { run, rev } = useStore()
  const [openId, setOpenId] = useState<string | null>(null)
  const [showDone, setShowDone] = useState(false)
  const [creating, setCreating] = useState(false)
  const [query, setQuery] = useState('')

  const open = state.videos.find((v) => v.id === openId) ?? null

  const list = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return (showDone ? state.videos : state.videos.filter((v) => !isComplete(v)))
      .filter((v) => !needle || v.name.toLowerCase().includes(needle))
      .slice()
      .sort(byProgress)
  }, [state.videos, showDone, query])

  if (open) return <Detail video={open} onBack={() => setOpenId(null)} />

  const create = (name: string): void => {
    void run(() => window.raeydzone.createVideo(name), 'Project folder created')
  }

  return (
    <div className={ui.page}>
      <div className={ui.pageHead}>
        <div>
          <h1 className={ui.title}>Videos</h1>
          <p className={ui.sub}>
            {list.length} shown · {state.videos.filter(isComplete).length} completed
          </p>
        </div>
        <div className={ui.row}>
          <div className={c.searchField}>
            <IconSearch />
            <input
              className={c.searchInput}
              placeholder="Search projects…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <Toggle checked={showDone} onChange={setShowDone} label="Show completed" />
          <button className={`${ui.btn} ${ui.btnPrimary}`} onClick={() => setCreating(true)}>
            <IconPlus />
            New video
          </button>
        </div>
      </div>

      {list.length === 0 ? (
        <div className={ui.empty}>
          <img className={ui.emptyArt} src={mascot} alt="" />
          <div>Nothing in the pipeline.</div>
          <button className={`${ui.btn} ${ui.btnPrimary}`} onClick={() => setCreating(true)}>
            <IconPlus />
            Create your first video
          </button>
        </div>
      ) : (
        <div className={ui.grid}>
          {list.map((video, i) => (
            <motion.button
              key={video.id}
              className={p.card}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.18, delay: Math.min(i * 0.02, 0.2) }}
              onClick={() => setOpenId(video.id)}
            >
              <Thumb src={mediaUrl('video', video, video.thumbnail, rev)} />
              <div className={p.cardName}>{video.name}</div>
              <CardSteps steps={video.steps} />
              <div className={p.cardMeta}>
                <span>{STEP_IDS.filter((s) => video.steps[s]).length} / 6 done</span>
                {video.missing ? (
                  <span style={{ color: 'var(--accent-hot)' }}>folder missing</span>
                ) : (
                  <span>{formatStamp(new Date(lastProgressAt(video)).toISOString())}</span>
                )}
              </div>
            </motion.button>
          ))}
        </div>
      )}

      <Prompt
        open={creating}
        title="New video"
        placeholder="What is this video?"
        onConfirm={create}
        onOpenChange={setCreating}
      />
    </div>
  )
}

function Detail({ video, onBack }: { video: Video; onBack: () => void }): ReactNode {
  const state = useAppState()
  const { run, rev, notify } = useStore()
  const [renaming, setRenaming] = useState(false)
  const [removing, setRemoving] = useState(false)
  const api = window.raeydzone

  const report = (res: { moved: { via: string }[]; failed: { name: string; reason: string }[] }) => {
    if (res.moved.length) {
      const copied = res.moved.filter((m) => m.via === 'copied').length
      notify(
        copied
          ? `${res.moved.length} file(s) added — ${copied} copied, source was locked`
          : `Moved ${res.moved.length} file(s)`
      )
    }
    res.failed.forEach((f) => notify(`${f.name}: ${f.reason}`, 'bad'))
  }

  const drop = async (paths: string[], target: 'auto' | 'thumbnail' | 'baseVideo') => {
    const res = await run(() => api.dropFiles('video', video.id, paths, target))
    if (res) report(res)
  }

  const paste = async (): Promise<void> => {
    const res = await run(() => api.pasteClipboard('video', video.id))
    if (res) report(res)
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (!e.ctrlKey || e.key.toLowerCase() !== 'v') return
      const el = document.activeElement
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return
      e.preventDefault()
      void paste()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [video.id])

  const pick = async (target: 'auto' | 'thumbnail' | 'baseVideo'): Promise<void> => {
    const paths = await run(() => api.pickFiles(target))
    if (paths?.length) await drop(paths, target)
  }

  const entries = state.log.filter((l) => l.targetId === video.id)

  return (
    <div className={ui.page}>
      <button className={p.backLink} onClick={onBack}>
        ← All videos
      </button>

      <div className={ui.pageHead}>
        <div>
          <h1 className={ui.title}>{video.name}</h1>
          <p className={ui.sub}>
            Created {formatStamp(video.createdAt)}
            {video.missing ? ' · folder missing on disk' : ''}
          </p>
        </div>
        <div className={ui.row}>
          <button className={ui.btn} onClick={() => setRenaming(true)}>
            Rename
          </button>
          <button
            className={`${ui.btn} ${ui.btnDanger}`}
            title="Remove this video"
            onClick={() => setRemoving(true)}
          >
            <IconTrash />
            Remove
          </button>
          <button className={ui.btn} onClick={() => void run(() => api.reveal('video', video.id))}>
            <IconFolder />
            Folder
          </button>
          <button
            className={`${ui.btn} ${ui.btnPremiere}`}
            disabled={!state.hasPremiereTemplate}
            title={
              state.hasPremiereTemplate
                ? 'Open in Premiere Pro'
                : 'No template.prproj installed — see Settings'
            }
            onClick={async () => {
              const err = await run(() => api.openPremiere(video.id))
              if (err) notify(err, 'bad')
            }}
          >
            <IconPremiere />
            Launch project
          </button>
        </div>
      </div>

      <div className={p.detail}>
        <div>
          <div className={ui.panel}>
            <div className={ui.sectionTitle}>Progress</div>
            <Timeline
              steps={video.steps}
              onToggle={(id) => void run(() => api.toggleStep(video.id, id))}
            />
          </div>

          <div style={{ height: 'var(--s-4)' }} />

          <DropZone onDrop={(paths) => void drop(paths, 'auto')} label="Drop — sorted automatically">
            <div className={ui.panel} style={{ border: 'none', background: 'transparent' }}>
              <div className={ui.sectionTitle}>Drop files</div>
              <p className={ui.muted} style={{ fontSize: 13 }}>
                Video files move into <b>footage</b>, everything else into <b>assets</b>.
                Files are moved, not copied.
              </p>
              <div className={ui.row} style={{ marginTop: 'var(--s-3)' }}>
                <button className={ui.btn} onClick={() => void pick('auto')}>
                  Choose files…
                </button>
                <button className={ui.btn} onClick={() => void paste()}>
                  Paste from clipboard
                </button>
                <span className={ui.faint}>or press Ctrl+V anywhere on this page</span>
              </div>
            </div>
          </DropZone>

          <div style={{ height: 'var(--s-4)' }} />

          <FilesPanel kind="video" id={video.id} />

          <div style={{ height: 'var(--s-4)' }} />

          <div className={ui.panel}>
            <div className={ui.sectionTitle}>Activity</div>
            {entries.length === 0 ? (
              <p className={ui.faint}>Nothing logged yet.</p>
            ) : (
              <div className={p.logList}>
                <LogRows entries={entries.slice(0, 40)} />
              </div>
            )}
          </div>
        </div>

        <div className={p.detailSide}>
          <DropZone
            onDrop={(paths) => void drop(paths, 'thumbnail')}
            label="Drop to set thumbnail"
            className={p.slot}
          >
            <div className={p.slotHead}>
              <span className={ui.sectionTitle} style={{ margin: 0 }}>
                Thumbnail
              </span>
              <button className={`${ui.btn} ${ui.btnGhost}`} onClick={() => void pick('thumbnail')}>
                <IconImage />
                Set
              </button>
            </div>
            <Thumb
              src={mediaUrl('video', video, video.thumbnail, rev)}
              hint="Drop an image here"
            />
            {video.thumbnail && <div className={p.slotFile}>{video.thumbnail}</div>}
          </DropZone>

          <DropZone
            onDrop={(paths) => void drop(paths, 'baseVideo')}
            label="Drop to set base video"
            className={p.slot}
          >
            <div className={p.slotHead}>
              <span className={ui.sectionTitle} style={{ margin: 0 }}>
                Base video
              </span>
              <button className={`${ui.btn} ${ui.btnGhost}`} onClick={() => void pick('baseVideo')}>
                <IconVideo size={15} />
                Set
              </button>
            </div>
            {video.baseVideo ? (
              <div className={ui.row}>
                <span className={ui.tag + ' ' + ui.tagDone}>filled</span>
                <span className={p.slotFile} style={{ margin: 0 }}>
                  {video.baseVideo}
                </span>
              </div>
            ) : (
              <p className={ui.faint}>Empty — drop the base cut here.</p>
            )}
          </DropZone>
        </div>
      </div>

      <RemoveDialog
        open={removing}
        name={video.name}
        onOpenChange={setRemoving}
        onConfirm={async (deleteFolder) => {
          const ok = await run(
            () => api.removeVideo(video.id, deleteFolder),
            deleteFolder ? 'Folder moved to the Recycle Bin' : 'Removed — folder kept'
          )
          if (ok !== null) onBack()
        }}
      />

      <Prompt
        open={renaming}
        title="Rename video"
        placeholder="New name"
        initial={video.name}
        confirmLabel="Rename"
        onConfirm={(name) =>
          void run(() => api.renameVideo(video.id, name), 'Renamed — folder moved too')
        }
        onOpenChange={setRenaming}
      />
    </div>
  )
}
