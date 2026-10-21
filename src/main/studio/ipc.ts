import { BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { randomUUID } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import { basename } from 'node:path'
import * as lib from '../services/library'
import { getSettings, saveSettings } from '../services/settings'
import * as brand from './brand'
import * as claude from './claude'
import * as files from './files'
import * as mcp from './mcp'
import * as openrouter from './openrouter'
import * as reports from './reports'
import * as spend from './spend'
import type { BrandKit, ImageRequest, ReportInput, SendRequest, ToolReply } from '@shared/studio'

const TOOL_TIMEOUT_MS = 5 * 60 * 1000
const pending = new Map<string, (reply: ToolReply) => void>()

function requireRoot(): string {
  const root = getSettings().rootPath
  if (!root) throw new Error('No root folder configured.')
  return root
}

// Studio traffic is chatty — saves, assets, tool results — so these handlers skip the
// full state broadcast the rest of the app relies on.
function quiet(channel: string, fn: (...args: never[]) => unknown): void {
  ipcMain.handle(channel, async (_event, ...args) => {
    try {
      return { ok: true, value: await (fn as (...a: unknown[]) => unknown)(...args) }
    } catch (err) {
      return { ok: false, error: (err as Error).message }
    }
  })
}

export function registerStudio(
  getWin: () => BrowserWindow | null,
  broadcast: () => Promise<void>
): void {
  const send = (channel: string, ...args: unknown[]): boolean => {
    const win = getWin()
    if (!win || win.isDestroyed()) return false
    win.webContents.send(channel, ...args)
    return true
  }

  claude.onEvent((variantId, event) => {
    send('studio:event', variantId, event)
    // A finished turn lands in the ledger as time worked, so the spend panel refreshes.
    if (event.type === 'status' && event.ms !== undefined) send('studio:spendChanged')
  })

  mcp.setExecutor(
    (variantId, name, args) =>
      new Promise((resolve) => {
        const callId = randomUUID()
        const timer = setTimeout(() => {
          pending.delete(callId)
          resolve({ text: 'The studio did not answer in time.', isError: true })
        }, TOOL_TIMEOUT_MS)
        pending.set(callId, (reply) => {
          clearTimeout(timer)
          pending.delete(callId)
          resolve(reply)
        })
        if (!send('studio:tool', { callId, variantId, name, args })) {
          pending.get(callId)?.({ text: 'The RaeydZone window is closed.', isError: true })
        }
      })
  )

  quiet('studio:toolDone', (callId: string, reply: ToolReply) => pending.get(callId)?.(reply))

  quiet('studio:load', (projectId: string) => files.load(requireRoot(), projectId))
  quiet('studio:save', (projectId: string, json: string) => files.save(requireRoot(), projectId, json))
  quiet('studio:putAsset', (projectId: string, file: string, data: Uint8Array) =>
    files.putAsset(requireRoot(), projectId, file, data)
  )
  quiet('studio:readAsset', (projectId: string, file: string) =>
    files.readAsset(requireRoot(), projectId, file)
  )
  quiet('studio:import', (projectId: string, paths: string[]) =>
    files.importFiles(requireRoot(), projectId, paths)
  )
  quiet('studio:projects', () => lib.studioProjects(requireRoot()))
  quiet('studio:copyAssets', (from: string, to: string, names: string[]) =>
    files.copyAssets(requireRoot(), from, to, names)
  )
  quiet('studio:adoptThumbnail', (projectId: string, known: string | null, copy: boolean) =>
    files.adoptThumbnail(requireRoot(), projectId, known, copy)
  )
  quiet('studio:paste', (projectId: string) => files.pasteImage(requireRoot(), projectId))
  quiet('studio:copyImage', (png: Uint8Array) => files.copyImage(png))
  quiet('studio:prune', (projectId: string, keep: string[]) =>
    files.prune(requireRoot(), projectId, keep)
  )
  quiet('studio:pickImages', async () => {
    const win = getWin()
    const options = {
      properties: ['openFile', 'multiSelections'] as ('openFile' | 'multiSelections')[],
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'avif'] }]
    }
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    return result.canceled ? [] : result.filePaths
  })

  quiet('studio:export', async (projectId: string, items: { name: string; data: Uint8Array }[]) => {
    const written = await files.writeExports(requireRoot(), projectId, items)
    if (written[0]) shell.showItemInFolder(written[0])
    return written.length
  })

  const kitChanged = (kit: BrandKit): BrandKit => {
    for (const w of BrowserWindow.getAllWindows()) w.webContents.send('brand:changed', kit)
    return kit
  }
  quiet('brand:get', () => brand.loadKit(requireRoot()))
  quiet('brand:save', async (kit: BrandKit) => kitChanged(await brand.saveKit(requireRoot(), kit)))
  quiet('brand:pickLogo', async () => {
    const win = getWin()
    const options = {
      properties: ['openFile'] as 'openFile'[],
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'avif'] }]
    }
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    if (result.canceled || !result.filePaths[0]) return null
    return brand.addLogo(requireRoot(), result.filePaths[0])
  })
  quiet('brand:readLogo', (file: string) => brand.readLogo(requireRoot(), file))
  quiet('brand:removeLogo', (file: string) => brand.removeLogo(requireRoot(), file))
  quiet('brand:logoToProject', (projectId: string, file: string) => brand.logoToProject(requireRoot(), projectId, file))

  // Reading a file the creator just picked is safe from main; nothing here writes.
  quiet('studio:pickLut', async () => {
    const win = getWin()
    const options = { properties: ['openFile'] as 'openFile'[], filters: [{ name: 'Colour LUT', extensions: ['cube'] }] }
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    const file = result.canceled ? null : result.filePaths[0]
    if (!file) return null
    if ((await stat(file)).size > 20 * 1024 * 1024) throw new Error('That LUT is larger than 20 MB.')
    return { name: basename(file).replace(/\.cube$/i, ''), text: await readFile(file, 'utf-8') }
  })

  ipcMain.handle('studio:apply', async (_e, projectId: string, data: Uint8Array, ext: 'png' | 'jpg') => {
    try {
      const file = await lib.writeThumbnail(requireRoot(), projectId, data, ext === 'jpg' ? 'jpg' : 'png')
      await broadcast()
      return { ok: true, value: { file, hash: files.digest(data) } }
    } catch (err) {
      return { ok: false, error: (err as Error).message }
    }
  })

  quiet('studio:send', async (req: SendRequest) => {
    await claude.send(req, await mcp.endpoint(req.variantId))
  })
  quiet('studio:stop', (variantId: string) => claude.stop(variantId))
  quiet('studio:image', async (req: ImageRequest) => {
    const started = Date.now()
    const res = await openrouter.generate(req)
    await spend.record({
      model: res.model, task: req.task, project: req.projectId, cost: res.cost,
      ms: Date.now() - started
    })
    send('studio:spendChanged')
    return res
  })
  quiet('studio:spend', (projectId: string | null) => spend.summary(projectId))

  const reported = (list: Awaited<ReturnType<typeof reports.list>>): typeof list => {
    send('studio:reportsChanged', list)
    return list
  }
  quiet('studio:reports', () => reports.list())
  quiet('studio:report', async (input: ReportInput) => {
    const { reports: list, repeat } = await reports.add(input)
    reported(list)
    return repeat
  })
  quiet('studio:reportDone', async (id: string, done: boolean) => reported(await reports.setDone(id, done)))
  quiet('studio:reportRemove', async (id: string) => reported(await reports.remove(id)))

  quiet('ai:claudeStatus', () => claude.status())
  quiet('ai:claudeConnect', () => claude.connect())
  quiet('ai:claudeLocate', async () => {
    const win = getWin()
    const options = {
      title: 'Locate claude.exe',
      properties: ['openFile'] as 'openFile'[],
      filters: [{ name: 'Claude Code', extensions: ['exe'] }]
    }
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    if (result.canceled || !result.filePaths[0]) return claude.status()
    await saveSettings({ claudePath: result.filePaths[0] })
    return claude.status()
  })
  quiet('ai:openrouterStatus', () => openrouter.status())
  quiet('ai:openrouterKey', (key: string | null) => openrouter.setKey(key))
}

export function shutdownStudio(): void {
  claude.stopAll()
  mcp.close()
}
