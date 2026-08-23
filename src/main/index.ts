import { BrowserWindow, app, shell } from 'electron'
import path from 'node:path'
import { registerScheme, serveFrom } from './protocol'
import * as db from './services/db'
import * as lib from './services/library'
import * as timer from './services/timer'
import * as updater from './services/updater'
import { loadSettings } from './services/settings'
import { attach, broadcast, register, root, startReminders, watchRoot } from './ipc'
import { exists } from './util/paths'

registerScheme()
app.setAppUserModelId('zone.raeyd.app')

let win: BrowserWindow | null = null

function createWindow(): void {
  win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 940,
    minHeight: 620,
    show: false,
    frame: false,
    backgroundColor: '#0a0a0a',
    icon: path.join(__dirname, '../../build/icon.png'),
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  win.on('ready-to-show', () => win?.show())
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) {
    void win.loadURL(devUrl)
  } else {
    void win.loadFile(path.join(__dirname, '../renderer/index.html'))
  }

  attach(win)
}

app.whenReady().then(async () => {
  serveFrom(root)

  const settings = await loadSettings()
  if (settings.rootPath && (await exists(settings.rootPath))) {
    db.open(settings.rootPath)
    db.trimLog()
    await lib.ensureRoot(settings.rootPath)
    timer.recover()
    startReminders()
    watchRoot(settings.rootPath)
  }

  register()
  createWindow()
  updater.init(() => void broadcast())

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  timer.shutdown()
  db.close()
  app.quit()
})

app.on('before-quit', () => timer.shutdown())
