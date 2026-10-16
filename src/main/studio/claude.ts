import { app } from 'electron'
import { execFile, spawn } from 'node:child_process'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import fs from 'node:fs/promises'
import { getSettings } from '../services/settings'
import { exists } from '../util/paths'
import { SYSTEM_PROMPT } from './prompt'
import type { ClaudeStatus, SendRequest, StudioEvent, VariantStatus } from '@shared/studio'

interface Session {
  proc: ChildProcessWithoutNullStreams
  status: VariantStatus
  stopping: boolean
  stdout: string
  stderr: string
  idleTimer: NodeJS.Timeout | null
  killTimer: NodeJS.Timeout | null
}

const IDLE_MS = 15 * 60 * 1000
const sessions = new Map<string, Session>()
let emit: (variantId: string, event: StudioEvent) => void = () => {}

export function onEvent(fn: typeof emit): void {
  emit = fn
}

const workDir = (): string => path.join(app.getPath('userData'), 'studio-claude')

function run(file: string, args: string[], timeout = 15_000, loose = false): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(file, args, { timeout, windowsHide: true }, (err, stdout) =>
      err && !(loose && stdout.trim()) ? reject(err) : resolve(stdout)
    )
  })
}

// npm installs a .cmd shim that cannot be spawned without a shell; the real binary sits
// beside it in the package, so resolve to that and keep argument quoting out of cmd.exe.
async function fromShim(shim: string): Promise<string | null> {
  if (/\.exe$/i.test(shim)) return shim
  const cmd = /\.cmd$/i.test(shim) ? shim : shim + '.cmd'
  try {
    const text = await fs.readFile(cmd, 'utf-8')
    const rel = /"%dp0%\\([^"]+\.exe)"/i.exec(text)?.[1]
    return rel ? path.join(path.dirname(cmd), rel) : null
  } catch {
    return null
  }
}

export async function locate(): Promise<string | null> {
  const candidates: string[] = []
  const configured = getSettings().claudePath
  if (configured) candidates.push(configured)
  try {
    const found = await run('where.exe', ['claude'], 5000)
    for (const line of found.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)) {
      const resolved = await fromShim(line)
      if (resolved) candidates.push(resolved)
    }
  } catch {
    // where.exe exits non-zero when nothing is on PATH
  }
  candidates.push(
    path.join(app.getPath('home'), '.local', 'bin', 'claude.exe'),
    path.join(app.getPath('appData'), 'npm', 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe')
  )
  for (const c of candidates) {
    if (await exists(c)) return c
  }
  return null
}

export async function status(): Promise<ClaudeStatus> {
  const exe = await locate()
  const base: ClaudeStatus = {
    found: !!exe, path: exe, version: null, loggedIn: false, email: null, plan: null, error: null
  }
  if (!exe) return base
  try {
    base.version = (await run(exe, ['--version'])).trim().split(' ')[0] || null
    const auth = JSON.parse(await run(exe, ['auth', 'status', '--json'], 15_000, true)) as {
      loggedIn?: boolean; email?: string; subscriptionType?: string
    }
    base.loggedIn = !!auth.loggedIn
    base.email = auth.email ?? null
    base.plan = auth.subscriptionType ?? null
  } catch (err) {
    base.error = (err as Error).message.split('\n')[0]
  }
  return base
}

function openConsole(title: string, command: string): void {
  spawn('cmd.exe', ['/d', '/c', `start "${title}" ${command}`], {
    windowsVerbatimArguments: true,
    detached: true,
    stdio: 'ignore',
    windowsHide: true
  }).unref()
}

export async function connect(): Promise<void> {
  const exe = await locate()
  if (exe) {
    openConsole('Claude sign-in', `"${exe}" auth login --claudeai`)
    return
  }
  openConsole(
    'Install Claude Code',
    'powershell.exe -NoProfile -ExecutionPolicy Bypass -NoExit -Command "irm https://claude.ai/install.ps1 | iex"'
  )
}

function setStatus(variantId: string, s: Session, next: VariantStatus, error?: string): void {
  s.status = next
  emit(variantId, { type: 'status', status: next, error })
  if (s.idleTimer) clearTimeout(s.idleTimer)
  s.idleTimer = next === 'working' ? null : setTimeout(() => s.proc.kill(), IDLE_MS)
}

function handleLine(variantId: string, s: Session, line: string): void {
  let msg: Record<string, unknown>
  try {
    msg = JSON.parse(line)
  } catch {
    return
  }
  if (msg.type === 'system' && msg.subtype === 'init' && typeof msg.session_id === 'string') {
    emit(variantId, { type: 'session', sessionId: msg.session_id })
  } else if (msg.type === 'assistant') {
    const content = (msg.message as { content?: { type: string; text?: string }[] })?.content ?? []
    for (const block of content) {
      if (block.type === 'text' && block.text?.trim()) emit(variantId, { type: 'text', text: block.text.trim() })
    }
  } else if (msg.type === 'rate_limit_event') {
    const windows = (msg.rate_limit_info as {
      unifiedWindows?: Record<string, { utilization?: number }>
    })?.unifiedWindows
    emit(variantId, {
      type: 'usage',
      fiveHour: windows?.five_hour?.utilization ?? null,
      weekly: windows?.seven_day?.utilization ?? null
    })
  } else if (msg.type === 'result') {
    if (s.killTimer) clearTimeout(s.killTimer)
    s.killTimer = null
    if (s.stopping) {
      s.stopping = false
      setStatus(variantId, s, 'stopped')
    } else if (msg.is_error) {
      setStatus(variantId, s, 'error', String(msg.result ?? msg.subtype ?? 'Claude stopped with an error'))
    } else {
      setStatus(variantId, s, 'idle')
    }
  }
}

async function spawnSession(
  req: SendRequest,
  mcp: { url: string; token: string }
): Promise<Session> {
  const exe = await locate()
  if (!exe) throw new Error('Claude Code is not installed — connect Claude in Settings.')

  const dir = workDir()
  await fs.mkdir(dir, { recursive: true })
  const systemFile = path.join(dir, 'system-prompt.md')
  const mcpFile = path.join(dir, 'mcp-' + req.variantId + '.json')
  await fs.writeFile(systemFile, SYSTEM_PROMPT, 'utf-8')
  await fs.writeFile(
    mcpFile,
    JSON.stringify({
      mcpServers: {
        canvas: { type: 'http', url: mcp.url, headers: { Authorization: 'Bearer ' + mcp.token } }
      }
    }),
    'utf-8'
  )

  const args = [
    '-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose',
    '--model', getSettings().claudeModel,
    '--mcp-config', mcpFile, '--strict-mcp-config',
    '--tools', '', '--allowedTools', 'mcp__canvas',
    '--system-prompt-file', systemFile,
    '--setting-sources', '', '--disable-slash-commands'
  ]
  if (req.resume) args.push('--resume', req.resume)

  // An API key in the environment would silently bill the API instead of the subscription.
  const env = { ...process.env }
  delete env.ANTHROPIC_API_KEY

  const proc = spawn(exe, args, { cwd: dir, env, windowsHide: true })
  const s: Session = {
    proc, status: 'working', stopping: false, stdout: '', stderr: '', idleTimer: null, killTimer: null
  }
  sessions.set(req.variantId, s)

  proc.stdout.setEncoding('utf-8')
  proc.stdout.on('data', (chunk: string) => {
    s.stdout += chunk
    let nl: number
    while ((nl = s.stdout.indexOf('\n')) >= 0) {
      const line = s.stdout.slice(0, nl).trim()
      s.stdout = s.stdout.slice(nl + 1)
      if (line) handleLine(req.variantId, s, line)
    }
  })
  proc.stderr.setEncoding('utf-8')
  proc.stderr.on('data', (chunk: string) => {
    s.stderr = (s.stderr + chunk).slice(-2000)
  })
  proc.stdin.on('error', () => {})
  proc.on('error', (err) => setStatus(req.variantId, s, 'error', err.message))
  proc.on('exit', (code) => {
    if (sessions.get(req.variantId) === s) sessions.delete(req.variantId)
    if (s.idleTimer) clearTimeout(s.idleTimer)
    if (s.killTimer) clearTimeout(s.killTimer)
    void fs.unlink(mcpFile).catch(() => {})
    if (s.status !== 'working') return
    if (s.stopping || code === 0) emit(req.variantId, { type: 'status', status: 'stopped' })
    else {
      const detail = s.stderr.trim().split('\n').slice(-3).join(' ')
      emit(req.variantId, { type: 'status', status: 'error', error: detail || 'Claude exited with code ' + code })
    }
  })
  return s
}

export async function send(req: SendRequest, mcp: { url: string; token: string }): Promise<void> {
  let s = sessions.get(req.variantId)
  if (!s || s.proc.exitCode !== null) s = await spawnSession(req, mcp)

  const content: unknown[] = []
  for (const image of req.images) {
    content.push({
      type: 'image',
      source: { type: 'base64', media_type: image.mime, data: Buffer.from(image.data).toString('base64') }
    })
  }
  content.push({ type: 'text', text: req.text })
  s.proc.stdin.write(
    JSON.stringify({ type: 'user', message: { role: 'user', content } }) + '\n'
  )
  setStatus(req.variantId, s, 'working')
}

export function stop(variantId: string): void {
  const s = sessions.get(variantId)
  if (!s || s.status !== 'working') return
  s.stopping = true
  s.proc.stdin.write(
    JSON.stringify({ type: 'control_request', request_id: randomUUID(), request: { subtype: 'interrupt' } }) + '\n'
  )
  s.killTimer = setTimeout(() => s.proc.kill(), 5000)
}

export function stopAll(): void {
  for (const s of sessions.values()) s.proc.kill()
  sessions.clear()
}
