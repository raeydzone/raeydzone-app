import { nativeImage } from 'electron'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import fs from 'node:fs/promises'
import { EMPTY_KIT } from '@shared/studio'
import type { BrandKit, BrandLogo } from '@shared/studio'
import { IMAGE_EXTS, assertInside } from '../util/paths'
import { studioDir } from '../services/library'

const LOGO_NAME = /^[\w-]+\.(png|jpe?g|webp|gif|bmp|avif)$/i

// The kit lives in the synced root next to the app's own data, so every project and every
// machine syncing that root shares one brand.
const dir = (root: string): string => path.join(root, '.raeydzone', 'brand')

function logoPath(root: string, file: string): string {
  if (!LOGO_NAME.test(file)) throw new Error('Invalid logo name: ' + file)
  const target = path.join(dir(root), 'logos', file)
  assertInside(root, target)
  return target
}

export async function loadKit(root: string): Promise<BrandKit> {
  try {
    const kit = JSON.parse(await fs.readFile(path.join(dir(root), 'brand.json'), 'utf-8')) as Partial<BrandKit>
    return { ...EMPTY_KIT, ...kit }
  } catch {
    return { ...EMPTY_KIT }
  }
}

export async function saveKit(root: string, kit: BrandKit): Promise<BrandKit> {
  const clean: BrandKit = {
    colors: Array.isArray(kit.colors) ? kit.colors : [],
    fonts: Array.isArray(kit.fonts) ? kit.fonts.map(String) : [],
    styles: Array.isArray(kit.styles) ? kit.styles : [],
    logos: Array.isArray(kit.logos) ? kit.logos : []
  }
  const target = path.join(dir(root), 'brand.json')
  assertInside(root, target)
  await fs.mkdir(dir(root), { recursive: true })
  await fs.writeFile(target + '.tmp', JSON.stringify(clean, null, 2), 'utf-8')
  await fs.rename(target + '.tmp', target)
  return clean
}

// A logo is copied in, never linked, so the kit survives the original being moved.
export async function addLogo(root: string, source: string): Promise<BrandLogo> {
  const ext = path.extname(source).toLowerCase()
  if (!IMAGE_EXTS.has(ext)) throw new Error('A logo has to be an image file.')
  const id = randomUUID().slice(0, 8)
  const file = id + ext
  const target = logoPath(root, file)
  await fs.mkdir(path.dirname(target), { recursive: true })
  await fs.copyFile(source, target)
  const size = nativeImage.createFromPath(target).getSize()
  return { id, name: path.basename(source, ext), file, w: size.width, h: size.height }
}

export async function readLogo(root: string, file: string): Promise<Uint8Array> {
  return new Uint8Array(await fs.readFile(logoPath(root, file)))
}

export async function removeLogo(root: string, file: string): Promise<void> {
  await fs.unlink(logoPath(root, file)).catch(() => {})
}

export async function logoToProject(root: string, projectId: string, file: string): Promise<string> {
  const target = path.join(await studioDir(root, projectId), 'assets', randomUUID() + path.extname(file).toLowerCase())
  assertInside(root, target)
  await fs.mkdir(path.dirname(target), { recursive: true })
  await fs.copyFile(logoPath(root, file), target)
  return path.basename(target)
}
