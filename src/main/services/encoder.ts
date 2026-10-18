import { app } from 'electron'
import { readFileSync } from 'node:fs'
import type { Encoder } from '@shared/types'
import { settingsFile } from './settings'

let running: Encoder = 'gpu'

// Chromium reads GPU switches once, before app.ready, so the saved choice is read
// synchronously here and a change only lands on the next launch.
export function applyEncoderSwitch(): void {
  try {
    running = JSON.parse(readFileSync(settingsFile(), 'utf-8')).videoEncoder === 'cpu' ? 'cpu' : 'gpu'
  } catch {
    running = 'gpu'
  }
  if (running === 'cpu') app.commandLine.appendSwitch('disable-accelerated-video-encode')
}

export const runningEncoder = (): Encoder => running
