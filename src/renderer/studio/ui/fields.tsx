import * as Slider from '@radix-ui/react-slider'
import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import s from './studio.module.css'

export function Section({ title, children, aside }: { title: string; children: ReactNode; aside?: ReactNode }): ReactNode {
  return (
    <div className={s.section}>
      <div className={s.sectionHead}>
        <span>{title}</span>
        {aside}
      </div>
      {children}
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
  const join = (h: string, al: number): string =>
    al >= 1 ? h : h + Math.round(al * 255).toString(16).padStart(2, '0')
  return (
    <label className={s.color}>
      <span>{label}</span>
      <input type="color" value={hex} onChange={(e) => onChange(join(e.target.value, a))} />
      {alpha && (
        <input
          className={s.colorAlpha}
          type="number"
          min={0}
          max={100}
          value={Math.round(a * 100)}
          title="Opacity %"
          onChange={(e) => onChange(join(hex, Math.max(0, Math.min(100, Number(e.target.value))) / 100))}
        />
      )}
    </label>
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
