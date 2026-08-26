import {
  BrowserWindow, Notification, app, dialog, ipcMain, nativeImage, shell
} from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import * as db from './services/db'
import * as lib from './services/library'
import * as timer from './services/timer'
import * as updater from './services/updater'
import { hasTemplate } from './services/premiere'
import { log } from './services/log'
import {
  defaultRoot, getSettings, proposeRoot, saveSettings, validateRoot
} from './services/settings'
import { freeBytes, isRemovable } from './util/paths'
import { DRAG_ICON_DATA_URL } from './util/dragIcon'
import type { AppState, DropTarget, StepId } from '@shared/types'

let win: BrowserWindow | null = null
let reminderTimer: NodeJS.Timeout | null = null
let watcher: fs.FSWatcher | null = null
let watchDebounce: NodeJS.Timeout | null = null

export function attach(window: BrowserWindow): void {
  win = window
}

export function root(): string | null {
  return getSettings().rootPath
}

function requireRoot(): string {
  const r = root()
  if (!r) throw new Error('No root folder configured.')
  return r
}

function assertInsideRoot(target: string): void {
  const r = requireRoot()
  const rel = path.relative(r, path.resolve(target))
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error('That path is outside the managed folder.')
  }
}

export async function buildState(): Promise<AppState> {
  const settings = getSettings()
  const r = settings.rootPath
  const data = db.state()
  return {
    ready: !!r,
    rootPath: r,
    rootValid: !!r,
    hasPremiereTemplate: r ? await hasTemplate(r) : false,
    dailyGoalMs: settings.dailyGoalMs,
    videos: data.videos,
    streams: data.streams,
    log: data.log.slice(0, 500),
    days: data.days,
    running: data.running,
    freeBytes: r ? await freeBytes(r) : null,
    removableRoot: r ? await isRemovable(r) : false,
    update: updater.status(),
    appVersion: app.getVersion()
  }
}

export async function broadcast(): Promise<void> {
  if (!win || win.isDestroyed()) return
  win.webContents.send('state:changed', await buildState())
}

function handle(channel: string, fn: (...args: never[]) => unknown): void {
  ipcMain.handle(channel, async (_event, ...args) => {
    try {
      const value = await (fn as (...a: unknown[]) => unknown)(...args)
      await broadcast()
      return { ok: true, value }
    } catch (err) {
      return { ok: false, error: (err as Error).message }
    }
  })
}

export function watchRoot(root: string): void {
  watcher?.close()
  const target = path.join(root, '.raeydzone')
  try {
    fs.mkdirSync(target, { recursive: true })
    watcher = fs.watch(target, (_event, filename) => {
      if (filename && !String(filename).startsWith('template.prproj')) return
      if (watchDebounce) clearTimeout(watchDebounce)
      watchDebounce = setTimeout(() => {
        // installing the template backfills project files for videos created before it
        void lib.repairAll(root).then(() => broadcast())
      }, 400)
    })
  } catch {
    watcher = null
  }
}

export function startReminders(): void {
  if (reminderTimer) clearInterval(reminderTimer)
  reminderTimer = setInterval(() => void checkReminders(), 30_000)
  void checkReminders()
}

async function checkReminders(): Promise<void> {
  const now = Date.now()
  let fired = false
  for (const stream of db.state().streams) {
    if (!stream.scheduledAt || stream.streamedAt || stream.notified) continue
    if (new Date(stream.scheduledAt).getTime() > now) continue
    stream.notified = true
    db.saveStream(stream)
    fired = true
    if (Notification.isSupported()) {
      new Notification({
        title: 'Stream due',
        body: stream.name,
        silent: false
      }).show()
    }
  }
  if (fired) await broadcast()
}

export function register(): void {
  handle('state:get', () => buildState())

  handle('root:propose', () => proposeRoot())

  handle('root:pick', async () => {
    const result = await dialog.showOpenDialog(win!, {
      title: 'Choose the RaeydZone folder',
      defaultPath: defaultRoot(),
      properties: ['openDirectory', 'createDirectory']
    })
    if (result.canceled || !result.filePaths[0]) return null
    return result.filePaths[0]
  })

  handle('root:set', async (chosen: string) => {
    const problem = validateRoot(chosen)
    if (problem) throw new Error(problem)
    await saveSettings({ rootPath: chosen })
    db.open(chosen)
    await lib.ensureRoot(chosen)
    timer.recover()
    log('system.root', 'Root folder set to ' + chosen)
    startReminders()
    watchRoot(chosen)
    return chosen
  })

  handle('settings:goal', (ms: number) => saveSettings({ dailyGoalMs: Math.max(60_000, ms) }))

  handle('videos:create', (name: string) => lib.createVideo(requireRoot(), name))
  handle('videos:rename', (id: string, name: string) =>
    lib.renameVideo(requireRoot(), id, name)
  )
  handle('videos:step', (id: string, step: StepId) => lib.toggleStep(id, step))
  handle('videos:premiere', (id: string) => lib.openPremiere(requireRoot(), id))
  handle('videos:remove', (id: string, deleteFolder: boolean) =>
    lib.removeVideo(requireRoot(), id, deleteFolder)
  )

  handle('streams:create', (name: string) => lib.createStream(requireRoot(), name))
  handle('streams:streamed', (id: string, done: boolean) => lib.setStreamed(id, done))
  handle('streams:schedule', (id: string, iso: string | null) => lib.setSchedule(id, iso))
  handle('streams:remove', (id: string, deleteFolder: boolean) =>
    lib.removeStream(requireRoot(), id, deleteFolder)
  )

  handle('files:drop', (kind: 'video' | 'stream', id: string, paths: string[], target: DropTarget) =>
    lib.dropFiles(requireRoot(), kind, id, paths, target)
  )
  handle('files:reveal', (kind: 'video' | 'stream', id: string) =>
    lib.reveal(requireRoot(), kind, id)
  )
  handle('files:list', (kind: 'video' | 'stream', id: string) =>
    lib.listFiles(requireRoot(), kind, id)
  )
  handle('files:paste', (kind: 'video' | 'stream', id: string) =>
    lib.pasteClipboard(requireRoot(), kind, id)
  )
  handle('files:showFile', (target: string) => {
    assertInsideRoot(target)
    shell.showItemInFolder(target)
  })
  handle('files:openFile', async (target: string) => {
    assertInsideRoot(target)
    const err = await shell.openPath(target)
    if (err) throw new Error(err)
  })
  handle('files:pick', async (target: DropTarget) => {
    const filters =
      target === 'thumbnail'
        ? [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'avif'] }]
        : target === 'baseVideo'
          ? [{ name: 'Video', extensions: ['mp4', 'mkv', 'mov', 'avi', 'webm', 'm4v'] }]
          : [{ name: 'All files', extensions: ['*'] }]
    const result = await dialog.showOpenDialog(win!, {
      properties: target === 'auto' ? ['openFile', 'multiSelections'] : ['openFile'],
      filters
    })
    return result.canceled ? [] : result.filePaths
  })

  handle('update:check', () => updater.check())
  handle('update:log', () => shell.openPath(updater.logPath()))
  handle('update:install', () => updater.install())

  handle('timer:start', () => timer.start())
  handle('timer:stop', () => timer.stop())

  handle('system:rescan', () => lib.rescan(requireRoot()))
  handle('system:repair', () => lib.repairAll(requireRoot()))
  handle('system:openRoot', () => shell.openPath(requireRoot()))
  handle('system:openTemplateFolder', () =>
    shell.openPath(path.dirname(db.templatePath(requireRoot())))
  )

  // Native drag-out: lets a file be dragged from the app straight into Premiere.
  ipcMain.on('files:drag', (event, paths: string[]) => {
    const valid = paths.filter((p) => {
      try {
        assertInsideRoot(p)
        return fs.existsSync(p)
      } catch {
        return false
      }
    })
    if (!valid.length) return
    event.sender.startDrag({
      files: valid,
      file: valid[0],
      icon: nativeImage.createFromDataURL(DRAG_ICON_DATA_URL)
    })
  })

  ipcMain.on('window:minimize', () => win?.minimize())
  ipcMain.on('window:maximize', () =>
    win?.isMaximized() ? win.unmaximize() : win?.maximize()
  )
  ipcMain.on('window:close', () => win?.close())
}
