import { app } from 'electron'
import path from 'node:path'
import fs from 'node:fs/promises'
import { exists, isOneDrivePath, isRemovable } from '../util/paths'
import type { RootProposal } from '@shared/types'

export interface Settings {
  rootPath: string | null
  dailyGoalMs: number
}

const DEFAULTS: Settings = { rootPath: null, dailyGoalMs: 60 * 60 * 1000 }

let cache: Settings = { ...DEFAULTS }

function file(): string {
  return path.join(app.getPath('userData'), 'settings.json')
}

export function defaultRoot(): string {
  return path.join(app.getPath('home'), 'Documents', 'RaeydZone')
}

export async function proposeRoot(): Promise<RootProposal> {
  const p = defaultRoot()
  return {
    path: p,
    exists: await exists(p),
    isOneDrive: isOneDrivePath(p),
    isRemovable: await isRemovable(p)
  }
}

export async function loadSettings(): Promise<Settings> {
  try {
    const raw = await fs.readFile(file(), 'utf-8')
    cache = { ...DEFAULTS, ...JSON.parse(raw) }
  } catch {
    cache = { ...DEFAULTS }
  }
  return cache
}

export function getSettings(): Settings {
  return cache
}

export async function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  cache = { ...cache, ...patch }
  await fs.mkdir(path.dirname(file()), { recursive: true })
  await fs.writeFile(file(), JSON.stringify(cache, null, 2), 'utf-8')
  return cache
}

export function validateRoot(p: string): string | null {
  if (!p) return 'No folder selected.'
  if (isOneDrivePath(p)) {
    return 'OneDrive folders are not valid roots — Windows redirects them and large footage would upload to the cloud. Pick a folder outside OneDrive.'
  }
  return null
}
