import type { ReactNode } from 'react'
import { IconImage, IconMic, IconVideo } from '../components/Icons'

export type Tool = 'sound' | 'screen' | 'shot'

export interface ToolMeta {
  id: Tool
  title: string
  blurb: string
  Icon: (props: { size?: number }) => ReactNode
  tags: string[]
  encodes: boolean
}

export const TOOLS: ToolMeta[] = [
  {
    id: 'sound',
    title: 'Sound Recorder',
    blurb: 'Capture whatever Windows is playing, straight to a lossless WAV.',
    Icon: IconMic,
    tags: ['WAV', 'Desktop audio'],
    encodes: false
  },
  {
    id: 'screen',
    title: 'Screen Recorder',
    blurb: 'Record the whole screen or a box you draw, with desktop audio.',
    Icon: IconVideo,
    tags: ['MP4', 'Region', 'Audio'],
    encodes: true
  },
  {
    id: 'shot',
    title: 'Screenshot',
    blurb: 'Grab the screen or a box you draw, then save it or copy it.',
    Icon: IconImage,
    tags: ['PNG', 'JPG', 'Clipboard'],
    encodes: false
  }
]

export const toolMeta = (id: Tool): ToolMeta => TOOLS.find((t) => t.id === id) ?? TOOLS[0]
