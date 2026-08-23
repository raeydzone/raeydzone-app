import { shell } from 'electron'
import path from 'node:path'
import fs from 'node:fs/promises'
import * as db from './db'
import { exists } from '../util/paths'

export function hasTemplate(root: string): Promise<boolean> {
  return exists(db.templatePath(root))
}

export async function createProjectFile(
  root: string,
  folder: string,
  name: string
): Promise<string | null> {
  const template = db.templatePath(root)
  if (!(await exists(template))) return null
  const dest = path.join(folder, `${name}.prproj`)
  await fs.copyFile(template, dest)
  return dest
}

export async function launch(projectPath: string): Promise<string | null> {
  if (!(await exists(projectPath))) return 'Project file is missing.'
  const err = await shell.openPath(projectPath)
  return err || null
}
