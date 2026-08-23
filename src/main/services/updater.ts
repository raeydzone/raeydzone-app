import { app } from 'electron'
import electronUpdater from 'electron-updater'
import fs from 'node:fs'
import path from 'node:path'
import type { UpdateState } from '@shared/types'

const { autoUpdater } = electronUpdater

const CHECK_EVERY_MS = 6 * 60 * 60 * 1000
const LOG_CAP_BYTES = 256 * 1024

let current: UpdateState = { status: 'idle', version: null, percent: 0, error: null }
let onChange: (() => void) | null = null
let retriedAfterError = false

function logFile(): string {
  return path.join(app.getPath('userData'), 'updater.log')
}

function write(level: string, args: unknown[]): void {
  const line = `${new Date().toISOString()} [${level}] ${args
    .map((a) => (a instanceof Error ? a.stack ?? a.message : String(a)))
    .join(' ')}\n`
  try {
    const file = logFile()
    if (fs.existsSync(file) && fs.statSync(file).size > LOG_CAP_BYTES) fs.rmSync(file)
    fs.appendFileSync(file, line)
  } catch {
    /* logging must never break the app */
  }
}

const logger = {
  info: (...a: unknown[]) => write('info', a),
  warn: (...a: unknown[]) => write('warn', a),
  error: (...a: unknown[]) => write('error', a),
  debug: (...a: unknown[]) => write('debug', a)
}

export function status(): UpdateState {
  return current
}

export function logPath(): string {
  return logFile()
}

function set(next: Partial<UpdateState>): void {
  current = { ...current, ...next }
  onChange?.()
}

// A half-written or superseded download fails checksum forever; clearing it lets one
// clean retry through instead of erroring on every launch.
function clearCache(): void {
  try {
    const dir = path.join(app.getPath('appData'), '..', 'Local', 'raeydzone-updater')
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true })
    write('info', ['cleared updater cache', dir])
  } catch (err) {
    write('warn', ['could not clear updater cache', err])
  }
}

export function init(notify: () => void): void {
  onChange = notify
  if (!app.isPackaged) {
    write('info', ['not packaged — updater disabled'])
    return
  }

  autoUpdater.logger = logger
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('checking-for-update', () => set({ status: 'checking', error: null }))
  autoUpdater.on('update-not-available', () => set({ status: 'idle', version: null }))
  autoUpdater.on('update-available', (info) =>
    set({ status: 'downloading', version: info.version, percent: 0 })
  )
  autoUpdater.on('download-progress', (p) => set({ percent: Math.round(p.percent) }))
  autoUpdater.on('update-downloaded', (info) => {
    retriedAfterError = false
    set({ status: 'ready', version: info.version, percent: 100, error: null })
  })

  autoUpdater.on('error', (err) => {
    write('error', ['update failed', err])
    set({ status: 'error', error: err.message })
    if (!retriedAfterError) {
      retriedAfterError = true
      clearCache()
      setTimeout(() => void check(), 3000)
    }
  })

  write('info', ['updater ready', 'current version', app.getVersion()])
  void check()
  setInterval(() => void check(), CHECK_EVERY_MS)
}

export async function check(): Promise<void> {
  if (!app.isPackaged) throw new Error('Updates only run in an installed build.')
  try {
    await autoUpdater.checkForUpdates()
  } catch (err) {
    write('error', ['check failed', err])
    set({ status: 'error', error: (err as Error).message })
  }
}

export function install(): void {
  if (current.status !== 'ready') return
  write('info', ['installing', current.version])
  autoUpdater.quitAndInstall(false, true)
}
