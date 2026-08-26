import { BrowserWindow } from 'electron'
import path from 'node:path'

export const preloadOptions = {
  preload: path.join(__dirname, '../preload/index.js'),
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: false
}

export const iconPath = (): string => path.join(__dirname, '../../build/icon.png')

export function loadRenderer(target: BrowserWindow, view?: string): void {
  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) {
    void target.loadURL(view ? devUrl + '?view=' + view : devUrl)
  } else {
    const file = path.join(__dirname, '../renderer/index.html')
    void target.loadFile(file, view ? { query: { view } } : undefined)
  }
}

let toolsWin: BrowserWindow | null = null

export function openToolsWindow(): void {
  if (toolsWin && !toolsWin.isDestroyed()) {
    toolsWin.show()
    toolsWin.focus()
    return
  }
  toolsWin = new BrowserWindow({
    width: 440,
    height: 580,
    minWidth: 380,
    minHeight: 460,
    show: false,
    frame: false,
    alwaysOnTop: true,
    backgroundColor: '#0a0a0a',
    icon: iconPath(),
    webPreferences: preloadOptions
  })
  toolsWin.on('ready-to-show', () => toolsWin?.show())
  toolsWin.on('closed', () => {
    toolsWin = null
  })
  loadRenderer(toolsWin, 'tools')
}
