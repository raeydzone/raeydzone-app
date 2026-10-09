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

export function loadRenderer(
  target: BrowserWindow,
  view?: string,
  extra?: Record<string, string>
): void {
  const query = view ? { view, ...extra } : undefined
  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) {
    const search = query ? '?' + new URLSearchParams(query).toString() : ''
    void target.loadURL(devUrl + search)
  } else {
    const file = path.join(__dirname, '../renderer/index.html')
    void target.loadFile(file, query ? { query } : undefined)
  }
}

let frameWin: BrowserWindow | null = null
let frameOwner: BrowserWindow | null = null
let detachFrameListeners: (() => void) | null = null
let shuttingDown = false

export function hideRegionFrame(): void {
  const win = frameWin
  frameWin = null
  frameOwner = null
  detachFrameListeners?.()
  detachFrameListeners = null
  if (win && !win.isDestroyed()) win.destroy()
}

// The guide sits on top of the desktop but must never reach the capture. Two defences:
// setContentProtection excludes it from screen capture outright, and the outline is drawn
// in the ring just outside the recorded rectangle, so a miss there is still not in frame.
export function showRegionFrame(region: Region | null, owner: BrowserWindow | null): void {
  if (shuttingDown || !owner || owner.isDestroyed() || owner.webContents.isDestroyed()) return
  if (!region) {
    if (frameOwner === owner) hideRegionFrame()
    return
  }
  hideRegionFrame()

  const display = screen.getAllDisplays().find((d) => String(d.id) === region.displayId)
  if (!display) return

  const win = new BrowserWindow({
    ...display.bounds,
    parent: owner,
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
    focusable: false,
    show: false,
    webPreferences: preloadOptions
  })
  frameWin = win
  frameOwner = owner
  const cleanup = (): void => {
    if (frameWin === win) hideRegionFrame()
  }
  owner.once('closed', cleanup)
  owner.webContents.once('destroyed', cleanup)
  owner.webContents.once('render-process-gone', cleanup)
  owner.webContents.once('did-start-loading', cleanup)
  win.webContents.once('render-process-gone', cleanup)
  screen.once('display-removed', cleanup)
  screen.once('display-metrics-changed', cleanup)
  detachFrameListeners = () => {
    owner.removeListener('closed', cleanup)
    owner.webContents.removeListener('destroyed', cleanup)
    owner.webContents.removeListener('render-process-gone', cleanup)
    owner.webContents.removeListener('did-start-loading', cleanup)
    win.webContents.removeListener('render-process-gone', cleanup)
    screen.removeListener('display-removed', cleanup)
    screen.removeListener('display-metrics-changed', cleanup)
  }
  win.setAlwaysOnTop(true, 'screen-saver')
  win.setIgnoreMouseEvents(true, { forward: true })
  win.setContentProtection(true)
  win.on('ready-to-show', () => {
    if (frameWin === win && !win.isDestroyed() && !owner.isDestroyed()) win.showInactive()
  })
  win.on('closed', cleanup)
  loadRenderer(win, 'frame', {
    x: String(region.x),
    y: String(region.y),
    w: String(region.width),
    h: String(region.height)
  })
}

export type Tool = 'sound' | 'screen' | 'shot'

const TOOL_WINDOWS: Record<Tool, { width: number; height: number }> = {
  sound: { width: 440, height: 580 },
  screen: { width: 470, height: 660 },
  shot: { width: 470, height: 640 }
}

const openTools = new Map<Tool, BrowserWindow>()

function keepToolOnTop(win: BrowserWindow): void {
  if (shuttingDown || ![...openTools.values()].includes(win) || win.isDestroyed() ||
      !win.isVisible() || win.isMinimized() || settleRegion) return
  win.setAlwaysOnTop(true, 'pop-up-menu')
  win.moveTop()
}

export function openToolWindow(tool: Tool, owner?: BrowserWindow): void {
  if (shuttingDown) return
  const existing = openTools.get(tool)
  if (existing && !existing.isDestroyed()) {
    if (existing.isMinimized()) existing.restore()
    existing.show()
    keepToolOnTop(existing)
    existing.focus()
    return
  }

  const size = TOOL_WINDOWS[tool] ?? TOOL_WINDOWS.sound
  const { workArea } = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  const width = Math.min(size.width, workArea.width)
  const height = Math.min(size.height, workArea.height)
  const win = new BrowserWindow({
    width,
    height,
    x: Math.round(workArea.x + (workArea.width - width) / 2),
    y: Math.round(workArea.y + (workArea.height - height) / 2),
    minWidth: Math.min(380, width),
    minHeight: Math.min(460, height),
    parent: owner,
    show: false,
    frame: false,
    alwaysOnTop: true,
    backgroundColor: '#0a0a0a',
    icon: iconPath(),
    webPreferences: preloadOptions
  })
  openTools.set(tool, win)
  win.setAlwaysOnTop(true, 'pop-up-menu')
  const raise = (): void => keepToolOnTop(win)
  const recoverPosition = (): void => {
    if (win.isDestroyed()) return
    const bounds = win.getBounds()
    const area = screen.getDisplayMatching(bounds).workArea
    win.setBounds({
      x: Math.round(Math.max(area.x, Math.min(bounds.x, area.x + area.width - bounds.width))),
      y: Math.round(Math.max(area.y, Math.min(bounds.y, area.y + area.height - bounds.height)))
    })
    raise()
  }
  // Native dragging handles mixed-DPI coordinates; never rewrite bounds during a move.
  win.on('show', raise)
  win.on('restore', raise)
  win.on('focus', raise)
  win.on('moved', raise)
  win.on('resize', raise)
  owner?.on('focus', raise)
  screen.on('display-metrics-changed', raise)
  screen.on('display-removed', recoverPosition)
  win.on('ready-to-show', () => {
    if (!shuttingDown && !win.isDestroyed()) win.show()
  })
  win.on('closed', () => {
    owner?.removeListener('focus', raise)
    screen.removeListener('display-metrics-changed', raise)
    screen.removeListener('display-removed', recoverPosition)
    if (openTools.get(tool) === win) openTools.delete(tool)
  })
  loadRenderer(win, 'tools-' + tool)
}

type Rect = { x: number; y: number; width: number; height: number }

const regionWindows = new Map<BrowserWindow, Display>()
let settleRegion: ((r: Region | null) => void) | null = null
let regionOwner: BrowserWindow | null = null

export function selectRegion(hint?: string, owner: BrowserWindow | null = null): Promise<Region | null> {
  if (shuttingDown) return Promise.resolve(null)
  finishRegion(null)
  regionOwner = owner
  const focusedDisplay = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  return new Promise((resolve) => {
    settleRegion = resolve
    owner?.once('closed', cancelRegion)
    owner?.webContents.once('destroyed', cancelRegion)
    owner?.webContents.once('render-process-gone', cancelRegion)
    owner?.webContents.once('did-start-loading', cancelRegion)
    screen.once('display-added', cancelRegion)
    screen.once('display-removed', cancelRegion)
    screen.once('display-metrics-changed', cancelRegion)
    try {
      for (const display of screen.getAllDisplays()) {
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
        regionWindows.set(win, display)
        win.setAlwaysOnTop(true, 'screen-saver')
        win.on('ready-to-show', () => {
          if (!regionWindows.has(win) || win.isDestroyed()) return
          win.showInactive()
          if (display.id === focusedDisplay.id) win.focus()
        })
        win.on('closed', () => {
          if (regionWindows.has(win)) cancelRegion()
        })
        loadRenderer(win, 'region', hint ? { hint } : undefined)
      }
    } catch {
      finishRegion(null)
    }
  })
}

function cancelRegion(): void {
  finishRegion(null)
}

export function finishRegion(rect: Rect | null, sender?: BrowserWindow | null): void {
  if (sender !== undefined && (!sender || !regionWindows.has(sender))) return
  const display = sender ? regionWindows.get(sender) : null
  const resolve = settleRegion
  settleRegion = null
  const owner = regionOwner
  regionOwner = null
  owner?.removeListener('closed', cancelRegion)
  owner?.webContents.removeListener('destroyed', cancelRegion)
  owner?.webContents.removeListener('render-process-gone', cancelRegion)
  owner?.webContents.removeListener('did-start-loading', cancelRegion)
  screen.removeListener('display-added', cancelRegion)
  screen.removeListener('display-removed', cancelRegion)
  screen.removeListener('display-metrics-changed', cancelRegion)
  const windows = [...regionWindows.keys()]
  regionWindows.clear()
  for (const win of windows) {
    if (!win.isDestroyed()) win.destroy()
  }
  if (!shuttingDown && owner && !owner.isDestroyed()) {
    keepToolOnTop(owner)
    owner.focus()
  }
  if (!resolve) return
  if (!rect || !display || rect.width < 8 || rect.height < 8) {
    resolve(null)
    return
  }
  const x = Math.max(0, Math.min(Math.round(rect.x), display.bounds.width))
  const y = Math.max(0, Math.min(Math.round(rect.y), display.bounds.height))
  const width = Math.min(Math.round(rect.width), display.bounds.width - x)
  const height = Math.min(Math.round(rect.height), display.bounds.height - y)
  if (width < 8 || height < 8) {
    resolve(null)
    return
  }
  resolve({
    x,
    y,
    width,
    height,
    displayId: String(display.id),
    displayWidth: display.size.width,
    displayHeight: display.size.height
  })
}

export function closeAuxiliaryWindows(): void {
  shuttingDown = true
  hideRegionFrame()
  finishRegion(null)
  for (const win of openTools.values()) {
    if (!win.isDestroyed()) win.destroy()
  }
}
