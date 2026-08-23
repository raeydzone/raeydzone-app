import { shell } from 'electron'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import fs from 'node:fs/promises'
import * as db from './db'
import { log } from './log'
import { createProjectFile, launch } from './premiere'
import {
  IMAGE_EXTS, VIDEO_EXTS, assertInside, exists, moveFile,
  sanitizeFolderName, uniqueFile, uniqueFolder
} from '../util/paths'
import { STEP_IDS } from '@shared/types'
import type { DropResult, DropTarget, StepId, Steps, Stream, Video } from '@shared/types'

const THUMB_STEM = 'thumbnail'
const BASE_STEM = 'raw_base_video'

export const videosDir = (root: string): string => path.join(root, 'Videos')
export const streamsDir = (root: string): string => path.join(root, 'Streams')

export const videoPath = (root: string, v: Video): string =>
  path.join(videosDir(root), v.folder)
export const streamPath = (root: string, s: Stream): string =>
  path.join(streamsDir(root), s.folder)

export const prprojPath = (root: string, v: Video): string =>
  path.join(videoPath(root, v), v.folder + '.prproj')

export async function ensureRoot(root: string): Promise<void> {
  await fs.mkdir(videosDir(root), { recursive: true })
  await fs.mkdir(streamsDir(root), { recursive: true })
}

const emptySteps = (): Steps =>
  Object.fromEntries(STEP_IDS.map((s) => [s, null])) as Steps

async function findByStem(dir: string, stem: string): Promise<string | null> {
  try {
    const entries = await fs.readdir(dir)
    return entries.find((e) => path.basename(e, path.extname(e)) === stem) ?? null
  } catch {
    return null
  }
}

function findVideo(id: string): Video {
  const video = db.state().videos.find((v) => v.id === id)
  if (!video) throw new Error('Video not found.')
  return video
}

function findStream(id: string): Stream {
  const stream = db.state().streams.find((s) => s.id === id)
  if (!stream) throw new Error('Stream not found.')
  return stream
}

function folderNameFrom(raw: string): string {
  const base = sanitizeFolderName(raw.trim())
  if (!base) throw new Error('That name has no usable characters.')
  return base
}

export async function createVideo(root: string, rawName: string): Promise<Video> {
  const name = rawName.trim()
  const base = folderNameFrom(name)

  await ensureRoot(root)
  const folder = await uniqueFolder(videosDir(root), base)
  const dir = path.join(videosDir(root), folder)
  await fs.mkdir(path.join(dir, 'footage'), { recursive: true })
  await fs.mkdir(path.join(dir, 'assets'), { recursive: true })
  await createProjectFile(root, dir, folder)

  const video: Video = {
    id: randomUUID(),
    name,
    folder,
    createdAt: new Date().toISOString(),
    steps: emptySteps(),
    thumbnail: null,
    baseVideo: null
  }
  db.saveVideo(video)
  log('video.create', 'Created video "' + name + '"', { id: video.id, name })
  return video
}

export async function renameVideo(
  root: string,
  id: string,
  rawName: string
): Promise<Video> {
  const video = findVideo(id)
  const name = rawName.trim()
  const base = folderNameFrom(name)
  const previous = video.name

  if (base === video.folder) {
    video.name = name
    db.saveVideo(video)
    return video
  }

  const folder = await uniqueFolder(videosDir(root), base)
  const to = path.join(videosDir(root), folder)
  await fs.rename(videoPath(root, video), to)

  const oldProj = path.join(to, video.folder + '.prproj')
  if (await exists(oldProj)) {
    await fs.rename(oldProj, path.join(to, folder + '.prproj'))
  }

  video.name = name
  video.folder = folder
  db.saveVideo(video)
  log('video.rename', 'Renamed "' + previous + '" to "' + name + '"', { id, name })
  return video
}

export function toggleStep(id: string, step: StepId): Video {
  const video = findVideo(id)
  const done = video.steps[step] === null
  video.steps[step] = done ? new Date().toISOString() : null
  db.saveVideo(video)
  log(
    done ? 'video.step.done' : 'video.step.undone',
    (done ? 'Completed' : 'Reopened') + ' ' + step + ' on "' + video.name + '"',
    { id, name: video.name }
  )
  return video
}

export async function createStream(root: string, rawName: string): Promise<Stream> {
  const name = rawName.trim()
  const base = folderNameFrom(name)

  await ensureRoot(root)
  const folder = await uniqueFolder(streamsDir(root), base)
  await fs.mkdir(path.join(streamsDir(root), folder), { recursive: true })

  const stream: Stream = {
    id: randomUUID(),
    name,
    folder,
    createdAt: new Date().toISOString(),
    scheduledAt: null,
    streamedAt: null,
    thumbnail: null
  }
  db.saveStream(stream)
  log('stream.create', 'Created stream "' + name + '"', { id: stream.id, name })
  return stream
}

export function setStreamed(id: string, streamed: boolean): Stream {
  const stream = findStream(id)
  stream.streamedAt = streamed ? new Date().toISOString() : null
  db.saveStream(stream)
  log(
    streamed ? 'stream.streamed' : 'stream.unstreamed',
    (streamed ? 'Marked streamed' : 'Reopened') + ' "' + stream.name + '"',
    { id, name: stream.name }
  )
  return stream
}

export function setSchedule(id: string, iso: string | null): Stream {
  const stream = findStream(id)
  stream.scheduledAt = iso
  stream.notified = false
  db.saveStream(stream)
  log('stream.schedule', 'Rescheduled "' + stream.name + '"', { id, name: stream.name })
  return stream
}

async function replaceSlot(dir: string, stem: string, src: string): Promise<string> {
  const ext = path.extname(src).toLowerCase()
  const existing = await findByStem(dir, stem)
  if (existing) await fs.unlink(path.join(dir, existing)).catch(() => {})
  const filename = stem + ext
  await moveFile(src, path.join(dir, filename))
  return filename
}

function describeMoves(moved: { name: string; to: string }[]): string {
  if (moved.length === 1) {
    const [only] = moved
    const dir = path.dirname(only.to)
    return dir === '.' ? 'Moved ' + only.name : 'Moved ' + only.name + ' to ' + dir
  }
  const byDir = new Map<string, number>()
  for (const m of moved) {
    const dir = path.dirname(m.to)
    byDir.set(dir, (byDir.get(dir) ?? 0) + 1)
  }
  const parts = [...byDir.entries()].map(
    ([dir, n]) => n + (dir === '.' ? ' files' : ' to ' + dir)
  )
  return 'Moved ' + parts.join(', ')
}

export async function dropFiles(
  root: string,
  kind: 'video' | 'stream',
  id: string,
  sources: string[],
  target: DropTarget
): Promise<DropResult> {
  const entity = kind === 'video' ? findVideo(id) : findStream(id)
  const dir =
    kind === 'video'
      ? videoPath(root, entity as Video)
      : streamPath(root, entity as Stream)
  assertInside(root, dir)
  await fs.mkdir(dir, { recursive: true })
  if (kind === 'video') await repairVideo(root, entity as Video)
  else await repairStream(root, entity as Stream)

  const result: DropResult = { moved: [], failed: [] }

  for (const src of sources) {
    const ext = path.extname(src).toLowerCase()
    const name = path.basename(src)
    try {
      if (target === 'thumbnail') {
        if (!IMAGE_EXTS.has(ext)) throw new Error('Not an image file')
        const filename = await replaceSlot(dir, THUMB_STEM, src)
        entity.thumbnail = filename
        if (kind === 'video') db.saveVideo(entity as Video)
        else db.saveStream(entity as Stream)
        result.moved.push({ name, to: filename })
        log(
          kind === 'video' ? 'video.thumbnail' : 'stream.thumbnail',
          'Set thumbnail on "' + entity.name + '"',
          { id, name: entity.name }
        )
        continue
      }

      if (target === 'baseVideo') {
        if (!VIDEO_EXTS.has(ext)) throw new Error('Not a video file')
        const filename = await replaceSlot(dir, BASE_STEM, src)
        ;(entity as Video).baseVideo = filename
        db.saveVideo(entity as Video)
        result.moved.push({ name, to: filename })
        log('video.baseVideo', 'Set base video on "' + entity.name + '"', {
          id,
          name: entity.name
        })
        continue
      }

      const dest =
        kind === 'stream'
          ? dir
          : path.join(dir, VIDEO_EXTS.has(ext) ? 'footage' : 'assets')
      await fs.mkdir(dest, { recursive: true })
      const filename = await uniqueFile(dest, name)
      await moveFile(src, path.join(dest, filename))
      result.moved.push({ name, to: path.relative(dir, path.join(dest, filename)) })
    } catch (err) {
      result.failed.push({ name, reason: (err as Error).message })
    }
  }

  if (target === 'auto' && result.moved.length) {
    log(
      kind === 'video' ? 'video.files' : 'stream.files',
      describeMoves(result.moved),
      { id, name: entity.name }
    )
  }
  return result
}

export async function openPremiere(root: string, id: string): Promise<string | null> {
  const video = findVideo(id)
  await repairVideo(root, video)
  const err = await launch(prprojPath(root, video))
  if (!err) {
    log('video.premiere', 'Opened Premiere project for "' + video.name + '"', {
      id,
      name: video.name
    })
  }
  return err
}

export async function reveal(
  root: string,
  kind: 'video' | 'stream',
  id: string
): Promise<void> {
  const entity = kind === 'video' ? findVideo(id) : findStream(id)
  const dir =
    kind === 'video'
      ? videoPath(root, entity as Video)
      : streamPath(root, entity as Stream)
  assertInside(root, dir)
  await shell.openPath(dir)
}

// A project folder can be edited or gutted from Explorer at any time; every entry point
// repairs before it acts rather than trusting the database.
export async function repairVideo(root: string, video: Video): Promise<boolean> {
  const dir = videoPath(root, video)
  let changed = false

  if (!(await exists(dir))) {
    if (!video.missing) {
      video.missing = true
      db.saveVideo(video)
    }
    return false
  }

  if (video.missing) {
    video.missing = false
    changed = true
  }

  for (const sub of ['footage', 'assets']) {
    const target = path.join(dir, sub)
    if (!(await exists(target))) {
      await fs.mkdir(target, { recursive: true })
      changed = true
    }
  }

  const thumb = await findByStem(dir, THUMB_STEM)
  if (thumb !== video.thumbnail) {
    video.thumbnail = thumb
    changed = true
  }

  const base = await findByStem(dir, BASE_STEM)
  if (base !== video.baseVideo) {
    video.baseVideo = base
    changed = true
  }

  if (!(await exists(prprojPath(root, video)))) {
    if (await createProjectFile(root, dir, video.folder)) changed = true
  }

  if (changed) db.saveVideo(video)
  return changed
}

export async function repairStream(root: string, stream: Stream): Promise<boolean> {
  const dir = streamPath(root, stream)
  let changed = false

  if (!(await exists(dir))) {
    if (!stream.missing) {
      stream.missing = true
      db.saveStream(stream)
    }
    return false
  }

  if (stream.missing) {
    stream.missing = false
    changed = true
  }

  const thumb = await findByStem(dir, THUMB_STEM)
  if (thumb !== stream.thumbnail) {
    stream.thumbnail = thumb
    changed = true
  }

  if (changed) db.saveStream(stream)
  return changed
}

export async function repairAll(root: string): Promise<number> {
  await ensureRoot(root)
  let repaired = 0
  for (const v of [...db.state().videos]) {
    if (await repairVideo(root, v)) repaired++
  }
  for (const s of [...db.state().streams]) {
    if (await repairStream(root, s)) repaired++
  }
  if (repaired > 0) {
    log('video.repair', 'Repaired ' + repaired + ' project folder(s)')
  }
  return repaired
}

export async function removeVideo(
  root: string,
  id: string,
  deleteFolder: boolean
): Promise<void> {
  const video = findVideo(id)
  const dir = videoPath(root, video)

  if (deleteFolder && (await exists(dir))) {
    assertInside(root, dir)
    await shell.trashItem(dir)
  }

  db.deleteVideo(id)
  log(
    'video.remove',
    deleteFolder
      ? 'Deleted "' + video.name + '" and moved its folder to the Recycle Bin'
      : 'Removed "' + video.name + '" — folder left on disk'
  )
}

export async function removeStream(
  root: string,
  id: string,
  deleteFolder: boolean
): Promise<void> {
  const stream = findStream(id)
  const dir = streamPath(root, stream)

  if (deleteFolder && (await exists(dir))) {
    assertInside(root, dir)
    await shell.trashItem(dir)
  }

  db.deleteStream(id)
  log(
    'stream.remove',
    deleteFolder
      ? 'Deleted "' + stream.name + '" and moved its folder to the Recycle Bin'
      : 'Removed "' + stream.name + '" — folder left on disk'
  )
}

async function orphanFolders(dir: string, known: Set<string>): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true })
  return entries
    .filter((e) => e.isDirectory() && !known.has(e.name))
    .map((e) => e.name)
}

export async function rescan(root: string): Promise<{ added: number; missing: number }> {
  await ensureRoot(root)
  let added = 0
  let missing = 0

  const state = db.state()
  const newVideos = await orphanFolders(
    videosDir(root),
    new Set(state.videos.map((v) => v.folder))
  )
  const newStreams = await orphanFolders(
    streamsDir(root),
    new Set(state.streams.map((s) => s.folder))
  )

  for (const folder of newVideos) {
    const dir = path.join(videosDir(root), folder)
    const video: Video = {
      id: randomUUID(),
      name: folder,
      folder,
      createdAt: (await fs.stat(dir)).birthtime.toISOString(),
      steps: emptySteps(),
      thumbnail: await findByStem(dir, THUMB_STEM),
      baseVideo: await findByStem(dir, BASE_STEM)
    }
    db.saveVideo(video)
    added++
  }

  for (const folder of newStreams) {
    const dir = path.join(streamsDir(root), folder)
    const stream: Stream = {
      id: randomUUID(),
      name: folder,
      folder,
      createdAt: (await fs.stat(dir)).birthtime.toISOString(),
      scheduledAt: null,
      streamedAt: null,
      thumbnail: await findByStem(dir, THUMB_STEM)
    }
    db.saveStream(stream)
    added++
  }

  for (const v of db.state().videos) {
    const gone = !(await exists(videoPath(root, v)))
    if (gone) missing++
    v.missing = gone
    db.saveVideo(v)
  }
  for (const s of db.state().streams) {
    const gone = !(await exists(streamPath(root, s)))
    if (gone) missing++
    s.missing = gone
    db.saveStream(s)
  }

  await repairAll(root)
  log('system.rescan', 'Rescan added ' + added + ', flagged ' + missing + ' missing')
  return { added, missing }
}
