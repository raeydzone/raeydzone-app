import * as Slider from '@radix-ui/react-slider'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useId, useState } from 'react'
import type { ReactNode } from 'react'
import type { Encoder, Video } from '@shared/types'
import { MenuSelect } from '../components/MenuSelect'
import { useAppState, useStore } from '../state/store'
import type { ToolMeta } from './catalog'
import k from '../styles/soft.module.css'
import t from './tools.module.css'

const EASE = [0.22, 0.61, 0.36, 1] as const

export const clock = (seconds: number): string => {
  const total = Math.max(0, Math.floor(seconds))
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

export function ToolHeader({ tool }: { tool: ToolMeta }): ReactNode {
  return (
    <header className={t.head}>
      <span className={t.headIcon}>
        <tool.Icon size={21} />
      </span>
      <div>
        <h1 className={t.title}>{tool.title}</h1>
        <p className={t.blurb}>{tool.blurb}</p>
      </div>
    </header>
  )
}

export function Field({
  label,
  value,
  children
}: {
  label: string
  value?: ReactNode
  children: ReactNode
}): ReactNode {
  return (
    <div className={t.field}>
      <div className={t.fieldHead}>
        <span className={t.label}>{label}</span>
        {value !== undefined && <span className={t.value}>{value}</span>}
      </div>
      {children}
    </div>
  )
}

interface Option<T> {
  id: T
  label: string
  note?: string
  title?: string
}

export function Choice<T extends string | number>({
  label,
  value,
  options,
  onChange,
  disabled,
  empty = 'Nothing to pick'
}: {
  label: string
  value: T
  options: Option<T>[]
  onChange: (value: T) => void
  disabled?: boolean
  empty?: string
}): ReactNode {
  const current = options.find((o) => o.id === value)
  return (
    <MenuSelect
      wide
      align="start"
      disabled={disabled || options.length === 0}
      trigger={<span className={t.choiceText}>{current?.label ?? empty}</span>}
      groups={[
        {
          title: label,
          value: String(value),
          options: options.map((o) => ({ id: String(o.id), label: o.label, note: o.note })),
          onChange: (id) => {
            const picked = options.find((o) => String(o.id) === id)
            if (picked) onChange(picked.id)
          }
        }
      ]}
    />
  )
}

export function Segmented<T extends string | number>({
  value,
  options,
  onChange,
  disabled
}: {
  value: T
  options: Option<T>[]
  onChange: (value: T) => void
  disabled?: boolean
}): ReactNode {
  const pill = useId()
  return (
    <div className={t.segmented} role="radiogroup">
      {options.map((o) => {
        const on = o.id === value
        return (
          <button
            key={String(o.id)}
            role="radio"
            aria-checked={on}
            title={o.title}
            disabled={disabled}
            className={`${t.segment} ${on ? t.segmentOn : ''}`}
            onClick={() => onChange(o.id)}
          >
            {on && (
              <motion.span
                layoutId={pill}
                className={t.segmentPill}
                transition={{ duration: 0.18, ease: EASE }}
              />
            )}
            <span className={t.segmentText}>{o.label}</span>
          </button>
        )
      })}
    </div>
  )
}

export function Range({
  label,
  value,
  onChange,
  min,
  max,
  step = 1
}: {
  label: string
  value: number
  onChange: (value: number) => void
  min: number
  max: number
  step?: number
}): ReactNode {
  return (
    <Slider.Root
      className={t.range}
      value={[value]}
      min={min}
      max={max}
      step={step}
      onValueChange={([v]) => onChange(v)}
    >
      <Slider.Track className={t.rangeTrack}>
        <Slider.Range className={t.rangeFill} />
      </Slider.Track>
      <Slider.Thumb className={t.rangeThumb} aria-label={label} />
    </Slider.Root>
  )
}

export function RecDot({ live = false }: { live?: boolean }): ReactNode {
  return (
    <motion.span
      className={t.recDot}
      animate={live ? { opacity: [1, 0.25, 1] } : { opacity: 1 }}
      transition={live ? { duration: 1.2, repeat: Infinity, ease: 'easeInOut' } : undefined}
    />
  )
}

export function TakeCard({
  title,
  meta,
  actions,
  children
}: {
  title: string
  meta: string
  actions: ReactNode
  children: ReactNode
}): ReactNode {
  return (
    <motion.section
      className={t.take}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, ease: EASE }}
    >
      <div className={t.takeHead}>
        <div className={t.grow}>
          <div className={t.takeTitle}>{title}</div>
          <div className={t.takeMeta}>{meta}</div>
        </div>
        {actions}
      </div>
      {children}
    </motion.section>
  )
}

// Remembered across takes so a run of captures for one video does not re-pick it each time.
let lastProject = ''

export function SaveForm({
  projects,
  suggested,
  onSave
}: {
  projects: Video[]
  suggested: string
  onSave: (project: string, name: string) => Promise<void>
}): ReactNode {
  const [name, setName] = useState(suggested)
  const [project, setProject] = useState(() =>
    projects.some((v) => v.id === lastProject) ? lastProject : (projects[0]?.id ?? '')
  )
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!projects.some((v) => v.id === project)) setProject(projects[0]?.id ?? '')
  }, [projects, project])

  const save = async (): Promise<void> => {
    setBusy(true)
    try {
      await onSave(project, name.trim() || suggested)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div className={t.pair}>
        <Field label="Name">
          <input
            className={k.field}
            value={name}
            placeholder={suggested}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
        <Field label="Save into">
          <Choice
            label="Video project"
            value={project}
            empty="No projects yet"
            options={projects.map((v) => ({ id: v.id, label: v.name }))}
            onChange={(id) => {
              lastProject = id
              setProject(id)
            }}
          />
        </Field>
      </div>
      {projects.length === 0 && (
        <p className={t.note}>Create a video project first — captures save into its assets folder.</p>
      )}
      <button
        className={`${k.btn} ${k.btnPrimary} ${t.wide}`}
        disabled={!project || busy}
        onClick={() => void save()}
      >
        Save to assets
      </button>
    </>
  )
}

const ENCODERS: Option<Encoder>[] = [
  { id: 'gpu', label: 'GPU', title: 'Hardware encoder on the graphics card — barely touches the CPU' },
  { id: 'cpu', label: 'CPU only', title: 'Software encoder — leaves the graphics card alone' }
]

export function EncoderPicker({ inline = false }: { inline?: boolean }): ReactNode {
  const { encoder } = useAppState()
  const { run } = useStore()
  const api = window.raeydzone
  const pending = encoder.chosen !== encoder.running

  return (
    <div className={`${t.encoder} ${inline ? t.encoderInline : ''}`}>
      <Segmented
        value={encoder.chosen}
        options={ENCODERS}
        onChange={(choice) => void run(() => api.setEncoder(choice))}
      />
      <AnimatePresence initial={false}>
        {pending && (
          <motion.div
            className={t.restart}
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.16, ease: EASE }}
          >
            Applies after a restart
            <button className={t.restartBtn} onClick={() => void run(() => api.relaunch())}>
              Restart now
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
