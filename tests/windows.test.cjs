const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const fs = require('node:fs')
const path = require('node:path')
const { test } = require('node:test')
const ts = require('typescript')

function loadModule(relativePath, dependencies) {
  const filename = path.join(__dirname, '..', relativePath)
  const { outputText } = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true }
  })
  const module = { exports: {} }
  const localRequire = (id) => id in dependencies ? dependencies[id] : require(id)
  new Function('require', 'module', 'exports', '__dirname', outputText)(
    localRequire, module, module.exports, path.dirname(filename)
  )
  return module.exports
}

function setup() {
  const displays = [
    {
      id: 1, scaleFactor: 1,
      bounds: { x: 0, y: 0, width: 1920, height: 1080 },
      workArea: { x: 0, y: 0, width: 1920, height: 1040 },
      size: { width: 1920, height: 1080 }
    },
    {
      id: 2, scaleFactor: 1.5,
      bounds: { x: -1707, y: -200, width: 1707, height: 960 },
      workArea: { x: -1707, y: -200, width: 1707, height: 920 },
      size: { width: 1707, height: 960 }
    }
  ]
  const instances = []
  class Window extends EventEmitter {
    constructor(options = {}) {
      super()
      this.options = options
      this.bounds = { x: 0, y: 0, width: 1280, height: 820, ...options }
      this.destroyed = false
      this.visible = false
      this.minimized = false
      this.focusCount = 0
      this.raiseCount = 0
      this.setBoundsCount = 0
      this.webContents = Object.assign(new EventEmitter(), {
        destroyed: false,
        isDestroyed() { return this.destroyed },
        setWindowOpenHandler() {}
      })
      instances.push(this)
    }
    isDestroyed() { return this.destroyed }
    isVisible() { return this.visible }
    isMinimized() { return this.minimized }
    setAlwaysOnTop(flag, level) { this.topmost = { flag, level } }
    moveTop() { this.raiseCount++ }
    show() { this.visible = true; this.emit('show') }
    showInactive() { this.visible = true }
    focus() { this.focusCount++; this.emit('focus') }
    restore() { this.minimized = false; this.emit('restore') }
    getBounds() { return this.bounds }
    setBounds(bounds) { Object.assign(this.bounds, bounds); this.setBoundsCount++ }
    destroy() {
      this.destroyed = true
      this.webContents.destroyed = true
      this.webContents.emit('destroyed')
      this.emit('closed')
    }
    setIgnoreMouseEvents() {}
    setContentProtection() {}
    loadFile() {}
  }
  const screen = Object.assign(new EventEmitter(), {
    getAllDisplays: () => displays,
    getPrimaryDisplay: () => displays[0],
    getCursorScreenPoint: () => ({ x: -100, y: 100 }),
    getDisplayNearestPoint: () => displays[1],
    getDisplayMatching: () => displays[0]
  })
  const electron = { BrowserWindow: Window, screen }
  const api = loadModule('src/main/windows.ts', { electron })
  return { api, displays, instances, screen, Window, electron }
}

test('tool popup belongs to main window and opens inside a monitor with negative coordinates', () => {
  const { api, instances, Window, displays } = setup()
  const owner = new Window()
  api.openToolWindow('screen', owner)
  const popup = instances[1]
  popup.emit('ready-to-show')
  assert.equal(popup.options.parent, owner)
  assert.deepEqual(popup.topmost, { flag: true, level: 'pop-up-menu' })
  assert.ok(popup.bounds.x >= displays[1].workArea.x)
  assert.ok(popup.bounds.x + popup.bounds.width <= 0)
  assert.ok(popup.raiseCount > 0)
})

test('focusing the main app and crossing displays raises the popup without moving or focusing it', () => {
  const { api, instances, Window, screen } = setup()
  const owner = new Window()
  api.openToolWindow('sound', owner)
  const popup = instances[1]
  popup.emit('ready-to-show')
  popup.bounds.x = 800
  const initialRaises = popup.raiseCount
  owner.focus()
  popup.emit('moved')
  popup.emit('resize')
  screen.emit('display-metrics-changed')
  assert.ok(popup.raiseCount > initialRaises)
  assert.equal(popup.focusCount, 0)
  assert.equal(popup.setBoundsCount, 0)
  popup.minimized = true
  api.openToolWindow('sound', owner)
  assert.equal(popup.minimized, false)
  assert.equal(instances.length, 2)
  assert.equal(popup.bounds.x, 800)
  popup.destroy()
  assert.equal(owner.listenerCount('focus'), 0)
  assert.equal(screen.listenerCount('display-metrics-changed'), 0)
  assert.equal(screen.listenerCount('display-removed'), 0)
})

test('box on another monitor returns that monitor and clamps its local DIP coordinates', async () => {
  const { api, instances, Window, displays, screen } = setup()
  const owner = new Window()
  const pending = api.selectRegion(undefined, owner)
  const overlays = instances.slice(1)
  assert.equal(overlays.length, displays.length)
  overlays.forEach((overlay) => overlay.emit('ready-to-show'))
  api.finishRegion({ x: 1500, y: 800, width: 500, height: 400 }, overlays[1])
  assert.deepEqual(await pending, {
    x: 1500, y: 800, width: 207, height: 160,
    displayId: '2', displayWidth: 1707, displayHeight: 960
  })
  assert.ok(overlays.every((overlay) => overlay.destroyed))
  assert.equal(owner.focusCount, 1)
  assert.equal(owner.topmost, undefined)
  assert.equal(screen.listenerCount('display-removed'), 0)
})

test('replacing a picker settles the old request and ignores late messages from old overlays', async () => {
  const { api, instances } = setup()
  const oldPending = api.selectRegion()
  const oldOverlay = instances[0]
  const pending = api.selectRegion()
  assert.equal(await oldPending, null)
  api.finishRegion(null, oldOverlay)
  assert.equal(instances[2].destroyed, false)
  api.finishRegion({ x: 10, y: 20, width: 100, height: 80 }, instances[2])
  assert.equal((await pending).displayId, '1')
})

test('picker stays above tool popups and returns stacking to the tool when canceled', async () => {
  const { api, instances, Window } = setup()
  const main = new Window()
  api.openToolWindow('screen', main)
  const popup = instances[1]
  popup.emit('ready-to-show')
  const pending = api.selectRegion(undefined, popup)
  const initialRaises = popup.raiseCount
  main.focus()
  popup.emit('moved')
  assert.equal(popup.raiseCount, initialRaises)
  api.finishRegion(null, instances[2])
  assert.equal(await pending, null)
  assert.ok(popup.raiseCount > initialRaises)
})

test('display changes and owner closure cancel selection and tear down all overlays', async () => {
  for (const event of ['display-added', 'display-removed', 'display-metrics-changed', 'owner-closed']) {
    const { api, instances, Window, screen } = setup()
    const owner = new Window()
    const pending = api.selectRegion(undefined, owner)
    event === 'owner-closed' ? owner.destroy() : screen.emit(event)
    assert.equal(await pending, null)
    assert.ok(instances.slice(1).every((overlay) => overlay.destroyed))
    instances.slice(1).forEach((overlay) => overlay.emit('ready-to-show'))
    assert.ok(instances.slice(1).every((overlay) => !overlay.visible))
    assert.equal(owner.listenerCount('closed'), 0)
  }
})

test('screen sources prefer the requesting window monitor and preserve IDs for other monitors', async () => {
  const { electron, displays, Window } = setup()
  const handlers = new Map()
  electron.BrowserWindow.fromWebContents = (sender) => sender.window
  electron.screen.getDisplayMatching = () => displays[1]
  electron.ipcMain = { handle: (channel, fn) => handlers.set(channel, fn), on: () => {} }
  electron.desktopCapturer = {
    getSources: async () => [
      { id: 'screen:1:0', name: 'Screen 1', display_id: '1' },
      { id: 'window:3:0', name: 'Window', display_id: '' },
      { id: 'screen:2:0', name: 'Screen 2', display_id: '2' }
    ]
  }
  const dependencies = { electron }
  for (const id of ['./services/db', './services/library', './services/timer', './services/updater',
    './services/premiere', './services/log', './services/settings', './util/paths', './util/dragIcon', './windows']) {
    dependencies[id] = {}
  }
  const ipc = loadModule('src/main/ipc.ts', dependencies)
  ipc.register()
  const response = await handlers.get('screen:sources')({ sender: { window: new Window() } })
  assert.equal(response.ok, true)
  assert.deepEqual(response.value.map((source) => source.id), ['screen:2:0', 'screen:1:0', 'window:3:0'])
})

const region = {
  x: 100, y: 100, width: 400, height: 300,
  displayId: '2', displayWidth: 1707, displayHeight: 960
}

test('closing the recorder destroys its guide without renderer cleanup or late revival', () => {
  const { api, instances, Window, screen } = setup()
  const owner = new Window()
  api.showRegionFrame(region, owner)
  const guide = instances[1]
  assert.equal(guide.options.parent, owner)
  owner.destroy()
  assert.equal(guide.destroyed, true)
  guide.emit('ready-to-show')
  assert.equal(guide.visible, false)
  assert.equal(screen.listenerCount('display-removed'), 0)
  assert.equal(screen.listenerCount('display-metrics-changed'), 0)
  assert.equal(owner.webContents.listenerCount('render-process-gone'), 0)
  api.showRegionFrame(region, owner)
  assert.equal(instances.length, 2)
})

test('renderer failure, reload, and monitor changes remove the guide', () => {
  for (const event of ['destroyed', 'render-process-gone', 'did-start-loading', 'display-removed', 'display-metrics-changed']) {
    const { api, instances, Window, screen } = setup()
    const owner = new Window()
    api.showRegionFrame(region, owner)
    const guide = instances[1]
    const emitter = event.startsWith('display-') ? screen : owner.webContents
    emitter.emit(event)
    assert.equal(guide.destroyed, true, event)
    assert.equal(owner.listenerCount('closed'), 0)
    assert.equal(owner.webContents.listenerCount('did-start-loading'), 0)
  }
})

test('old and unrelated recorders cannot clear a replacement guide', () => {
  const { api, instances, Window } = setup()
  const oldOwner = new Window()
  api.showRegionFrame(region, oldOwner)
  const oldGuide = instances[1]
  const owner = new Window()
  api.showRegionFrame(region, owner)
  const guide = instances[3]
  assert.equal(oldGuide.destroyed, true)
  oldGuide.emit('ready-to-show')
  assert.equal(oldGuide.visible, false)
  api.showRegionFrame(null, oldOwner)
  oldOwner.destroy()
  assert.equal(guide.destroyed, false)
  api.showRegionFrame(null, owner)
  assert.equal(guide.destroyed, true)
})

test('guides are not created for detached displays or unavailable owners', () => {
  const { api, instances, Window } = setup()
  const owner = new Window()
  api.showRegionFrame({ ...region, displayId: 'missing' }, owner)
  api.showRegionFrame(region, null)
  assert.equal(instances.length, 1)
})

test('shutdown destroys guides, pickers, and tools and blocks delayed requests', async () => {
  const { api, instances, Window } = setup()
  const owner = new Window()
  api.openToolWindow('screen', owner)
  const recorder = instances[1]
  api.showRegionFrame(region, recorder)
  const pending = api.selectRegion(undefined, recorder)
  const auxiliary = instances.slice(1)
  api.closeAuxiliaryWindows()
  api.closeAuxiliaryWindows()
  assert.equal(await pending, null)
  assert.ok(auxiliary.every((window) => window.destroyed))
  auxiliary.forEach((window) => window.emit('ready-to-show'))
  assert.ok(auxiliary.every((window) => !window.visible))
  const count = instances.length
  api.showRegionFrame(region, owner)
  api.openToolWindow('screen', owner)
  assert.equal(await api.selectRegion(undefined, owner), null)
  assert.equal(instances.length, count)
})

test('main-window destruction and before-quit both clean up auxiliary windows', async () => {
  for (const event of ['main-closed', 'before-quit']) {
    const { api, instances, electron } = setup()
    let readyWork
    electron.app = Object.assign(new EventEmitter(), {
      setAppUserModelId() {},
      quit() {},
      whenReady: () => ({ then: (callback) => { readyWork = Promise.resolve().then(callback) } })
    })
    electron.session = { defaultSession: { setPermissionRequestHandler() {}, setDisplayMediaRequestHandler() {} } }
    loadModule('src/main/index.ts', {
      electron,
      './windows': api,
      './protocol': { registerScheme() {}, serveFrom() {} },
      './services/db': { close() {} },
      './services/library': {},
      './services/timer': { shutdown() {} },
      './services/updater': { init() {} },
      './services/settings': { loadSettings: async () => ({}) },
      './ipc': { root() {}, attach() {}, register() {} },
      './util/paths': {}
    })
    await readyWork
    const main = instances[0]
    api.openToolWindow('screen', main)
    api.showRegionFrame(region, instances[1])
    event === 'main-closed' ? main.destroy() : electron.app.emit('before-quit')
    assert.ok(instances.slice(1).every((window) => window.destroyed), event)
  }
})
