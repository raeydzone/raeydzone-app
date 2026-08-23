import { app } from 'electron'
import electronUpdater from 'electron-updater'
import type { UpdateState } from '@shared/types'

const { autoUpdater } = electronUpdater

const CHECK_EVERY_MS = 6 * 60 * 60 * 1000

let current: UpdateState = { status: 'idle', version: null, percent: 0, error: null }
let onChange: (() => void) | null = null

export function status(): UpdateState {
  return current
}

function set(next: Partial<UpdateState>): void {
  current = { ...current, ...next }
  onChange?.()
}

export function init(notify: () => void): void {
  onChange = notify
  if (!app.isPackaged) return

  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('checking-for-update', () => set({ status: 'checking', error: null }))
  autoUpdater.on('update-not-available', () => set({ status: 'idle', version: null }))
  autoUpdater.on('update-available', (info) =>
    set({ status: 'downloading', version: info.version, percent: 0 })
  )
  autoUpdater.on('download-progress', (p) => set({ percent: Math.round(p.percent) }))
  autoUpdater.on('update-downloaded', (info) =>
    set({ status: 'ready', version: info.version, percent: 100 })
  )
  autoUpdater.on('error', (err) => set({ status: 'error', error: err.message }))

  void check()
  setInterval(() => void check(), CHECK_EVERY_MS)
}

export async function check(): Promise<void> {
  if (!app.isPackaged) return
  try {
    await autoUpdater.checkForUpdates()
  } catch (err) {
    set({ status: 'error', error: (err as Error).message })
  }
}

export function install(): void {
  if (current.status !== 'ready') return
  autoUpdater.quitAndInstall(false, true)
}
