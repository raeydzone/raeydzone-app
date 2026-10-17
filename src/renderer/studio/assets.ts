import type { AssetInfo } from '@shared/studio'

export type Pixels = HTMLCanvasElement | ImageBitmap

export function canvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = Math.max(1, Math.round(w))
  c.height = Math.max(1, Math.round(h))
  return c
}

export function ctx2d(c: HTMLCanvasElement): CanvasRenderingContext2D {
  return c.getContext('2d', { willReadFrequently: false })!
}

export async function encode(
  c: HTMLCanvasElement,
  type: 'image/png' | 'image/jpeg' = 'image/png',
  quality = 0.92
): Promise<Uint8Array> {
  const blob = await new Promise<Blob | null>((resolve) => c.toBlob(resolve, type, quality))
  if (!blob) throw new Error('Could not encode the image')
  return new Uint8Array(await blob.arrayBuffer())
}

export function toBase64(bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return btoa(s)
}

export async function decode(bytes: Uint8Array): Promise<ImageBitmap> {
  return createImageBitmap(new Blob([bytes as BlobPart]))
}

export function copyOf(source: Pixels, maxSide = Infinity): HTMLCanvasElement {
  const scale = Math.min(1, maxSide / Math.max(source.width, source.height))
  const c = canvas(source.width * scale, source.height * scale)
  const g = ctx2d(c)
  g.imageSmoothingQuality = 'high'
  g.drawImage(source, 0, 0, c.width, c.height)
  return c
}

const assetId = (): string => 'A' + Math.random().toString(36).slice(2, 8)

export class AssetStore {
  private pixels = new Map<string, Pixels>()
  private loading = new Map<string, Promise<Pixels | null>>()
  infos = new Map<string, AssetInfo>()

  constructor(
    private projectId: string,
    private onLoaded: () => void
  ) {}

  register(list: AssetInfo[]): void {
    for (const info of list) this.infos.set(info.id, info)
  }

  info(id: string): AssetInfo {
    const info = this.infos.get(id)
    if (!info) throw new Error(`No asset with id ${id}`)
    return info
  }

  peek(id: string): Pixels | null {
    const hit = this.pixels.get(id)
    if (hit) return hit
    if (this.infos.has(id)) void this.load(id)
    return null
  }

  load(id: string): Promise<Pixels | null> {
    const hit = this.pixels.get(id)
    if (hit) return Promise.resolve(hit)
    const pending = this.loading.get(id)
    if (pending) return pending
    const info = this.info(id)
    const job = window.raeydzone.studio
      .readAsset(this.projectId, info.file)
      .then(decode)
      .then((bitmap) => {
        this.pixels.set(id, bitmap)
        this.onLoaded()
        return bitmap as Pixels
      })
      .catch(() => null)
      .finally(() => this.loading.delete(id))
    this.loading.set(id, job)
    return job
  }

  async get(id: string): Promise<Pixels> {
    const px = await this.load(id)
    if (!px) throw new Error(`Asset ${id} could not be loaded`)
    return px
  }

  private unique(): string {
    let id = assetId()
    while (this.infos.has(id)) id = assetId()
    return id
  }

  async addCanvas(c: HTMLCanvasElement, label: string, source: AssetInfo['source']): Promise<AssetInfo> {
    const id = this.unique()
    const info: AssetInfo = { id, file: id + '.png', w: c.width, h: c.height, label, source }
    await window.raeydzone.studio.putAsset(this.projectId, info.file, await encode(c))
    this.pixels.set(id, c)
    this.infos.set(id, info)
    return info
  }

  async addFile(file: string, label: string, source: AssetInfo['source']): Promise<AssetInfo> {
    const bytes = await window.raeydzone.studio.readAsset(this.projectId, file)
    const bitmap = await decode(bytes)
    const id = this.unique()
    const info: AssetInfo = { id, file, w: bitmap.width, h: bitmap.height, label, source }
    this.pixels.set(id, bitmap)
    this.infos.set(id, info)
    return info
  }
}
