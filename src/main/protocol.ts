import { net, protocol } from 'electron'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { isInside } from './util/paths'

export const SCHEME = 'raeydzone'

export function registerScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true }
    }
  ])
}

export function serveFrom(getRoot: () => string | null): void {
  protocol.handle(SCHEME, async (request) => {
    const root = getRoot()
    if (!root) return new Response('No root', { status: 404 })

    const url = new URL(request.url)
    const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '')
    const target = path.join(root, rel)
    if (!isInside(root, target)) return new Response('Forbidden', { status: 403 })

    try {
      return await net.fetch(pathToFileURL(target).toString())
    } catch {
      return new Response('Not found', { status: 404 })
    }
  })
}
