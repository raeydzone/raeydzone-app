export interface AudioSource {
  id: string
  label: string
  isDefault: boolean
}

export const LOOPBACK_ID = 'loopback'

// The loopback option follows whatever Windows currently has set as the default output,
// so the common case needs no configuration. Everything else is listed for the times a
// virtual cable or a specific interface is the real source.
export async function listAudioSources(): Promise<AudioSource[]> {
  const sources: AudioSource[] = [
    { id: LOOPBACK_ID, label: 'Desktop audio — current Windows output', isDefault: true }
  ]
  try {
    const devices = await navigator.mediaDevices.enumerateDevices()
    for (const device of devices) {
      if (device.kind !== 'audioinput') continue
      if (device.deviceId === 'default') continue
      sources.push({
        id: device.deviceId,
        label: device.label || 'Input ' + device.deviceId.slice(0, 6),
        isDefault: false
      })
    }
  } catch {
    /* device list is a convenience; loopback still works without it */
  }
  return sources
}

export interface RecorderHandle {
  stop: () => Promise<Uint8Array<ArrayBuffer>>
  cancel: () => void
  setGain: (value: number) => void
  levels: Uint8Array
  readLevels: () => void
  sampleRate: number
  channels: number
}

const BUFFER_SIZE = 2048

// Premiere will not reliably import webm/opus, so audio is captured as raw PCM and
// written as WAV rather than going through MediaRecorder.
export async function startRecording(
  sourceId: string,
  gain: number
): Promise<RecorderHandle> {
  let stream: MediaStream

  if (sourceId === LOOPBACK_ID) {
    stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true })
    stream.getVideoTracks().forEach((track) => {
      track.stop()
      stream.removeTrack(track)
    })
  } else {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: { exact: sourceId },
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false
      }
    })
  }

  if (stream.getAudioTracks().length === 0) {
    stream.getTracks().forEach((t) => t.stop())
    throw new Error('That source produced no audio track.')
  }

  const context = new AudioContext()
  const source = context.createMediaStreamSource(stream)
  const gainNode = context.createGain()
  gainNode.gain.value = gain

  const analyser = context.createAnalyser()
  analyser.fftSize = 1024
  const levels = new Uint8Array(analyser.frequencyBinCount)

  const channels = 2
  const processor = context.createScriptProcessor(BUFFER_SIZE, channels, channels)
  const chunks: Float32Array[][] = []
  let recording = true

  processor.onaudioprocess = (event): void => {
    if (!recording) return
    const frame: Float32Array[] = []
    for (let c = 0; c < channels; c++) {
      frame.push(new Float32Array(event.inputBuffer.getChannelData(c)))
    }
    chunks.push(frame)
  }

  source.connect(gainNode)
  gainNode.connect(analyser)
  gainNode.connect(processor)
  // ScriptProcessor only runs while connected to a destination; a muted gain node keeps
  // it alive without echoing the desktop back into the desktop.
  const silent = context.createGain()
  silent.gain.value = 0
  processor.connect(silent)
  silent.connect(context.destination)

  const teardown = (): void => {
    recording = false
    processor.onaudioprocess = null
    processor.disconnect()
    silent.disconnect()
    gainNode.disconnect()
    source.disconnect()
    stream.getTracks().forEach((t) => t.stop())
    void context.close()
  }

  return {
    levels,
    readLevels: () => analyser.getByteTimeDomainData(levels),
    sampleRate: context.sampleRate,
    channels,
    setGain: (value) => {
      gainNode.gain.value = value
    },
    cancel: teardown,
    stop: async () => {
      const rate = context.sampleRate
      recording = false
      const wav = encodeWav(chunks, channels, rate)
      teardown()
      return wav
    }
  }
}

export function encodeWav(
  chunks: Float32Array[][],
  channels: number,
  sampleRate: number
): Uint8Array<ArrayBuffer> {
  const frames = chunks.reduce((n, frame) => n + frame[0].length, 0)
  const dataBytes = frames * channels * 2
  const buffer = new ArrayBuffer(44 + dataBytes)
  const view = new DataView(buffer)

  const ascii = (offset: number, text: string): void => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i))
  }

  ascii(0, 'RIFF')
  view.setUint32(4, 36 + dataBytes, true)
  ascii(8, 'WAVE')
  ascii(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, channels, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * channels * 2, true)
  view.setUint16(32, channels * 2, true)
  view.setUint16(34, 16, true)
  ascii(36, 'data')
  view.setUint32(40, dataBytes, true)

  let offset = 44
  for (const frame of chunks) {
    for (let i = 0; i < frame[0].length; i++) {
      for (let c = 0; c < channels; c++) {
        const sample = Math.max(-1, Math.min(1, frame[c][i]))
        view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true)
        offset += 2
      }
    }
  }

  return new Uint8Array(buffer)
}

export function durationOf(bytes: number, sampleRate: number, channels: number): number {
  return Math.max(0, (bytes - 44) / (sampleRate * channels * 2))
}
