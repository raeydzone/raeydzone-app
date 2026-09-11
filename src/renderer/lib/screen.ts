import type { Region } from '@shared/types'

export interface Clip {
  data: Uint8Array<ArrayBuffer>
  ext: string
  seconds: number
}

export interface ClipHandle {
  stop: () => Promise<Clip>
  cancel: () => void
  setMuted: (muted: boolean) => void
  preview: MediaStream
  hasAudio: boolean
}

// Premiere is the destination, so MP4 wins when Chromium can mux it; WebM is the
// fallback rather than the default. Probed at runtime because support moves with Electron.
const CANDIDATES = [
  'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
  'video/mp4;codecs=avc1',
  'video/mp4',
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm'
]

export function pickFormat(): { mime: string; ext: string } {
  for (const mime of CANDIDATES) {
    if (MediaRecorder.isTypeSupported(mime)) {
      return { mime, ext: mime.startsWith('video/mp4') ? 'mp4' : 'webm' }
    }
  }
  return { mime: '', ext: 'webm' }
}

async function desktopStream(sourceId: string): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({
    audio: false,
    video: { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: sourceId } }
  } as unknown as MediaStreamConstraints)
}

async function loopbackTrack(): Promise<MediaStreamTrack | null> {
  const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true })
  stream.getVideoTracks().forEach((track) => {
    track.stop()
    stream.removeTrack(track)
  })
  return stream.getAudioTracks()[0] ?? null
}

interface Options {
  sourceId: string
  region: Region | null
  withAudio: boolean
  fps: number
}

export async function startClip(options: Options): Promise<ClipHandle> {
  const { sourceId, region, withAudio, fps } = options
  const screen = await desktopStream(sourceId)

  let audio: MediaStreamTrack | null = null
  if (withAudio) {
    try {
      audio = await loopbackTrack()
    } catch {
      /* a recording without sound beats no recording at all */
    }
  }

  const cleanup: (() => void)[] = [
    () => screen.getTracks().forEach((t) => t.stop()),
    () => audio?.stop()
  ]

  let videoTrack: MediaStreamTrack
  if (region) {
    const composed = await cropTrack(screen, region, fps, cleanup)
    videoTrack = composed
  } else {
    videoTrack = screen.getVideoTracks()[0]
  }

  const tracks = audio ? [videoTrack, audio] : [videoTrack]
  const mixed = new MediaStream(tracks)

  const { mime, ext } = pickFormat()
  const pixels = region
    ? region.width * region.height
    : (videoTrack.getSettings().width ?? 1920) * (videoTrack.getSettings().height ?? 1080)
  const bitrate = Math.min(40_000_000, Math.max(2_000_000, Math.round(pixels * fps * 0.12)))

  const recorder = new MediaRecorder(mixed, {
    ...(mime ? { mimeType: mime } : {}),
    videoBitsPerSecond: bitrate
  })

  const chunks: Blob[] = []
  recorder.ondataavailable = (e): void => {
    if (e.data.size > 0) chunks.push(e.data)
  }
  const startedAt = performance.now()
  recorder.start(1000)

  const finish = (): void => cleanup.forEach((fn) => fn())

  return {
    preview: mixed,
    hasAudio: !!audio,
    setMuted: (muted) => {
      if (audio) audio.enabled = !muted
    },
    cancel: () => {
      if (recorder.state !== 'inactive') recorder.stop()
      finish()
    },
    stop: () =>
      new Promise<Clip>((resolve, reject) => {
        recorder.onerror = (): void => {
          finish()
          reject(new Error('The recorder stopped unexpectedly.'))
        }
        recorder.onstop = (): void => {
          finish()
          const seconds = (performance.now() - startedAt) / 1000
          const blob = new Blob(chunks, { type: mime || 'video/webm' })
          void blob
            .arrayBuffer()
            .then((buf) => resolve({ data: new Uint8Array(buf), ext, seconds }))
            .catch(reject)
        }
        if (recorder.state === 'inactive') recorder.onstop?.(new Event('stop'))
        else recorder.stop()
      })
  }
}

// The desktop stream arrives at the monitor's real pixel size while the region was picked
// in DIPs, so everything scales by the ratio between the two before it is cropped.
async function cropTrack(
  screen: MediaStream,
  region: Region,
  fps: number,
  cleanup: (() => void)[]
): Promise<MediaStreamTrack> {
  const video = document.createElement('video')
  video.srcObject = screen
  video.muted = true
  video.playsInline = true
  await video.play()
  await new Promise<void>((resolve) => {
    if (video.videoWidth > 0) resolve()
    else video.addEventListener('loadedmetadata', () => resolve(), { once: true })
  })

  const scale = (video.videoWidth || region.displayWidth) / region.displayWidth
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(2, Math.round(region.width * scale))
  canvas.height = Math.max(2, Math.round(region.height * scale))

  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Could not open a drawing surface for the region.')

  let frame = 0
  const draw = (): void => {
    ctx.drawImage(
      video,
      region.x * scale,
      region.y * scale,
      region.width * scale,
      region.height * scale,
      0,
      0,
      canvas.width,
      canvas.height
    )
    frame = requestAnimationFrame(draw)
  }
  draw()

  cleanup.push(() => {
    cancelAnimationFrame(frame)
    video.pause()
    video.srcObject = null
  })

  return canvas.captureStream(fps).getVideoTracks()[0]
}
