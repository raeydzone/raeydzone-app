import { app } from 'electron'
import path from 'node:path'
import fs from 'node:fs/promises'

export interface JsonStore<T> {
  read: () => Promise<T>
  update: (fn: (value: T) => T) => Promise<T>
}

// Writes are queued and land through a temp file, so two quick updates cannot interleave
// and a crash mid-write never leaves half a ledger behind.
export function jsonStore<T>(name: string, fallback: () => T): JsonStore<T> {
  const file = (): string => path.join(app.getPath('userData'), name)
  let cache: T | null = null
  let queue: Promise<unknown> = Promise.resolve()

  const read = async (): Promise<T> => {
    if (cache) return cache
    try {
      cache = { ...fallback(), ...JSON.parse(await fs.readFile(file(), 'utf-8')) } as T
    } catch {
      cache = fallback()
    }
    return cache
  }

  const update = (fn: (value: T) => T): Promise<T> => {
    const job = queue.then(async () => {
      const next = fn(await read())
      await fs.mkdir(path.dirname(file()), { recursive: true })
      await fs.writeFile(file() + '.tmp', JSON.stringify(next, null, 2), 'utf-8')
      await fs.rename(file() + '.tmp', file())
      cache = next
      return next
    })
    queue = job.catch(() => {})
    return job
  }

  return { read, update }
}
