import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type {
  AppState, ArchivePreview, DropResult, DropTarget, ProjectFile, Region, RootProposal,
  ScreenSource, StepId, Stream, Video
} from '@shared/types'
import type {
  ClaudeStatus, FeatureReport, ImageRequest, ImageResult, OpenRouterStatus, ReportInput, SendRequest,
  SpendSummary, StudioEvent, StudioFile, ToolCall, ToolReply
} from '@shared/studio'

type Result<T> = { ok: true; value: T } | { ok: false; error: string }

async function call<T>(channel: string, ...args: unknown[]): Promise<T> {
  const res = (await ipcRenderer.invoke(channel, ...args)) as Result<T>
  if (!res.ok) throw new Error(res.error)
  return res.value
}

function listen<T extends unknown[]>(channel: string, cb: (...args: T) => void): () => void {
  const listener = (_e: unknown, ...args: unknown[]): void => cb(...(args as T))
  ipcRenderer.on(channel, listener)
  return () => {
    ipcRenderer.off(channel, listener)
  }
}

type Imported = { file: string; name: string }

const studio = {
  load: (projectId: string) => call<StudioFile | null>('studio:load', projectId),
  save: (projectId: string, json: string) => call<void>('studio:save', projectId, json),
  putAsset: (projectId: string, file: string, data: Uint8Array) =>
    call<void>('studio:putAsset', projectId, file, data),
  readAsset: (projectId: string, file: string) =>
    call<Uint8Array>('studio:readAsset', projectId, file),
  importFiles: (projectId: string, paths: string[]) =>
    call<Imported[]>('studio:import', projectId, paths),
  paste: (projectId: string) => call<Imported | null>('studio:paste', projectId),
  prune: (projectId: string, keep: string[]) => call<number>('studio:prune', projectId, keep),
  pickImages: () => call<string[]>('studio:pickImages'),
  apply: (projectId: string, data: Uint8Array, ext: 'png' | 'jpg') =>
    call<string>('studio:apply', projectId, data, ext),
  send: (req: SendRequest) => call<void>('studio:send', req),
  stop: (variantId: string) => call<void>('studio:stop', variantId),
  image: (req: ImageRequest) => call<ImageResult>('studio:image', req),
  toolDone: (callId: string, reply: ToolReply) => call<void>('studio:toolDone', callId, reply),
  onTool: (cb: (call: ToolCall) => void) => listen<[ToolCall]>('studio:tool', cb),
  onEvent: (cb: (variantId: string, event: StudioEvent) => void) =>
    listen<[string, StudioEvent]>('studio:event', cb),
  spend: (projectId: string | null) => call<SpendSummary>('studio:spend', projectId),
  onSpendChanged: (cb: () => void) => listen<[]>('studio:spendChanged', cb),
  reports: () => call<FeatureReport[]>('studio:reports'),
  report: (input: ReportInput) => call<boolean>('studio:report', input),
  setReportDone: (id: string, done: boolean) => call<FeatureReport[]>('studio:reportDone', id, done),
  removeReport: (id: string) => call<FeatureReport[]>('studio:reportRemove', id),
  onReports: (cb: (reports: FeatureReport[]) => void) => listen<[FeatureReport[]]>('studio:reportsChanged', cb)
}

const ai = {
  claudeStatus: () => call<ClaudeStatus>('ai:claudeStatus'),
  claudeConnect: () => call<void>('ai:claudeConnect'),
  claudeLocate: () => call<ClaudeStatus>('ai:claudeLocate'),
  openrouterStatus: () => call<OpenRouterStatus>('ai:openrouterStatus'),
  setOpenrouterKey: (key: string | null) => call<OpenRouterStatus>('ai:openrouterKey', key)
}

const api = {
  studio,
  ai,

  getState: () => call<AppState>('state:get'),
  onStateChanged: (cb: (state: AppState) => void) => {
    const listener = (_e: unknown, state: AppState): void => cb(state)
    ipcRenderer.on('state:changed', listener)
    return (): void => {
      ipcRenderer.off('state:changed', listener)
    }
  },

  proposeRoot: () => call<RootProposal>('root:propose'),
  pickRoot: () => call<string | null>('root:pick'),
  setRoot: (p: string) => call<string>('root:set', p),
  setGoal: (ms: number) => call<void>('settings:goal', ms),

  setArchive: (autoArchive: boolean, days: number) =>
    call<void>('archive:settings', autoArchive, days),
  archivePreview: () => call<ArchivePreview>('archive:preview'),
  runArchive: () => call<{ count: number; bytes: number }>('archive:run'),
  archiveVideo: (id: string) => call<number>('archive:video', id),

  createVideo: (name: string) => call<Video>('videos:create', name),
  renameVideo: (id: string, name: string) => call<Video>('videos:rename', id, name),
  toggleStep: (id: string, step: StepId) => call<Video>('videos:step', id, step),
  openPremiere: (id: string) => call<string | null>('videos:premiere', id),
  removeVideo: (id: string, deleteFolder: boolean) =>
    call<void>('videos:remove', id, deleteFolder),

  createStream: (name: string) => call<Stream>('streams:create', name),
  setStreamed: (id: string, done: boolean) => call<Stream>('streams:streamed', id, done),
  setSchedule: (id: string, iso: string | null) =>
    call<Stream>('streams:schedule', id, iso),
  removeStream: (id: string, deleteFolder: boolean) =>
    call<void>('streams:remove', id, deleteFolder),

  dropFiles: (kind: 'video' | 'stream', id: string, paths: string[], target: DropTarget) =>
    call<DropResult>('files:drop', kind, id, paths, target),
  pickFiles: (target: DropTarget) => call<string[]>('files:pick', target),
  reveal: (kind: 'video' | 'stream', id: string) => call<void>('files:reveal', kind, id),
  listFiles: (kind: 'video' | 'stream', id: string) =>
    call<ProjectFile[]>('files:list', kind, id),
  pasteClipboard: (kind: 'video' | 'stream', id: string) =>
    call<DropResult>('files:paste', kind, id),
  showFile: (target: string) => call<void>('files:showFile', target),
  openFile: (target: string) => call<void>('files:openFile', target),
  startDrag: (paths: string[]) => ipcRenderer.send('files:drag', paths),
  pathsOf: (files: File[]) => files.map((f) => webUtils.getPathForFile(f)),

  checkUpdate: () => call<void>('update:check'),
  openUpdateLog: () => call<void>('update:log'),
  installUpdate: () => call<void>('update:install'),

  startTimer: () => call<void>('timer:start'),
  stopTimer: () => call<number>('timer:stop'),
  moveTime: (from: string, to: string, ms: number) => call<void>('timer:move', from, to, ms),

  popoutTool: (tool: 'sound' | 'screen' | 'shot') => call<void>('tools:popout', tool),
  saveRecording: (projectId: string, name: string, data: Uint8Array, ext: string) =>
    call<string>('tools:save', projectId, name, data, ext),

  screenSources: () => call<ScreenSource[]>('screen:sources'),
  selectRegion: (hint?: string) => call<Region | null>('screen:region', hint),
  showRegionFrame: (region: Region | null) => call<void>('screen:frame', region),
  finishRegion: (rect: { x: number; y: number; width: number; height: number } | null) =>
    call<void>('screen:regionDone', rect),

  rescan: () => call<{ added: number; missing: number }>('system:rescan'),
  repair: () => call<number>('system:repair'),
  openRoot: () => call<void>('system:openRoot'),
  openTemplateFolder: () => call<void>('system:openTemplateFolder'),

  minimize: () => ipcRenderer.send('window:minimize'),
  maximize: () => ipcRenderer.send('window:maximize'),
  close: () => ipcRenderer.send('window:close')
}

export type RaeydZoneApi = typeof api

contextBridge.exposeInMainWorld('raeydzone', api)
