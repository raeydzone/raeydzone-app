import * as Dialog from '@radix-ui/react-dialog'
import { motion } from 'motion/react'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { ProjectFile } from '@shared/types'
import { IconClose, IconEye, IconPlay, IconStop } from './Icons'
import { useStore } from '../state/store'
import s from './components.module.css'

let stopCurrent: (() => void) | null = null

const BARS = [0, 0.12, 0.24]

function AudioButton({ file, url }: { file: ProjectFile; url: string }): ReactNode {
  const { notify } = useStore()
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const [playing, setPlaying] = useState(false)

  // Detaching the source releases the file; a paused element would keep it open.
  const stop = useCallback(() => {
    const audio = audioRef.current
    audioRef.current = null
    if (audio) {
      audio.onended = null
      audio.onerror = null
      audio.pause()
      audio.removeAttribute('src')
      audio.load()
    }
    if (stopCurrent === stop) stopCurrent = null
    setPlaying(false)
  }, [])

  useEffect(() => stop, [stop])

  const toggle = (): void => {
    if (playing) return stop()
    stopCurrent?.()
    const fail = (): void => {
      stop()
      notify(`Could not play ${file.name}`, 'bad')
    }
    const audio = new Audio(url)
    audio.onended = stop
    audio.onerror = fail
    audioRef.current = audio
    stopCurrent = stop
    setPlaying(true)
    audio.play().catch(fail)
  }

  return (
    <button
      className={`${s.fileAction} ${playing ? s.fileActionLive : ''}`}
      title={playing ? 'Stop' : 'Play'}
      aria-label={playing ? `Stop ${file.name}` : `Play ${file.name}`}
      onClick={toggle}
    >
      {!playing && <IconPlay size={13} />}
      {playing && (
        <>
          <span className={s.eq}>
            {BARS.map((delay) => (
              <motion.span
                key={delay}
                className={s.eqBar}
                animate={{ height: ['30%', '100%', '45%'] }}
                transition={{ duration: 0.7, delay, repeat: Infinity, repeatType: 'mirror' }}
              />
            ))}
          </span>
          <span className={s.eqStop}>
            <IconStop size={13} />
          </span>
        </>
      )}
    </button>
  )
}

function ImageButton({ file, url }: { file: ProjectFile; url: string }): ReactNode {
  const animated = file.name.toLowerCase().endsWith('.gif')

  return (
    <Dialog.Root>
      <Dialog.Trigger asChild>
        <button
          className={s.fileAction}
          title={animated ? 'Play GIF' : 'View image'}
          aria-label={`${animated ? 'Play' : 'View'} ${file.name}`}
        >
          {animated ? <IconPlay size={13} /> : <IconEye size={14} />}
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className={s.overlay} />
        <Dialog.Content className={s.viewer} aria-describedby={undefined} asChild>
          <motion.div
            initial={{ opacity: 0, scale: 0.97 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.16, ease: [0.22, 0.61, 0.36, 1] }}
          >
            <div className={s.viewerHead}>
              <Dialog.Title className={s.viewerTitle}>{file.name}</Dialog.Title>
              <Dialog.Close asChild>
                <button className={s.fileAction} title="Close" aria-label="Close preview">
                  <IconClose size={12} />
                </button>
              </Dialog.Close>
            </div>
            <img className={s.viewerImage} src={url} alt={file.name} draggable={false} />
          </motion.div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

export function PreviewButton({ file, url }: { file: ProjectFile; url: string }): ReactNode {
  if (file.kind === 'audio') return <AudioButton file={file} url={url} />
  if (file.kind === 'image') return <ImageButton file={file} url={url} />
  return <span />
}
