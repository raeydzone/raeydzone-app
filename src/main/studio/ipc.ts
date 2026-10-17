import { BrowserWindow, dialog, ipcMain } from 'electron'
import { randomUUID } from 'node:crypto'
import * as lib from '../services/library'
import { getSettings, saveSettings } from '../services/settings'
import * as claude from './claude'
import * as files from './files'
import * as mcp from './mcp'
import * as openrouter from './openrouter'
import type { ImageRequest, SendRequest, ToolReply } from '@shared/studio'

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

  quiet('studio:load', (videoId: string) => files.load(requireRoot(), videoId))
  quiet('studio:save', (videoId: string, json: string) => files.save(requireRoot(), videoId, json))
  quiet('studio:putAsset', (videoId: string, file: string, data: Uint8Array) =>
    files.putAsset(requireRoot(), videoId, file, data)
  )
  quiet('studio:readAsset', (videoId: string, file: string) =>
    files.readAsset(requireRoot(), videoId, file)
  )
  quiet('studio:import', (videoId: string, paths: string[]) =>
    files.importFiles(requireRoot(), videoId, paths)
  )
  quiet('studio:paste', (videoId: string) => files.pasteImage(requireRoot(), videoId))
  quiet('studio:prune', (videoId: string, keep: string[]) =>
    files.prune(requireRoot(), videoId, keep)
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

  ipcMain.handle('studio:apply', async (_e, videoId: string, data: Uint8Array, ext: 'png' | 'jpg') => {
    try {
      const value = await lib.writeThumbnail(requireRoot(), videoId, data, ext === 'jpg' ? 'jpg' : 'png')
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
  quiet('studio:image', (req: ImageRequest) => openrouter.generate(req))

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
