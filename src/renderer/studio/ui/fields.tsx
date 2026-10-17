import * as Slider from '@radix-ui/react-slider'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { IconChevron } from '../../components/Icons'
import s from './studio.module.css'

// The inspector remounts for every selected layer, so folded sections are remembered here
// rather than in component state, or they would spring open on each click.
const folded = new Set<string>()

export function Section({ title, children, aside }: { title: string; children: ReactNode; aside?: ReactNode }): ReactNode {
  const [open, setOpen] = useState(!folded.has(title))
  const toggle = (): void => {
    if (open) folded.add(title)
    else folded.delete(title)
    setOpen(!open)
  }
  return (
    <div className={s.section}>
      <div className={s.sectionHead}>
        <button className={s.sectionToggle} onClick={toggle} aria-expanded={open}>
          <motion.span className={s.sectionChevron} animate={{ rotate: open ? 0 : -90 }} transition={{ duration: 0.16 }}>
            <IconChevron size={11} />
          </motion.span>
          {title}
        </button>
        {open && aside}
      </div>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            className={s.sectionBody}
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18, ease: [0.22, 0.61, 0.36, 1] }}
          >
            {children}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

export function NumField({
  label,
  value,
  onChange,
  step = 1,
  min,
  max
}: {
  label: string
  value: number
  onChange: (v: number) => void
  step?: number
  min?: number
  max?: number
}): ReactNode {
  const shown = Math.round(value * 100) / 100
  const [draft, setDraft] = useState(String(shown))
  useEffect(() => setDraft(String(shown)), [shown])
  return (
    <label className={s.num}>
      <span>{label}</span>
      <input
        type="number"
        value={draft}
        step={step}
        min={min}
        max={max}
        onChange={(e) => {
          setDraft(e.target.value)
          const n = Number(e.target.value)
          if (e.target.value !== '' && Number.isFinite(n)) onChange(n)
        }}
      />
    </label>
  )
}

export function SliderField({
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
  unit = ''
}: {
  label: string
  value: number
  onChange: (v: number) => void
  min: number
  max: number
  step?: number
  unit?: string
}): ReactNode {
  return (
    <div className={s.sliderField}>
      <div className={s.sliderHead}>
        <span>{label}</span>
        <span className={s.sliderValue}>
          {Math.round(value * 100) / 100}
          {unit}
        </span>
      </div>
      <Slider.Root
        className={s.slider}
        value={[value]}
        min={min}
        max={max}
        step={step}
        onValueChange={([v]) => onChange(v)}
      >
        <Slider.Track className={s.sliderTrack}>
          <Slider.Range className={s.sliderRange} />
        </Slider.Track>
        <Slider.Thumb className={s.sliderThumb} aria-label={label} />
      </Slider.Root>
    </div>
  )
}

function splitAlpha(value: string): { hex: string; alpha: number } {
  const m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(value)
  if (m) return { hex: '#' + m[1], alpha: m[2] ? parseInt(m[2], 16) / 255 : 1 }
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(value)
  if (short) return { hex: '#' + short.slice(1).map((c) => c + c).join(''), alpha: 1 }
  return { hex: '#ffffff', alpha: 1 }
}

const bare = (hex: string): string => hex.slice(1).toUpperCase()

export function ColorField({
  label,
  value,
  onChange,
  alpha = false
}: {
  label: string
  value: string
  onChange: (v: string) => void
  alpha?: boolean
}): ReactNode {
  const { hex, alpha: a } = splitAlpha(value)
  const [draft, setDraft] = useState(bare(hex))
  useEffect(() => setDraft(bare(hex)), [hex])
  const join = (h: string, al: number): string =>
    al >= 1 ? h : h + Math.round(al * 255).toString(16).padStart(2, '0')
  const commit = (): void => {
    const typed = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(draft.trim())
    if (typed) onChange(join(splitAlpha('#' + typed[1]).hex, a))
    else setDraft(bare(hex))
  }
  return (
    <div className={s.colorField}>
      <span className={s.fieldLabel}>{label}</span>
      <div className={s.color}>
        <label className={s.swatch} style={{ '--swatch': value } as CSSProperties} title="Pick a colour">
          <input type="color" value={hex} onChange={(e) => onChange(join(e.target.value, a))} />
        </label>
        <span className={s.hexMark}>#</span>
        <input
          className={s.hex}
          value={draft}
          maxLength={7}
          spellCheck={false}
          aria-label={label + ' hex'}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
        />
        {alpha && (
          <label className={s.colorAlpha} title="Opacity">
            <input
              type="number"
              min={0}
              max={100}
              value={Math.round(a * 100)}
              onChange={(e) => onChange(join(hex, Math.max(0, Math.min(100, Number(e.target.value))) / 100))}
            />
            %
          </label>
        )}
      </div>
    </div>
  )
}

export function Segmented<T extends string>({
  value,
  options,
  onChange
}: {
  value: T
  options: { id: T; label: ReactNode; title?: string }[]
  onChange: (v: T) => void
}): ReactNode {
  return (
    <div className={s.segmented}>
      {options.map((o) => (
        <button
          key={o.id}
          title={o.title}
          className={`${s.segment} ${o.id === value ? s.segmentOn : ''}`}
          onClick={() => onChange(o.id)}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
