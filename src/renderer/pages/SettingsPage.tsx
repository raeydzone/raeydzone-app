import { useCallback, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { ArchivePreview, UpdateState } from '@shared/types'
import { formatBytes, formatDuration } from '@shared/format'
import { Toggle } from '../components/Bits'
import { IconFolder, IconPremiere } from '../components/Icons'
import { useAppState, useStore } from '../state/store'
import p from './pages.module.css'
import ui from '../styles/ui.module.css'

function describeUpdate(u: UpdateState): string {
  switch (u.status) {
    case 'checking':
      return 'checking for updates…'
    case 'downloading':
      return `downloading ${u.version} — ${u.percent}%`
    case 'ready':
      return `${u.version} downloaded and ready to install`
    case 'error':
      return `last check failed — ${u.error ?? 'unknown error'}`
    default:
      return 'up to date'
  }
}

function describeArchive(preview: ArchivePreview | null): string {
  if (!preview) return 'measuring…'
  if (preview.candidates.length === 0) return 'nothing old enough to archive'
  return `${preview.candidates.length} ready · ${formatBytes(preview.bytes)} → Recycle Bin`
}

function ArchiveSetting(): ReactNode {
  const state = useAppState()
  const { run, notify } = useStore()
  const api = window.raeydzone
  const [preview, setPreview] = useState<ArchivePreview | null>(null)
  const [busy, setBusy] = useState(false)

  const scan = useCallback(async (): Promise<void> => {
    setPreview(await run(() => api.archivePreview()))
  }, [api, run])

  useEffect(() => {
    void scan()
  }, [scan])

  const archiveNow = async (): Promise<void> => {
    setBusy(true)
    const res = await run(() => api.runArchive())
    setBusy(false)
    if (res) notify(`Archived ${res.count} · ${formatBytes(res.bytes)} to the Recycle Bin`)
    await scan()
  }

  return (
    <div className={p.settingRow}>
      <div>
        <div className={p.settingLabel}>Auto-archive finished videos</div>
        <div className={p.settingHint}>
          Footage, assets and the base video of a finished project go to the Recycle Bin
          once it is old enough. Thumbnail, steps and history stay. Empty the bin to get
          the disk space back.
        </div>
        <div className={ui.faint} style={{ marginTop: 6 }}>
          {describeArchive(preview)}
        </div>
      </div>
      <div className={ui.row}>
        <Toggle
          checked={state.autoArchive}
          onChange={(v) => void run(() => api.setArchive(v, state.archiveAfterDays))}
          label="on"
        />
        <input
          className={ui.input}
          style={{ width: 70 }}
          type="number"
          min={1}
          step={1}
          defaultValue={state.archiveAfterDays}
          onBlur={(e) => {
            const days = Number(e.target.value)
            if (days > 0)
              void run(() => api.setArchive(state.autoArchive, days), 'Archive age updated')
          }}
        />
        <span className={ui.faint}>days old</span>
        <button
          className={ui.btn}
          disabled={busy || !preview || preview.candidates.length === 0}
          onClick={() => void archiveNow()}
        >
          Archive now
        </button>
      </div>
    </div>
  )
}

export default function SettingsPage(): ReactNode {
  const state = useAppState()
  const { run, refresh, notify } = useStore()
  const api = window.raeydzone

  const changeRoot = async (): Promise<void> => {
    const picked = await run(() => api.pickRoot())
    if (!picked) return
    const ok = await run(() => api.setRoot(picked), 'Root folder changed')
    if (ok) await refresh()
  }

  return (
    <div className={ui.page}>
      <div className={ui.pageHead}>
        <div>
          <h1 className={ui.title}>Settings</h1>
          <p className={ui.sub}>Where things live and how hard you have to work.</p>
        </div>
      </div>

      <div className={ui.panel}>
        <div className={p.settingRow}>
          <div>
            <div className={p.settingLabel}>Root folder</div>
            <div className={p.settingHint}>
              Everything RaeydZone manages lives here. Changing it re-points the app — it
              never moves your files.
            </div>
            <div className={p.pathBox} style={{ marginTop: 'var(--s-3)' }}>
              {state.rootPath ?? 'Not set'}
            </div>
            <div className={ui.faint} style={{ marginTop: 6 }}>
              {state.freeBytes !== null ? `${formatBytes(state.freeBytes)} free` : ''}
              {state.removableRoot ? ' · removable drive' : ''}
            </div>
          </div>
          <div className={ui.row}>
            <button className={ui.btn} onClick={() => void run(() => api.openRoot())}>
              <IconFolder />
              Open
            </button>
            <button className={ui.btn} onClick={changeRoot}>
              Change…
            </button>
          </div>
        </div>

        <div className={p.settingRow}>
          <div>
            <div className={p.settingLabel}>Premiere template</div>
            <div className={p.settingHint}>
              Save one blank project from Premiere Pro as <b>template.prproj</b> inside the
              <b> .raeydzone</b> folder. Every new video copies it.
            </div>
          </div>
          <div className={ui.row}>
            <span className={`${ui.tag} ${state.hasPremiereTemplate ? ui.tagOk : ''}`}>
              {state.hasPremiereTemplate ? 'installed' : 'missing'}
            </span>
            <button
              className={`${ui.btn} ${ui.btnPremiere}`}
              onClick={() => void run(() => api.openTemplateFolder())}
            >
              <IconPremiere />
              Open folder
            </button>
          </div>
        </div>

        <div className={p.settingRow}>
          <div>
            <div className={p.settingLabel}>Daily goal</div>
            <div className={p.settingHint}>
              The progress bar hits 100% here. Currently {formatDuration(state.dailyGoalMs)}.
            </div>
          </div>
          <div className={ui.row}>
            <input
              className={ui.input}
              style={{ width: 90 }}
              type="number"
              min={5}
              step={5}
              defaultValue={Math.round(state.dailyGoalMs / 60000)}
              onBlur={(e) => {
                const mins = Number(e.target.value)
                if (mins > 0) void run(() => api.setGoal(mins * 60000), 'Goal updated')
              }}
            />
            <span className={ui.faint}>minutes</span>
          </div>
        </div>

        <ArchiveSetting />

        <div className={p.settingRow}>
          <div>
            <div className={p.settingLabel}>Updates</div>
            <div className={p.settingHint}>
              Version {state.appVersion} · {describeUpdate(state.update)}
            </div>
          </div>
          <div className={ui.row}>
            {state.update.status === 'ready' ? (
              <button
                className={`${ui.btn} ${ui.btnPrimary}`}
                onClick={() => void api.installUpdate()}
              >
                Install {state.update.version}
              </button>
            ) : (
              <button
                className={ui.btn}
                disabled={state.update.status === 'checking'}
                onClick={() => void run(() => api.checkUpdate(), 'Checking for updates…')}
              >
                Check now
              </button>
            )}
            <button className={`${ui.btn} ${ui.btnGhost}`} onClick={() => void api.openUpdateLog()}>
              Log
            </button>
          </div>
        </div>

        <div className={p.settingRow}>
          <div>
            <div className={p.settingLabel}>Rescan folder</div>
            <div className={p.settingHint}>
              Picks up folders added by hand and flags entries whose folder has vanished.
            </div>
          </div>
          <button
            className={ui.btn}
            onClick={async () => {
              const res = await run(() => api.rescan())
              if (res) notify(`${res.added} added · ${res.missing} missing`)
            }}
          >
            Rescan
          </button>
        </div>
      </div>
    </div>
  )
}
