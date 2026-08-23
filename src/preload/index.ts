import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type {
  AppState, DropResult, DropTarget, RootProposal, StepId, Stream, Video
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

  createVideo: (name: string) => call<Video>('videos:create', name),
  renameVideo: (id: string, name: string) => call<Video>('videos:rename', id, name),
  toggleStep: (id: string, step: StepId) => call<Video>('videos:step', id, step),
  openPremiere: (id: string) => call<string | null>('videos:premiere', id),

  createStream: (name: string) => call<Stream>('streams:create', name),
  setStreamed: (id: string, done: boolean) => call<Stream>('streams:streamed', id, done),
  setSchedule: (id: string, iso: string | null) =>
    call<Stream>('streams:schedule', id, iso),

  dropFiles: (kind: 'video' | 'stream', id: string, paths: string[], target: DropTarget) =>
    call<DropResult>('files:drop', kind, id, paths, target),
  pickFiles: (target: DropTarget) => call<string[]>('files:pick', target),
  reveal: (kind: 'video' | 'stream', id: string) => call<void>('files:reveal', kind, id),
  pathsOf: (files: File[]) => files.map((f) => webUtils.getPathForFile(f)),

  checkUpdate: () => call<void>('update:check'),
  installUpdate: () => call<void>('update:install'),

  startTimer: () => call<void>('timer:start'),
  stopTimer: () => call<number>('timer:stop'),

  rescan: () => call<{ added: number; missing: number }>('system:rescan'),
  openRoot: () => call<void>('system:openRoot'),
  openTemplateFolder: () => call<void>('system:openTemplateFolder'),

  minimize: () => ipcRenderer.send('window:minimize'),
  maximize: () => ipcRenderer.send('window:maximize'),
  close: () => ipcRenderer.send('window:close')
}

export type RaeydZoneApi = typeof api

contextBridge.exposeInMainWorld('raeydzone', api)
