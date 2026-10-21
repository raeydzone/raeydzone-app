const { app, BrowserWindow } = require('electron')
const path = require('path')

const work = process.argv[process.argv.indexOf('--work') + 1]

app.whenReady().then(() => {
  const win = new BrowserWindow({
    show: false,
    width: 1280,
    height: 720,
    webPreferences: { offscreen: true, nodeIntegration: true, contextIsolation: false }
  })
  win.webContents.on('render-process-gone', (_event, details) => {
    console.error('renderer gone: ' + JSON.stringify(details))
    app.exit(1)
  })
  win.webContents.on('ipc-message', (_event, channel) => {
    if (channel === 'done') app.exit(0)
  })
  void win.loadFile(path.join(work, 'page.html'))
  setTimeout(() => {
    console.error('timed out waiting for the render cases')
    app.exit(1)
  }, 30000)
})
