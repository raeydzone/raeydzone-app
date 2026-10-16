import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { CLAUDE_MODELS, IMAGE_MODELS } from '@shared/studio'
import type { ClaudeStatus, OpenRouterStatus } from '@shared/studio'
import { useStore } from '../state/store'
import p from './pages.module.css'
import ui from '../styles/ui.module.css'

function describeClaude(c: ClaudeStatus | null): string {
  if (!c) return 'checking…'
  if (!c.found) return 'Claude Code is not installed on this PC'
  if (!c.loggedIn) return c.error ? 'could not read the sign-in — ' + c.error : 'installed, not signed in'
  return `signed in${c.email ? ' as ' + c.email : ''}${c.plan ? ' · ' + c.plan + ' plan' : ''}${c.version ? ' · Claude Code ' + c.version : ''}`
}

function describeOpenRouter(o: OpenRouterStatus | null): string {
  if (!o) return 'checking…'
  if (!o.set) return 'no key saved'
  if (!o.ok) return 'key saved but not working — ' + (o.error ?? 'unknown error')
  return `connected${o.label ? ' · ' + o.label : ''}${o.remaining != null ? ` · $${o.remaining.toFixed(2)} left` : ''}`
}

function ClaudeRow({ model, setModel }: { model: string; setModel: (m: string) => void }): ReactNode {
  const { run } = useStore()
  const ai = window.raeydzone.ai
  const [status, setStatus] = useState<ClaudeStatus | null>(null)
  const [waiting, setWaiting] = useState(false)
  const poll = useRef<ReturnType<typeof setInterval> | null>(null)

  const check = useCallback(async () => {
    const next = await run(() => ai.claudeStatus())
    if (next) setStatus(next)
    return next
  }, [ai, run])

  useEffect(() => {
    void check()
    return () => {
      if (poll.current) clearInterval(poll.current)
    }
  }, [check])

  const connect = async (): Promise<void> => {
    await run(() => ai.claudeConnect())
    setWaiting(true)
    let tries = 0
    if (poll.current) clearInterval(poll.current)
    poll.current = setInterval(async () => {
      const next = await ai.claudeStatus().catch(() => null)
      if (next) setStatus(next)
      if ((next?.found && next.loggedIn) || ++tries > 90) {
        clearInterval(poll.current!)
        poll.current = null
        setWaiting(false)
      }
    }, 3000)
  }

  const ok = !!status?.found && status.loggedIn
  return (
    <div className={`${p.settingRow} ${p.settingStack}`}>
      <div>
        <div className={p.settingLabel}>Claude — the thumbnail designer</div>
        <div className={p.settingHint}>
          The studio runs Claude Code in the background with your own Claude subscription, so designs come out of your
          plan’s usage, not a per-token bill. Connecting opens a window to sign in{status && !status.found ? ' after installing Claude Code' : ''}.
        </div>
        <div className={ui.faint} style={{ marginTop: 6 }}>
          {waiting && !ok ? 'Waiting for you to finish in the window that opened…' : describeClaude(status)}
        </div>
      </div>
      <div className={ui.row}>
        <span className={`${ui.tag} ${ok ? ui.tagOk : ''}`}>{ok ? 'connected' : 'not connected'}</span>
        <select className={ui.input} style={{ width: 170 }} value={model} onChange={(e) => setModel(e.target.value)}>
          {CLAUDE_MODELS.map((m) => (
            <option key={m.id} value={m.id}>{m.label}</option>
          ))}
        </select>
        {!ok && (
          <button className={`${ui.btn} ${ui.btnPrimary}`} onClick={() => void connect()}>
            {status && !status.found ? 'Install & connect' : 'Connect Claude'}
          </button>
        )}
        {status && !status.found && (
          <button className={ui.btn} title="Point to claude.exe if it is installed somewhere unusual" onClick={async () => {
            const next = await run(() => ai.claudeLocate())
            if (next) setStatus(next)
          }}>
            Locate…
          </button>
        )}
        <button className={`${ui.btn} ${ui.btnGhost}`} onClick={() => void check()}>
          Check
        </button>
      </div>
    </div>
  )
}

function OpenRouterRow({ model, setModel }: { model: string; setModel: (m: string) => void }): ReactNode {
  const { run, notify } = useStore()
  const ai = window.raeydzone.ai
  const [status, setStatus] = useState<OpenRouterStatus | null>(null)
  const [key, setKey] = useState('')

  useEffect(() => {
    void ai.openrouterStatus().then(setStatus).catch(() => {})
  }, [ai])

  const save = async (value: string | null): Promise<void> => {
    const next = await run(() => ai.setOpenrouterKey(value))
    if (!next) return
    setStatus(next)
    setKey('')
    if (value && next.ok) notify('OpenRouter connected')
    else if (value) notify('That key did not work — ' + (next.error ?? 'unknown error'), 'bad')
  }

  const ok = !!status?.ok
  const note = IMAGE_MODELS.find((m) => m.id === model)?.note
  return (
    <div className={`${p.settingRow} ${p.settingStack}`}>
      <div>
        <div className={p.settingLabel}>OpenRouter — images, generative fill and cut-outs</div>
        <div className={p.settingHint}>
          Generated assets, generative fill and smart cut-outs run on a hosted image model through your OpenRouter
          account. Create a key at{' '}
          <a href="https://openrouter.ai/settings/keys" target="_blank" rel="noreferrer">openrouter.ai/settings/keys</a>
          {' '}— it is stored encrypted on this PC.
        </div>
        <div className={ui.faint} style={{ marginTop: 6 }}>
          {describeOpenRouter(status)}
          {note ? ' · ' + note : ''}
        </div>
      </div>
      <div className={ui.row}>
        <span className={`${ui.tag} ${ok ? ui.tagOk : ''}`}>{ok ? 'connected' : 'not connected'}</span>
        <select className={ui.input} style={{ width: 190 }} value={model} onChange={(e) => setModel(e.target.value)}>
          {IMAGE_MODELS.map((m) => (
            <option key={m.id} value={m.id}>{m.label}</option>
          ))}
        </select>
        <input
          className={ui.input}
          style={{ width: 170 }}
          type="password"
          placeholder={status?.set ? 'Replace key…' : 'sk-or-…'}
          value={key}
          onChange={(e) => setKey(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && key.trim() && void save(key)}
        />
        <button className={`${ui.btn} ${ui.btnPrimary}`} disabled={!key.trim()} onClick={() => void save(key)}>
          Connect
        </button>
        {status?.set && (
          <button className={`${ui.btn} ${ui.btnGhost}`} onClick={() => void save(null)}>
            Remove
          </button>
        )}
      </div>
    </div>
  )
}

export function AiSettings(): ReactNode {
  const { run } = useStore()
  const ai = window.raeydzone.ai
  const [prefs, setPrefs] = useState<{ claudeModel: string; imageModel: string } | null>(null)

  useEffect(() => {
    void ai.prefs().then(setPrefs).catch(() => {})
  }, [ai])

  const update = async (patch: Partial<{ claudeModel: string; imageModel: string }>): Promise<void> => {
    const next = await run(() => ai.setPrefs(patch))
    if (next) setPrefs(next)
  }

  if (!prefs) return null
  return (
    <>
      <ClaudeRow model={prefs.claudeModel} setModel={(claudeModel) => void update({ claudeModel })} />
      <OpenRouterRow model={prefs.imageModel} setModel={(imageModel) => void update({ imageModel })} />
    </>
  )
}
