import type { RaeydZoneApi } from './index'

declare global {
  interface Window {
    raeydzone: RaeydZoneApi
  }
}

export {}
