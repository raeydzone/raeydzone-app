import { execFile } from 'node:child_process'
import path from 'node:path'
import fs from 'node:fs/promises'

const INVALID = /[<>:"/\|?*\u0000-\u001f]/g
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i

export const VIDEO_EXTS = new Set([
  '.mp4', '.mkv', '.mov', '.avi', '.webm', '.m4v', '.mts', '.m2ts', '.wmv', '.flv'
])

export const AUDIO_EXTS = new Set(['.wav', '.mp3', '.flac', '.aac', '.ogg', '.m4a'])

export const IMAGE_EXTS = new Set([
  '.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.avif'
])

// Folder names carry no spaces: paths land in scripts, Premiere and the shell, and
// quoting bugs there are silent. The display name keeps its spaces.
export function sanitizeFolderName(input: string): string {
  let name = input.replace(INVALID, '').trim()
  name = name.replace(/\s+/g, '_').replace(/_{2,}/g, '_')
  name = name.replace(/^[._]+/, '').replace(/[._]+$/, '')
  if (RESERVED.test(name)) name = `_${name}`
  return name.slice(0, 120)
}

export async function uniqueFolder(parent: string, base: string): Promise<string> {
  let candidate = base
  let n = 2
  while (await exists(path.join(parent, candidate))) {
    candidate = `${base} (${n++})`
  }
  return candidate
}

export async function uniqueFile(dir: string, filename: string): Promise<string> {
  const ext = path.extname(filename)
  const stem = path.basename(filename, ext)
  let candidate = filename
  let n = 2
  while (await exists(path.join(dir, candidate))) {
    candidate = `${stem} (${n++})${ext}`
  }
  return candidate
}

export async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p)
    return true
  } catch {
    return false
  }
}

export function isInside(root: string, target: string): boolean {
  const rel = path.relative(path.resolve(root), path.resolve(target))
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel)
}

export function assertInside(root: string, target: string): void {
  if (!isInside(root, target)) throw new Error(`Path escapes root: ${target}`)
}

export function isOneDrivePath(p: string): boolean {
  return p.split(/[\/]/).some((seg) => /^onedrive( - .+)?$/i.test(seg))
}

export async function freeBytes(p: string): Promise<number | null> {
  try {
    const s = await fs.statfs(p)
    return Number(s.bsize) * Number(s.bavail)
  } catch {
    return null
  }
}

export function isRemovable(p: string): Promise<boolean> {
  const drive = path.parse(path.resolve(p)).root.replace(/\$/, '')
  if (!/^[a-z]:$/i.test(drive)) return Promise.resolve(false)
  const cmd = `(Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='${drive}'").DriveType`
  return new Promise((resolve) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', cmd],
      { timeout: 5000, windowsHide: true },
      (err, stdout) => resolve(!err && stdout.trim() === '2')
    )
  })
}

const LOCKED = new Set(['EBUSY', 'EPERM', 'EACCES'])
const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms))

export type MoveOutcome = 'moved' | 'copied'

// A file freshly written by a browser or being scanned by antivirus reports EBUSY for a
// moment. Retry, then fall back to copying, and keep the copy even if the original
// cannot be unlinked — landing the file matters more than tidying the source.
export async function moveFile(src: string, dest: string): Promise<MoveOutcome> {
  let lastErr: unknown = null

  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      await fs.rename(src, dest)
      return 'moved'
    } catch (err) {
      lastErr = err
      const code = (err as NodeJS.ErrnoException).code ?? ''
      if (code === 'EXDEV') break
      if (!LOCKED.has(code)) throw err
      await sleep(120 * (attempt + 1))
    }
  }

  await fs.copyFile(src, dest).catch((copyErr) => {
    throw lastErr ?? copyErr
  })

  try {
    await fs.unlink(src)
    return 'moved'
  } catch {
    return 'copied'
  }
}
