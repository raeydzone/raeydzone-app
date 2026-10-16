import { safeStorage } from 'electron'
import { getSettings, saveSettings } from '../services/settings'
import type { ImageRequest, ImageResult, OpenRouterStatus } from '@shared/studio'

const API = 'https://openrouter.ai/api/v1'

function readKey(): string | null {
  const stored = getSettings().openrouterKey
  if (!stored) return null
  if (!stored.startsWith('enc:')) return stored
  try {
    return safeStorage.decryptString(Buffer.from(stored.slice(4), 'base64'))
  } catch {
    return null
  }
}

export async function setKey(raw: string | null): Promise<OpenRouterStatus> {
  const key = raw?.trim() || null
  let stored: string | null = key
  if (key && safeStorage.isEncryptionAvailable()) {
    stored = 'enc:' + safeStorage.encryptString(key).toString('base64')
  }
  await saveSettings({ openrouterKey: stored })
  return status()
}

function headers(key: string): Record<string, string> {
  return {
    Authorization: 'Bearer ' + key,
    'Content-Type': 'application/json',
    'HTTP-Referer': 'https://github.com/raeydzone/raeydzone-app',
    'X-Title': 'RaeydZone'
  }
}

export async function status(): Promise<OpenRouterStatus> {
  const key = readKey()
  const empty = { set: !!key, ok: false, label: null, remaining: null }
  if (!key) return { ...empty, error: null }
  try {
    const res = await fetch(API + '/key', { headers: headers(key), signal: AbortSignal.timeout(15_000) })
    if (!res.ok) return { ...empty, error: res.status === 401 ? 'Key rejected' : 'HTTP ' + res.status }
    const { data } = (await res.json()) as {
      data: { label?: string; limit_remaining?: number | null }
    }
    return { set: true, ok: true, label: data.label ?? null, remaining: data.limit_remaining ?? null, error: null }
  } catch (err) {
    return { ...empty, error: (err as Error).message }
  }
}

function sniffMime(data: Uint8Array): string {
  if (data[0] === 0x89 && data[1] === 0x50) return 'image/png'
  if (data[0] === 0xff && data[1] === 0xd8) return 'image/jpeg'
  if (data[0] === 0x52 && data[1] === 0x49) return 'image/webp'
  return 'image/png'
}

async function decodeImageUrl(url: string): Promise<Uint8Array> {
  if (url.startsWith('data:')) {
    return new Uint8Array(Buffer.from(url.slice(url.indexOf(',') + 1), 'base64'))
  }
  const res = await fetch(url, { signal: AbortSignal.timeout(60_000) })
  if (!res.ok) throw new Error('Could not download the generated image')
  return new Uint8Array(await res.arrayBuffer())
}

interface Completion {
  error?: { message?: string }
  usage?: { cost?: number }
  choices?: {
    message?: { content?: string | null; images?: { image_url?: { url?: string } }[] }
  }[]
}

export async function generate(req: ImageRequest): Promise<ImageResult> {
  const key = readKey()
  if (!key) throw new Error('Connect OpenRouter in Settings to use image generation.')

  const content: unknown[] = [{ type: 'text', text: req.prompt }]
  for (const image of req.images) {
    const data = Buffer.from(image).toString('base64')
    content.push({ type: 'image_url', image_url: { url: `data:${sniffMime(image)};base64,${data}` } })
  }

  const body: Record<string, unknown> = {
    model: getSettings().imageModel,
    modalities: ['image', 'text'],
    messages: [{ role: 'user', content }],
    usage: { include: true }
  }
  if (req.aspect) body.image_config = { aspect_ratio: req.aspect }

  const res = await fetch(API + '/chat/completions', {
    method: 'POST',
    headers: headers(key),
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(180_000)
  })
  const json = (await res.json().catch(() => ({}))) as Completion
  if (!res.ok || json.error) {
    throw new Error('OpenRouter: ' + (json.error?.message ?? 'HTTP ' + res.status))
  }
  const message = json.choices?.[0]?.message
  const url = message?.images?.[0]?.image_url?.url
  if (!url) {
    const said = typeof message?.content === 'string' ? message.content.trim() : ''
    throw new Error('The image model returned no image' + (said ? ' — ' + said.slice(0, 300) : ''))
  }
  const data = await decodeImageUrl(url)
  return { data, mime: sniffMime(data), cost: json.usage?.cost ?? null }
}
