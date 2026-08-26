import { BrowserWindow, app, desktopCapturer, session, shell } from 'electron'
import { registerScheme, serveFrom } from './protocol'
import * as db from './services/db'
import * as lib from './services/library'
import * as timer from './services/timer'
import * as updater from './services/updater'
import { loadSettings } from './services/settings'
import { attach, broadcast, register, root, startReminders, watchRoot } from './ipc'
import { exists } from './util/paths'
import { loadRenderer, preloadOptions, iconPath } from './windows'

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
    icon: iconPath(),
    webPreferences: preloadOptions
  })

  win.on('ready-to-show', () => win?.show())
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  loadRenderer(win)
  attach(win)
}

app.whenReady().then(async () => {
  serveFrom(root)

  // Device labels stay blank until media permission is granted, which makes the source
  // picker useless; this app only ever records at the user's explicit request.
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(permission === 'media')
  })

  // Windows loopback: capture what the desktop is playing, not a microphone.
  session.defaultSession.setDisplayMediaRequestHandler(
    async (_request, callback) => {
      const sources = await desktopCapturer.getSources({ types: ['screen'] })
      if (!sources.length) {
        callback({})
        return
      }
      callback({ video: sources[0], audio: 'loopback' })
    },
    { useSystemPicker: false }
  )

  const settings = await loadSettings()
  if (settings.rootPath && (await exists(settings.rootPath))) {
    db.open(settings.rootPath)
    db.trimLog()
    await lib.ensureRoot(settings.rootPath)
    await lib.repairAll(settings.rootPath)
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
