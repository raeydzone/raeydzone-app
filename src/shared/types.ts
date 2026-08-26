export const STEP_IDS = [
  'recording',
  'baseEdit',
  'effects',
  'short',
  'thumbnail',
  'uploaded'
] as const

export type StepId = (typeof STEP_IDS)[number]

export const STEP_LABELS: Record<StepId, string> = {
  recording: 'Recording footage',
  baseEdit: 'Base editing',
  effects: 'Effects / memes',
  short: 'Short',
  thumbnail: 'Thumbnail',
  uploaded: 'Uploaded'
}

export type Steps = Record<StepId, string | null>

export interface Video {
  id: string
  name: string
  folder: string
  createdAt: string
  steps: Steps
  thumbnail: string | null
  baseVideo: string | null
  missing?: boolean
}

export interface Stream {
  id: string
  name: string
  folder: string
  createdAt: string
  scheduledAt: string | null
  streamedAt: string | null
  thumbnail: string | null
  notified?: boolean
  missing?: boolean
}

export type LogType =
  | 'video.create' | 'video.rename' | 'video.step.done' | 'video.step.undone'
  | 'video.thumbnail' | 'video.baseVideo' | 'video.premiere' | 'video.files'
  | 'video.remove' | 'video.repair' | 'video.paste'
  | 'stream.create' | 'stream.streamed' | 'stream.unstreamed' | 'stream.schedule'
  | 'stream.thumbnail' | 'stream.files' | 'stream.remove'
  | 'timer.start' | 'timer.stop' | 'timer.recovered'
  | 'system.root' | 'system.rescan'

export interface LogEntry {
  id: string
  ts: string
  type: LogType
  targetId: string | null
  targetName: string | null
  message: string
}

export interface DayRecord {
  date: string
  totalMs: number
  sessions: { start: string; end: string }[]
}

export interface RunningSession {
  start: string
  heartbeat: string
}

export interface UpdateState {
  status: 'idle' | 'checking' | 'downloading' | 'ready' | 'error'
  version: string | null
  percent: number
  error: string | null
}

export interface AppState {
  ready: boolean
  rootPath: string | null
  rootValid: boolean
  hasPremiereTemplate: boolean
  dailyGoalMs: number
  videos: Video[]
  streams: Stream[]
  log: LogEntry[]
  days: Record<string, DayRecord>
  running: RunningSession | null
  freeBytes: number | null
  removableRoot: boolean
  update: UpdateState
  appVersion: string
}

export interface RootProposal {
  path: string
  exists: boolean
  isOneDrive: boolean
  isRemovable: boolean
}

export type DropTarget = 'auto' | 'thumbnail' | 'baseVideo'

export interface DropResult {
  moved: { name: string; to: string; via: 'moved' | 'copied' }[]
  failed: { name: string; reason: string }[]
}

export type FileKind = 'video' | 'image' | 'audio' | 'other'

export interface ProjectFile {
  name: string
  rel: string
  path: string
  bucket: string
  size: number
  modified: string
  kind: FileKind
}
