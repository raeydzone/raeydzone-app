import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type {
  AppState, ArchivePreview, DropResult, DropTarget, ProjectFile, Region, RootProposal,
  ScreenSource, StepId, Stream, Video
} from '@shared/types'

type Result<T> = { ok: true; value: T } | { ok: false; error: string }

async function call<T>(channel: string, ...args: unknown[]): Promise<T> {
  const res = (await ipcRenderer.invoke(channel, ...args)) as Result<T>
  if (!res.ok) throw new Error(res.error)
  return res.value
}

const api = {
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

  popoutTool: (tool: 'sound' | 'screen') => call<void>('tools:popout', tool),
  saveRecording: (videoId: string, name: string, data: Uint8Array, ext: string) =>
    call<string>('tools:save', videoId, name, data, ext),

  screenSources: () => call<ScreenSource[]>('screen:sources'),
  selectRegion: () => call<Region | null>('screen:region'),
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
