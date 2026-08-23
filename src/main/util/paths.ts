import { execFile } from 'node:child_process'
import path from 'node:path'
import fs from 'node:fs/promises'

const INVALID = /[<>:"/\|?*\u0000-\u001f]/g
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i

export const VIDEO_EXTS = new Set([
  '.mp4', '.mkv', '.mov', '.avi', '.webm', '.m4v', '.mts', '.m2ts', '.wmv', '.flv'
])

export const IMAGE_EXTS = new Set([
  '.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.avif'
])

export function sanitizeFolderName(input: string): string {
  let name = input.replace(INVALID, '').replace(/\s+/g, ' ').trim()
  name = name.replace(/[. ]+$/, '')
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

export async function moveFile(src: string, dest: string): Promise<void> {
  try {
    await fs.rename(src, dest)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EXDEV') throw err
    await fs.copyFile(src, dest)
    try {
      await fs.unlink(src)
    } catch (unlinkErr) {
      await fs.unlink(dest).catch(() => {})
      throw unlinkErr
    }
  }
}
