import { BrowserWindow, screen } from 'electron'
import type { Display } from 'electron'
import type { Region } from '@shared/types'
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

export type Tool = 'sound' | 'screen'

const TOOL_WINDOWS: Record<Tool, { width: number; height: number }> = {
  sound: { width: 440, height: 580 },
  screen: { width: 470, height: 660 }
}

const openTools = new Map<Tool, BrowserWindow>()

export function openToolWindow(tool: Tool): void {
  const existing = openTools.get(tool)
  if (existing && !existing.isDestroyed()) {
    existing.show()
    existing.focus()
    return
  }

  const size = TOOL_WINDOWS[tool] ?? TOOL_WINDOWS.sound
  const win = new BrowserWindow({
    ...size,
    minWidth: 380,
    minHeight: 460,
    show: false,
    frame: false,
    alwaysOnTop: true,
    backgroundColor: '#0a0a0a',
    icon: iconPath(),
    webPreferences: preloadOptions
  })
  openTools.set(tool, win)
  win.on('ready-to-show', () => win.show())
  win.on('closed', () => {
    if (openTools.get(tool) === win) openTools.delete(tool)
  })
  loadRenderer(win, 'tools-' + tool)
}

type Rect = { x: number; y: number; width: number; height: number }

let regionWin: BrowserWindow | null = null
let regionDisplay: Display | null = null
let settleRegion: ((r: Region | null) => void) | null = null

// The overlay covers whichever monitor the cursor is on, so its window coordinates are
// already display-relative — the renderer never has to reason about monitor offsets.
export function selectRegion(): Promise<Region | null> {
  if (regionWin && !regionWin.isDestroyed()) regionWin.destroy()
  regionWin = null

  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  regionDisplay = display

  const win = new BrowserWindow({
    ...display.bounds,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    hasShadow: false,
    show: false,
    webPreferences: preloadOptions
  })
  regionWin = win
  win.setAlwaysOnTop(true, 'screen-saver')
  win.on('ready-to-show', () => {
    win.show()
    win.focus()
  })
  win.on('closed', () => {
    if (regionWin === win) regionWin = null
    finishRegion(null)
  })
  loadRenderer(win, 'region')

  return new Promise((resolve) => {
    settleRegion = resolve
  })
}

export function finishRegion(rect: Rect | null): void {
  const resolve = settleRegion
  settleRegion = null

  const win = regionWin
  regionWin = null
  // destroy, not close: a transparent always-on-top window can outlive a close() long
  // enough for its outline to sit over the very recording it was used to frame.
  if (win && !win.isDestroyed()) win.destroy()

  if (!resolve) return
  const display = regionDisplay
  if (!rect || !display || rect.width < 8 || rect.height < 8) {
    resolve(null)
    return
  }
  resolve({
    x: Math.round(rect.x),
    y: Math.round(rect.y),
    width: Math.round(rect.width),
    height: Math.round(rect.height),
    displayId: String(display.id),
    displayWidth: display.size.width,
    displayHeight: display.size.height
  })
}
