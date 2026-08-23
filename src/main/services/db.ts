import { DatabaseSync } from 'node:sqlite'
import path from 'node:path'
import fs from 'node:fs'
import type {
  DayRecord, LogEntry, RunningSession, Steps, Stream, Video
} from '@shared/types'

const LOG_CAP = 20_000

interface Cache {
  videos: Video[]
  streams: Stream[]
  log: LogEntry[]
  days: Record<string, DayRecord>
  running: RunningSession | null
}

let handle: DatabaseSync | null = null
let cache: Cache = { videos: [], streams: [], log: [], days: {}, running: null }

const dir = (root: string): string => path.join(root, '.raeydzone')

export const templatePath = (root: string): string =>
  path.join(dir(root), 'template.prproj')

export function state(): Cache {
  return cache
}

function db(): DatabaseSync {
  if (!handle) throw new Error('Database is not open.')
  return handle
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS videos (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, folder TEXT NOT NULL,
  createdAt TEXT NOT NULL, steps TEXT NOT NULL,
  thumbnail TEXT, baseVideo TEXT, missing INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS streams (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, folder TEXT NOT NULL,
  createdAt TEXT NOT NULL, scheduledAt TEXT, streamedAt TEXT,
  thumbnail TEXT, notified INTEGER NOT NULL DEFAULT 0, missing INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS log (
  id TEXT PRIMARY KEY, ts TEXT NOT NULL, type TEXT NOT NULL,
  targetId TEXT, targetName TEXT, message TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS log_ts ON log (ts DESC);
CREATE TABLE IF NOT EXISTS days (
  date TEXT PRIMARY KEY, totalMs INTEGER NOT NULL, sessions TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
`

export function open(root: string): void {
  close()
  fs.mkdirSync(dir(root), { recursive: true })
  handle = new DatabaseSync(path.join(dir(root), 'raeydzone.db'))
  handle.exec('PRAGMA journal_mode = WAL')
  handle.exec('PRAGMA synchronous = NORMAL')
  handle.exec(SCHEMA)
  importLegacy(root)
  load()
}

function load(): void {
  const d = db()
  cache = {
    videos: d.prepare('SELECT * FROM videos ORDER BY createdAt DESC').all().map(rowToVideo),
    streams: d
      .prepare('SELECT * FROM streams ORDER BY createdAt DESC')
      .all()
      .map(rowToStream),
    log: d
      .prepare('SELECT * FROM log ORDER BY ts DESC LIMIT 1000')
      .all() as unknown as LogEntry[],
    days: Object.fromEntries(
      (d.prepare('SELECT * FROM days').all() as unknown as DayRow[])
        .map((r) => [r.date, { date: r.date, totalMs: r.totalMs, sessions: JSON.parse(r.sessions) }])
    ),
    running: readRunning()
  }
}

type DayRow = { date: string; totalMs: number; sessions: string }

type VideoRow = {
  id: string; name: string; folder: string; createdAt: string; steps: string
  thumbnail: string | null; baseVideo: string | null; missing: number
}

type StreamRow = {
  id: string; name: string; folder: string; createdAt: string
  scheduledAt: string | null; streamedAt: string | null
  thumbnail: string | null; notified: number; missing: number
}

const rowToVideo = (r: unknown): Video => {
  const row = r as VideoRow
  return {
    id: row.id,
    name: row.name,
    folder: row.folder,
    createdAt: row.createdAt,
    steps: JSON.parse(row.steps) as Steps,
    thumbnail: row.thumbnail,
    baseVideo: row.baseVideo,
    missing: !!row.missing
  }
}

const rowToStream = (r: unknown): Stream => {
  const row = r as StreamRow
  return {
    id: row.id,
    name: row.name,
    folder: row.folder,
    createdAt: row.createdAt,
    scheduledAt: row.scheduledAt,
    streamedAt: row.streamedAt,
    thumbnail: row.thumbnail,
    notified: !!row.notified,
    missing: !!row.missing
  }
}

export function saveVideo(v: Video): void {
  db()
    .prepare(
      `INSERT INTO videos (id, name, folder, createdAt, steps, thumbnail, baseVideo, missing)
       VALUES (@id, @name, @folder, @createdAt, @steps, @thumbnail, @baseVideo, @missing)
       ON CONFLICT(id) DO UPDATE SET
         name = @name, folder = @folder, steps = @steps,
         thumbnail = @thumbnail, baseVideo = @baseVideo, missing = @missing`
    )
    .run({
      id: v.id,
      name: v.name,
      folder: v.folder,
      createdAt: v.createdAt,
      steps: JSON.stringify(v.steps),
      thumbnail: v.thumbnail,
      baseVideo: v.baseVideo,
      missing: v.missing ? 1 : 0
    })
  if (!cache.videos.some((x) => x.id === v.id)) cache.videos.unshift(v)
}

export function saveStream(s: Stream): void {
  db()
    .prepare(
      `INSERT INTO streams
         (id, name, folder, createdAt, scheduledAt, streamedAt, thumbnail, notified, missing)
       VALUES
         (@id, @name, @folder, @createdAt, @scheduledAt, @streamedAt, @thumbnail, @notified, @missing)
       ON CONFLICT(id) DO UPDATE SET
         name = @name, folder = @folder, scheduledAt = @scheduledAt,
         streamedAt = @streamedAt, thumbnail = @thumbnail,
         notified = @notified, missing = @missing`
    )
    .run({
      id: s.id,
      name: s.name,
      folder: s.folder,
      createdAt: s.createdAt,
      scheduledAt: s.scheduledAt,
      streamedAt: s.streamedAt,
      thumbnail: s.thumbnail,
      notified: s.notified ? 1 : 0,
      missing: s.missing ? 1 : 0
    })
  if (!cache.streams.some((x) => x.id === s.id)) cache.streams.unshift(s)
}

export function addLog(entry: LogEntry): void {
  db()
    .prepare(
      `INSERT INTO log (id, ts, type, targetId, targetName, message)
       VALUES (@id, @ts, @type, @targetId, @targetName, @message)`
    )
    .run(entry as unknown as Record<string, string | null>)
  cache.log.unshift(entry)
  if (cache.log.length > 1000) cache.log.length = 1000
}

export function trimLog(): void {
  db()
    .prepare(
      `DELETE FROM log WHERE id NOT IN (SELECT id FROM log ORDER BY ts DESC LIMIT ?)`
    )
    .run(LOG_CAP)
}

export function saveDay(rec: DayRecord): void {
  db()
    .prepare(
      `INSERT INTO days (date, totalMs, sessions) VALUES (@date, @totalMs, @sessions)
       ON CONFLICT(date) DO UPDATE SET totalMs = @totalMs, sessions = @sessions`
    )
    .run({ date: rec.date, totalMs: rec.totalMs, sessions: JSON.stringify(rec.sessions) })
  cache.days[rec.date] = rec
}

function readRunning(): RunningSession | null {
  const row = db().prepare('SELECT value FROM meta WHERE key = ?').get('running') as
    | unknown as { value: string } | undefined
  return row ? (JSON.parse(row.value) as RunningSession) : null
}

export function setRunning(r: RunningSession | null): void {
  if (r) {
    db()
      .prepare(
        `INSERT INTO meta (key, value) VALUES ('running', @value)
         ON CONFLICT(key) DO UPDATE SET value = @value`
      )
      .run({ value: JSON.stringify(r) })
  } else {
    db().prepare('DELETE FROM meta WHERE key = ?').run('running')
  }
  cache.running = r
}

export function close(): void {
  if (!handle) return
  handle.close()
  handle = null
}

function importLegacy(root: string): void {
  const legacy = path.join(dir(root), 'db.json')
  if (!fs.existsSync(legacy)) return
  const already = db().prepare('SELECT COUNT(*) AS n FROM videos').get() as unknown as {
    n: number
  }
  if (already.n > 0) return

  try {
    const raw = JSON.parse(fs.readFileSync(legacy, 'utf-8'))
    db().exec('BEGIN')
    try {
      for (const v of raw.videos ?? []) saveVideo(v as Video)
      for (const s of raw.streams ?? []) saveStream(s as Stream)
      for (const e of (raw.log ?? []).slice().reverse()) addLog(e as LogEntry)
      for (const rec of Object.values(raw.days ?? {})) saveDay(rec as DayRecord)
      if (raw.running) setRunning(raw.running as RunningSession)
      db().exec('COMMIT')
    } catch (err) {
      db().exec('ROLLBACK')
      throw err
    }
    fs.renameSync(legacy, legacy + '.migrated')
  } catch (err) {
    console.error('legacy import failed', err)
  }
}
