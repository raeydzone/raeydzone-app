import * as Dialog from '@radix-ui/react-dialog'
import * as Switch from '@radix-ui/react-switch'
import { AnimatePresence, motion } from 'motion/react'
import { useRef, useState } from 'react'
import type { DragEvent, ReactNode } from 'react'
import { STEP_IDS, STEP_LABELS } from '@shared/types'
import type { Steps } from '@shared/types'
import { formatStamp } from '@shared/format'
import { IconCheck } from './Icons'
import s from './components.module.css'
import ui from '../styles/ui.module.css'

export function DropZone({
  onDrop,
  label,
  className,
  children
}: {
  onDrop: (paths: string[]) => void
  label: string
  className?: string
  children: ReactNode
}): ReactNode {
  const [over, setOver] = useState(false)
  const depth = useRef(0)

  const reset = (): void => {
    depth.current = 0
    setOver(false)
  }

  const handleDrop = (e: DragEvent): void => {
    e.preventDefault()
    reset()
    const files = Array.from(e.dataTransfer.files)
    if (!files.length) return
    const paths = window.raeydzone.pathsOf(files).filter(Boolean)
    if (paths.length) onDrop(paths)
  }

  return (
    <div
      className={`${s.drop} ${over ? s.dropActive : ''} ${className ?? ''}`}
      onDragEnter={(e) => {
        e.preventDefault()
        depth.current++
        setOver(true)
      }}
      onDragLeave={() => {
        depth.current--
        if (depth.current <= 0) reset()
      }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={handleDrop}
    >
      {children}
      <AnimatePresence>
        {over && (
          <motion.div
            className={s.dropVeil}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.12 }}
          >
            {label}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

export function Thumb({
  src,
  hint = 'No thumbnail'
}: {
  src: string | null
  hint?: string
}): ReactNode {
  return (
    <div className={s.thumb}>
      {src ? <img src={src} alt="" /> : <div className={s.thumbEmpty}>{hint}</div>}
    </div>
  )
}

export function Toggle({
  checked,
  onChange,
  label
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label: string
}): ReactNode {
  return (
    <label className={s.switchLabel}>
      <Switch.Root className={s.switchRoot} checked={checked} onCheckedChange={onChange}>
        <Switch.Thumb className={s.switchThumb} />
      </Switch.Root>
      {label}
    </label>
  )
}

export function StepPips({ steps }: { steps: Steps }): ReactNode {
  return (
    <div className={s.pips}>
      {STEP_IDS.map((id) => (
        <span key={id} className={`${s.pip} ${steps[id] ? s.pipDone : ''}`} />
      ))}
    </div>
  )
}

export function CardSteps({ steps }: { steps: Steps }): ReactNode {
  return (
    <div className={s.cardSteps}>
      {STEP_IDS.map((id) => (
        <div key={id} className={`${s.cardStep} ${steps[id] ? s.cardStepDone : ''}`}>
          <span className={`${s.cardStepDot} ${steps[id] ? s.cardStepDotDone : ''}`} />
          {STEP_LABELS[id]}
          {steps[id] && (
            <span className={s.cardStepStamp}>{formatStamp(steps[id]).slice(0, -6)}</span>
          )}
        </div>
      ))}
    </div>
  )
}

export function Timeline({
  steps,
  onToggle
}: {
  steps: Steps
  onToggle: (id: (typeof STEP_IDS)[number]) => void
}): ReactNode {
  return (
    <div>
      {STEP_IDS.map((id) => (
        <button
          key={id}
          className={`${s.tlRow} ${steps[id] ? s.tlDone : ''}`}
          onClick={() => onToggle(id)}
        >
          <span className={s.tlNode}>
            <motion.span
              className={s.tlDot}
              animate={{ scale: steps[id] ? [1, 1.2, 1] : 1 }}
              transition={{ duration: 0.22 }}
            >
              <IconCheck size={12} />
            </motion.span>
          </span>
          <span className={s.tlLabel}>{STEP_LABELS[id]}</span>
          <span className={s.tlStamp}>{steps[id] ? formatStamp(steps[id]) : ''}</span>
        </button>
      ))}
    </div>
  )
}

export function Prompt({
  open,
  title,
  placeholder,
  initial = '',
  confirmLabel = 'Create',
  onConfirm,
  onOpenChange
}: {
  open: boolean
  title: string
  placeholder: string
  initial?: string
  confirmLabel?: string
  onConfirm: (value: string) => void
  onOpenChange: (open: boolean) => void
}): ReactNode {
  const [value, setValue] = useState(initial)

  const submit = (): void => {
    const trimmed = value.trim()
    if (!trimmed) return
    onConfirm(trimmed)
    onOpenChange(false)
  }

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        if (next) setValue(initial)
        onOpenChange(next)
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className={s.overlay} />
        <Dialog.Content className={s.modal}>
          <Dialog.Title className={s.modalTitle}>{title}</Dialog.Title>
          <input
            className={ui.input}
            autoFocus
            value={value}
            placeholder={placeholder}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
          />
          <div className={s.modalActions}>
            <Dialog.Close asChild>
              <button className={`${ui.btn} ${ui.btnGhost}`}>Cancel</button>
            </Dialog.Close>
            <button
              className={`${ui.btn} ${ui.btnPrimary}`}
              onClick={submit}
              disabled={!value.trim()}
            >
              {confirmLabel}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
