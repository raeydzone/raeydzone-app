import { useCallback, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { ArchivePreview, UpdateState } from '@shared/types'
import { formatBytes, formatDuration } from '@shared/format'
import { Toggle } from '../components/Bits'
import { IconFolder, IconPremiere } from '../components/Icons'
import { useAppState, useStore } from '../state/store'
import { SpendOverview } from '../studio/ui/Spend'
import { ClaudeAccount, OpenRouterKey } from './AiSettings'
import k from '../styles/soft.module.css'
import p from './pages.module.css'
import ui from '../styles/ui.module.css'

const SECTIONS = [
  { id: 'library', title: 'Library', sub: 'Where your projects live on disk.' },
  { id: 'projects', title: 'Projects', sub: 'Premiere and cleaning up finished videos.' },
  { id: 'goal', title: 'Daily goal', sub: 'How hard the timer pushes you.' },
  { id: 'ai', title: 'AI connections', sub: 'Accounts only — models are picked where they are used, in the Thumbnail Studio.' },
  { id: 'spend', title: 'AI spend', sub: 'What image generation has cost across every thumbnail, by month and overall.' },
  { id: 'app', title: 'App', sub: 'Version and updates.' }
] as const

type SectionId = (typeof SECTIONS)[number]['id']

function describeUpdate(u: UpdateState): string {
  switch (u.status) {
    case 'checking':
      return 'Checking for updates…'
    case 'downloading':
      return `Downloading ${u.version} — ${u.percent}%`
    case 'ready':
      return `${u.version} is ready to install`
    case 'error':
      return `Last check failed — ${u.error ?? 'unknown error'}`
    default:
      return 'Up to date'
  }
}

function describeArchive(preview: ArchivePreview | null): string {
  if (!preview) return 'Measuring…'
  if (preview.candidates.length === 0) return 'Nothing old enough to archive'
  return `${preview.candidates.length} ready · ${formatBytes(preview.bytes)} → Recycle Bin`
}

function Row({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }): ReactNode {
  return (
    <div className={p.settingRow}>
      <div>
        <div className={p.settingLabel}>{label}</div>
        {hint && <div className={p.settingHint}>{hint}</div>}
      </div>
      <div className={p.aiControls}>{children}</div>
    </div>
  )
}

function Section({ id, children }: { id: SectionId; children: ReactNode }): ReactNode {
  const meta = SECTIONS.find((x) => x.id === id)!
  return (
    <section id={'settings-' + id} className={p.settingsSection}>
      <div className={p.settingsSectionHead}>
        <h2>{meta.title}</h2>
        <p>{meta.sub}</p>
      </div>
      <div className={p.settingsCard}>{children}</div>
    </section>
  )
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
    <Row
      label="Auto-archive finished videos"
      hint={<>Sends footage, assets and the base cut to the Recycle Bin · {describeArchive(preview)}</>}
    >
      <Toggle
        checked={state.autoArchive}
        onChange={(v) => void run(() => api.setArchive(v, state.archiveAfterDays))}
        label=""
      />
      <label className={p.unitField}>
        <input
          className={k.field}
          type="number"
          min={1}
          step={1}
          defaultValue={state.archiveAfterDays}
          onBlur={(e) => {
            const days = Number(e.target.value)
            if (days > 0) void run(() => api.setArchive(state.autoArchive, days), 'Archive age updated')
          }}
        />
        <span>days</span>
      </label>
      <button
        className={k.btn}
        disabled={busy || !preview || preview.candidates.length === 0}
        onClick={() => void archiveNow()}
      >
        Archive now
      </button>
    </Row>
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

  const jump = (id: SectionId): void => {
    document.getElementById('settings-' + id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <div className={ui.page}>
      <div className={ui.pageHead}>
        <div>
          <h1 className={ui.title}>Settings</h1>
          <p className={ui.sub}>Where things live and how hard you have to work.</p>
        </div>
      </div>

      <nav className={p.settingsNav}>
        {SECTIONS.map((x) => (
          <button key={x.id} className={p.settingsChip} onClick={() => jump(x.id)}>
            {x.title}
          </button>
        ))}
      </nav>

      <Section id="library">
        <Row
          label="Root folder"
          hint={
            <>
              <span className={p.pathText}>{state.rootPath ?? 'Not set'}</span>
              {state.freeBytes !== null ? ` · ${formatBytes(state.freeBytes)} free` : ''}
              {state.removableRoot ? ' · removable drive' : ''}
            </>
          }
        >
          <button className={k.btn} onClick={() => void run(() => api.openRoot())}>
            <IconFolder />
            Open
          </button>
          <button className={k.btn} onClick={changeRoot}>
            Change…
          </button>
        </Row>
        <Row label="Rescan folder" hint="Picks up folders added by hand and flags ones that vanished.">
          <button
            className={k.btn}
            onClick={async () => {
              const res = await run(() => api.rescan())
              if (res) notify(`${res.added} added · ${res.missing} missing`)
            }}
          >
            Rescan
          </button>
        </Row>
      </Section>

      <Section id="projects">
        <Row
          label="Premiere template"
          hint={<>Blank <b>template.prproj</b> in the <b>.raeydzone</b> folder, copied for every new video.</>}
        >
          <span className={`${ui.tag} ${state.hasPremiereTemplate ? ui.tagOk : ''}`}>
            {state.hasPremiereTemplate ? 'installed' : 'missing'}
          </span>
          <button className={`${ui.btn} ${ui.btnPremiere}`} onClick={() => void run(() => api.openTemplateFolder())}>
            <IconPremiere />
            Open folder
          </button>
        </Row>
        <ArchiveSetting />
      </Section>

      <Section id="goal">
        <Row label="Daily goal" hint={`The progress bar fills at ${formatDuration(state.dailyGoalMs)}.`}>
          <label className={p.unitField}>
            <input
              className={k.field}
              type="number"
              min={5}
              step={5}
              defaultValue={Math.round(state.dailyGoalMs / 60000)}
              onBlur={(e) => {
                const mins = Number(e.target.value)
                if (mins > 0) void run(() => api.setGoal(mins * 60000), 'Goal updated')
              }}
            />
            <span>min</span>
          </label>
        </Row>
      </Section>

      <Section id="ai">
        <ClaudeAccount />
        <OpenRouterKey />
      </Section>

      <Section id="spend">
        <SpendOverview />
      </Section>

      <Section id="app">
        <Row label={`RaeydZone ${state.appVersion}`} hint={describeUpdate(state.update)}>
          {state.update.status === 'ready' ? (
            <button className={`${k.btn} ${k.btnPrimary}`} onClick={() => void api.installUpdate()}>
              Install {state.update.version}
            </button>
          ) : (
            <button
              className={k.btn}
              disabled={state.update.status === 'checking'}
              onClick={() => void run(() => api.checkUpdate(), 'Checking for updates…')}
            >
              Check now
            </button>
          )}
          <button className={`${k.btn} ${k.btnGhost}`} onClick={() => void api.openUpdateLog()}>
            Log
          </button>
        </Row>
      </Section>
    </div>
  )
}
