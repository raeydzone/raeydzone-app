import { safeStorage } from 'electron'
import { getSettings, saveSettings } from '../services/settings'
import { imageModel } from '@shared/studio'
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

async function credits(key: string): Promise<number | null> {
  try {
    const res = await fetch(API + '/credits', { headers: headers(key), signal: AbortSignal.timeout(15_000) })
    if (!res.ok) return null
    const { data } = (await res.json()) as { data?: { total_credits?: number; total_usage?: number } }
    return data?.total_credits != null && data.total_usage != null ? data.total_credits - data.total_usage : null
  } catch {
    return null
  }
}

export async function status(): Promise<OpenRouterStatus> {
  const key = readKey()
  const empty = { set: !!key, ok: false, label: null, remaining: null, usage: null }
  if (!key) return { ...empty, error: null }
  try {
    const [res, balance] = await Promise.all([
      fetch(API + '/key', { headers: headers(key), signal: AbortSignal.timeout(15_000) }),
      credits(key)
    ])
    if (!res.ok) return { ...empty, error: res.status === 401 ? 'Key rejected' : 'HTTP ' + res.status }
    const { data } = (await res.json()) as {
      data: { label?: string; limit_remaining?: number | null; usage?: number | null }
    }
    return {
      set: true,
      ok: true,
      label: data.label ?? null,
      remaining: data.limit_remaining ?? balance,
      usage: data.usage ?? null,
      error: null
    }
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

interface ImagesResponse {
  error?: { message?: string }
  data?: { b64_json?: string; media_type?: string }[]
  usage?: { cost?: number }
}

export async function generate(req: ImageRequest): Promise<ImageResult> {
  const key = readKey()
  if (!key) throw new Error('Connect OpenRouter in Settings to use image generation.')
  const model = imageModel(req.model)

  const body: Record<string, unknown> = {
    model: model.id,
    prompt: req.prompt,
    n: 1,
    output_format: 'png'
  }
  if (req.aspect && model.aspects.includes(req.aspect)) body.aspect_ratio = req.aspect
  if (req.images.length) {
    body.input_references = req.images.slice(0, model.maxRefs).map((image) => ({
      type: 'image_url',
      image_url: { url: `data:${sniffMime(image)};base64,${Buffer.from(image).toString('base64')}` }
    }))
  }
  if (model.quality) body.quality = req.detail === 'final' ? 'high' : 'medium'
  if (model.resolution) body.resolution = req.detail === 'final' ? '2K' : '1K'
  if (req.transparent && model.transparent) body.background = 'transparent'

  const res = await fetch(API + '/images', {
    method: 'POST',
    headers: headers(key),
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(240_000)
  })
  const json = (await res.json().catch(() => ({}))) as ImagesResponse
  if (!res.ok || json.error) {
    throw new Error(`${model.label}: ` + (json.error?.message ?? 'HTTP ' + res.status))
  }
  const b64 = json.data?.[0]?.b64_json
  if (!b64) throw new Error(`${model.label} returned no image`)
  const data = new Uint8Array(Buffer.from(b64, 'base64'))
  return { data, mime: sniffMime(data), cost: json.usage?.cost ?? null }
}
