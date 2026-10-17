import { BrowserWindow, dialog, ipcMain } from 'electron'
import { randomUUID } from 'node:crypto'
import * as lib from '../services/library'
import { getSettings, saveSettings } from '../services/settings'
import * as claude from './claude'
import * as files from './files'
import * as mcp from './mcp'
import * as openrouter from './openrouter'
import * as reports from './reports'
import * as spend from './spend'
import type { ImageRequest, ReportInput, SendRequest, ToolReply } from '@shared/studio'

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

  claude.onEvent((variantId, event) => send('studio:event', variantId, event))

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
  quiet('studio:paste', (projectId: string) => files.pasteImage(requireRoot(), projectId))
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

  ipcMain.handle('studio:apply', async (_e, projectId: string, data: Uint8Array, ext: 'png' | 'jpg') => {
    try {
      const value = await lib.writeThumbnail(requireRoot(), projectId, data, ext === 'jpg' ? 'jpg' : 'png')
      await broadcast()
      return { ok: true, value }
    } catch (err) {
      return { ok: false, error: (err as Error).message }
    }
  })

  quiet('studio:send', async (req: SendRequest) => {
    await claude.send(req, await mcp.endpoint(req.variantId))
  })
  quiet('studio:stop', (variantId: string) => claude.stop(variantId))
  quiet('studio:image', async (req: ImageRequest) => {
    const res = await openrouter.generate(req)
    await spend.record({ model: req.model, task: req.task, project: req.projectId, cost: res.cost })
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
