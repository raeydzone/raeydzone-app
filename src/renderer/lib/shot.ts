import type { Region } from '@shared/types'
import { desktopStream } from './screen'

export type ShotExt = 'png' | 'jpg'

export interface Shot {
  data: Uint8Array<ArrayBuffer>
  ext: ShotExt
  width: number
  height: number
}

interface Options {
  sourceId: string
  region: Region | null
  ext: ShotExt
}

const mimeOf = (ext: ShotExt): string => (ext === 'png' ? 'image/png' : 'image/jpeg')

const wait = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms))

type FrameVideo = HTMLVideoElement & {
  requestVideoFrameCallback?: (cb: () => void) => number
}

// Metadata lands a beat before the first painted frame arrives, and drawing in that gap
// gives a black image — so the draw waits for a real frame, with a ceiling in case the
// callback never fires.
async function firstFrame(stream: MediaStream): Promise<HTMLVideoElement> {
  const video = document.createElement('video') as FrameVideo
  video.srcObject = stream
  video.muted = true
  video.playsInline = true
  await video.play()
  await new Promise<void>((resolve) => {
    if (video.videoWidth > 0) resolve()
    else video.addEventListener('loadedmetadata', () => resolve(), { once: true })
  })
  await Promise.race([
    new Promise<void>((resolve) => {
      if (video.requestVideoFrameCallback) video.requestVideoFrameCallback(() => resolve())
      else resolve()
    }),
    wait(500)
  ])
  return video
}

export async function takeShot({ sourceId, region, ext }: Options): Promise<Shot> {
  const stream = await desktopStream(sourceId)
  try {
    const video = await firstFrame(stream)

    // The stream arrives at the monitor's real pixel size while the box was drawn in
    // DIPs, so the crop scales by the ratio between the two.
    const scale = region ? (video.videoWidth || region.displayWidth) / region.displayWidth : 1
    const crop = region
      ? {
          x: region.x * scale,
          y: region.y * scale,
          width: region.width * scale,
          height: region.height * scale
        }
      : { x: 0, y: 0, width: video.videoWidth, height: video.videoHeight }

    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(crop.width))
    canvas.height = Math.max(1, Math.round(crop.height))

    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Could not open a drawing surface for the screenshot.')
    ctx.drawImage(
      video,
      crop.x,
      crop.y,
      crop.width,
      crop.height,
      0,
      0,
      canvas.width,
      canvas.height
    )

    video.pause()
    video.srcObject = null

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, mimeOf(ext), 0.95)
    )
    if (!blob) throw new Error('The screenshot could not be encoded.')

    const buffer = await blob.arrayBuffer()
    return { data: new Uint8Array(buffer), ext, width: canvas.width, height: canvas.height }
  } finally {
    stream.getTracks().forEach((track) => track.stop())
  }
}

export function shotUrl(shot: Shot): string {
  return URL.createObjectURL(new Blob([shot.data], { type: mimeOf(shot.ext) }))
}

// Chromium only accepts PNG on the clipboard, so a JPEG take is re-encoded for the copy.
export async function copyShot(shot: Shot): Promise<void> {
  let blob = new Blob([shot.data], { type: mimeOf(shot.ext) })
  if (shot.ext !== 'png') {
    const bitmap = await createImageBitmap(blob)
    const canvas = document.createElement('canvas')
    canvas.width = bitmap.width
    canvas.height = bitmap.height
    canvas.getContext('2d')?.drawImage(bitmap, 0, 0)
    bitmap.close()
    const png = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/png')
    )
    if (!png) throw new Error('The screenshot could not be copied.')
    blob = png
  }
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
}
