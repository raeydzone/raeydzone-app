import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { randomBytes } from 'node:crypto'
import { STUDIO_TOOLS } from '@shared/studioTools'
import type { ToolReply } from '@shared/studio'

type Executor = (variantId: string, name: string, args: Record<string, unknown>) => Promise<ToolReply>

interface RpcMessage {
  jsonrpc: '2.0'
  id?: string | number
  method?: string
  params?: Record<string, unknown>
}

const token = randomBytes(24).toString('hex')
const MAX_BODY = 4 * 1024 * 1024
let server: http.Server | null = null
let port = 0
let execute: Executor = async () => ({ text: 'Studio not ready', isError: true })

export function setExecutor(fn: Executor): void {
  execute = fn
}

async function respond(variantId: string, msg: RpcMessage): Promise<unknown> {
  switch (msg.method) {
    case 'initialize':
      return {
        protocolVersion: msg.params?.protocolVersion ?? '2025-06-18',
        capabilities: { tools: {} },
        serverInfo: { name: 'raeydzone-canvas', version: '1.0.0' }
      }
    case 'ping':
      return {}
    case 'tools/list':
      return { tools: STUDIO_TOOLS }
    case 'tools/call': {
      const name = String(msg.params?.name ?? '')
      const args = (msg.params?.arguments ?? {}) as Record<string, unknown>
      let reply: ToolReply
      try {
        reply = await execute(variantId, name, args)
      } catch (err) {
        reply = { text: (err as Error).message, isError: true }
      }
      const content: unknown[] = []
      if (reply.image) content.push({ type: 'image', data: reply.image.data, mimeType: reply.image.mime })
      content.push({ type: 'text', text: reply.text })
      return { content, isError: !!reply.isError }
    }
    default:
      throw Object.assign(new Error('Method not found'), { code: -32601 })
  }
}

function handle(req: http.IncomingMessage, res: http.ServerResponse): void {
  const match = /^\/mcp\/([\w-]+)$/.exec(req.url ?? '')
  if (!match || req.headers.authorization !== 'Bearer ' + token) {
    res.writeHead(401).end()
    return
  }
  if (req.method !== 'POST') {
    res.writeHead(req.method === 'DELETE' ? 200 : 405).end()
    return
  }
  let body = ''
  req.setEncoding('utf-8')
  req.on('data', (chunk: string) => {
    body += chunk
    if (body.length > MAX_BODY) req.destroy()
  })
  req.on('end', async () => {
    let msg: RpcMessage
    try {
      msg = JSON.parse(body)
    } catch {
      res.writeHead(400).end()
      return
    }
    if (msg.id === undefined) {
      res.writeHead(202).end()
      return
    }
    let payload: unknown
    try {
      payload = { jsonrpc: '2.0', id: msg.id, result: await respond(match[1], msg) }
    } catch (err) {
      const code = (err as { code?: number }).code ?? -32603
      payload = { jsonrpc: '2.0', id: msg.id, error: { code, message: (err as Error).message } }
    }
    if (res.destroyed) return
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(payload))
  })
}

export async function endpoint(variantId: string): Promise<{ url: string; token: string }> {
  if (!server) {
    server = http.createServer(handle)
    server.requestTimeout = 0
    server.headersTimeout = 0
    await new Promise<void>((resolve, reject) => {
      server!.once('error', reject)
      server!.listen(0, '127.0.0.1', () => resolve())
    })
    port = (server.address() as AddressInfo).port
  }
  return { url: `http://127.0.0.1:${port}/mcp/${variantId}`, token }
}

export function close(): void {
  server?.close()
  server = null
}
