import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { ClaudeStatus, OpenRouterStatus } from '@shared/studio'
import { IconClaude, IconRoute } from '../components/Icons'
import { useStore } from '../state/store'
import k from '../styles/soft.module.css'
import p from './pages.module.css'

function Status({ ok, children }: { ok: boolean; children: ReactNode }): ReactNode {
  return (
    <div className={p.aiStatus}>
      <span className={`${p.aiDot} ${ok ? p.aiDotOk : ''}`} />
      {children}
    </div>
  )
}

function claudeLine(c: ClaudeStatus | null, waiting: boolean): string {
  if (!c) return 'Checking…'
  if (c.found && c.loggedIn) {
    const plan = c.plan ? c.plan[0].toUpperCase() + c.plan.slice(1) + ' plan' : null
    return [c.email ?? 'Signed in', plan].filter(Boolean).join(' · ')
  }
  if (waiting) return 'Finish signing in in the window that opened…'
  return c.found ? 'Not signed in' : 'Claude Code not installed'
}

export function ClaudeAccount(): ReactNode {
  const { run } = useStore()
  const ai = window.raeydzone.ai
  const [status, setStatus] = useState<ClaudeStatus | null>(null)
  const [waiting, setWaiting] = useState(false)
  const poll = useRef<ReturnType<typeof setInterval> | null>(null)

  const check = useCallback(async () => {
    const next = await run(() => ai.claudeStatus())
    if (next) setStatus(next)
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
    <div className={p.settingRow}>
      <div>
        <div className={p.aiName}>
          <span className={`${p.aiMark} ${p.aiMarkClaude}`}>
            <IconClaude size={16} />
          </span>
          Claude
          <span className={p.aiRole}>designs thumbnails</span>
        </div>
        <Status ok={ok}>{claudeLine(status, waiting)}</Status>
      </div>
      <div className={p.aiControls}>
        {ok ? (
          <button className={`${k.btn} ${k.btnGhost}`} onClick={() => void check()}>
            Refresh
          </button>
        ) : (
          <>
            {status && !status.found && (
              <button
                className={`${k.btn} ${k.btnGhost}`}
                title="Point to claude.exe if it is installed somewhere unusual"
                onClick={async () => {
                  const next = await run(() => ai.claudeLocate())
                  if (next) setStatus(next)
                }}
              >
                Locate…
              </button>
            )}
            <button className={`${k.btn} ${k.btnPrimary}`} onClick={() => void connect()}>
              {status && !status.found ? 'Install Claude' : 'Connect'}
            </button>
          </>
        )}
      </div>
    </div>
  )
}

export function OpenRouterKey(): ReactNode {
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
  const remaining = status?.remaining != null ? `$${status.remaining.toFixed(2)} left` : null
  const line = !status
    ? 'Checking…'
    : ok
      ? ['Connected', status.label, remaining].filter(Boolean).join(' · ')
      : status.set
        ? 'Key not working — ' + (status.error ?? 'unknown error')
        : 'Not connected'

  return (
    <div className={p.settingRow}>
      <div>
        <div className={p.aiName}>
          <span className={p.aiMark}>
            <IconRoute size={15} />
          </span>
          OpenRouter
          <span className={p.aiRole}>image models</span>
        </div>
        <Status ok={ok}>
          {line}
          {!ok && (
            <a className={p.aiLink} href="https://openrouter.ai/settings/keys" target="_blank" rel="noreferrer">
              Get a key
            </a>
          )}
        </Status>
      </div>
      <div className={p.aiControls}>
        {ok ? (
          <button className={`${k.btn} ${k.btnGhost}`} onClick={() => void save(null)}>
            Disconnect
          </button>
        ) : (
          <>
            <input
              className={`${k.field} ${p.aiKey}`}
              type="password"
              placeholder="Paste API key"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && key.trim() && void save(key)}
            />
            <button className={`${k.btn} ${k.btnPrimary}`} disabled={!key.trim()} onClick={() => void save(key)}>
              Connect
            </button>
          </>
        )}
      </div>
    </div>
  )
}
