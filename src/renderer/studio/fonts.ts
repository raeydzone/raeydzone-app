import { FONTS } from '@shared/studio'
import './fonts.css'

let loading: Promise<void> | null = null

export function loadFonts(): Promise<void> {
  loading ??= Promise.all(
    FONTS.map((f) => document.fonts.load(`900 100px "${f}"`).catch(() => []))
  ).then(() => undefined)
  return loading
}
