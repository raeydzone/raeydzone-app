import { clipboard, nativeImage } from 'electron'
import { createHash, randomUUID } from 'node:crypto'
import path from 'node:path'
import fs from 'node:fs/promises'
import { studioDir } from '../services/library'
import { IMAGE_EXTS, assertInside } from '../util/paths'
import type { StudioFile } from '@shared/studio'

const ASSET_NAME = /^[\w-]+\.(png|jpe?g|webp|gif|bmp|avif)$/i

async function assetsDir(root: string, projectId: string): Promise<string> {
  const dir = path.join(await studioDir(root, projectId), 'assets')
  await fs.mkdir(dir, { recursive: true })
  return dir
}

function assetPath(dir: string, file: string): string {
  if (!ASSET_NAME.test(file)) throw new Error('Invalid asset name: ' + file)
  return path.join(dir, file)
}

export async function load(root: string, projectId: string): Promise<StudioFile | null> {
  const file = path.join(await studioDir(root, projectId), 'studio.json')
  try {
    return JSON.parse(await fs.readFile(file, 'utf-8')) as StudioFile
  } catch {
    return null
  }
}

export async function save(root: string, projectId: string, json: string): Promise<void> {
  JSON.parse(json)
  const dir = await studioDir(root, projectId)
  await fs.mkdir(dir, { recursive: true })
  const target = path.join(dir, 'studio.json')
  const temp = target + '.tmp'
  await fs.writeFile(temp, json, 'utf-8')
  await fs.rename(temp, target)
}

export async function putAsset(
  root: string,
  projectId: string,
  file: string,
  data: Uint8Array
): Promise<void> {
  const target = assetPath(await assetsDir(root, projectId), file)
  assertInside(root, target)
  await fs.writeFile(target, data)
}

export async function readAsset(root: string, projectId: string, file: string): Promise<Uint8Array> {
  const target = assetPath(await assetsDir(root, projectId), file)
  assertInside(root, target)
  return new Uint8Array(await fs.readFile(target))
}

// Attachments are references to the creator's own files, so they are copied, never moved.
export async function importFiles(
  root: string,
  projectId: string,
  sources: string[]
): Promise<{ file: string; name: string }[]> {
  const dir = await assetsDir(root, projectId)
  const out: { file: string; name: string }[] = []
  for (const src of sources) {
    const ext = path.extname(src).toLowerCase()
    if (!IMAGE_EXTS.has(ext)) continue
    const file = randomUUID() + ext
    await fs.copyFile(src, path.join(dir, file))
    out.push({ file, name: path.basename(src) })
  }
  return out
}

let copiedImage: string | null = null
const fingerprint = (image: Electron.NativeImage): string => createHash('sha1').update(image.toBitmap()).digest('hex')

// Windows offers no private clipboard format through Electron, so a paste recognises our own
// copy by the pixels it put there.
export function copyImage(png: Uint8Array): void {
  clipboard.writeImage(nativeImage.createFromBuffer(Buffer.from(png)))
  copiedImage = fingerprint(clipboard.readImage())
}

export async function pasteImage(
  root: string,
  projectId: string
): Promise<{ file: string; name: string; ours: boolean } | null> {
  const image = clipboard.readImage()
  if (image.isEmpty()) return null
  const file = randomUUID() + '.png'
  await fs.writeFile(path.join(await assetsDir(root, projectId), file), image.toPNG())
  return { file, name: 'Pasted image', ours: fingerprint(image) === copiedImage }
}

export async function prune(root: string, projectId: string, keep: string[]): Promise<number> {
  const dir = await assetsDir(root, projectId)
  const wanted = new Set(keep)
  let removed = 0
  for (const entry of await fs.readdir(dir)) {
    if (wanted.has(entry) || !ASSET_NAME.test(entry)) continue
    await fs.unlink(path.join(dir, entry)).catch(() => {})
    removed++
  }
  return removed
}
