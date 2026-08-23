import type { ReactNode } from 'react'
import { formatBytes, formatDuration } from '@shared/format'
import { IconFolder, IconPremiere } from '../components/Icons'
import { useAppState, useStore } from '../state/store'
import p from './pages.module.css'
import ui from '../styles/ui.module.css'

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
