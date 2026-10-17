import * as Popover from '@radix-ui/react-popover'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent, ReactNode } from 'react'
import { IconChevron, IconSearch } from '../../components/Icons'
import { fontFamilies } from '../fonts'
import type { FontFamily } from '../fonts'
import k from '../../styles/soft.module.css'
import s from './studio.module.css'

const face = (name: string): { fontFamily: string } => ({ fontFamily: `"${name}"` })

export function FontPicker({ value, onChange }: { value: string; onChange: (font: string) => void }): ReactNode {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return fontFamilies().filter((f) => !needle || f.name.toLowerCase().includes(needle))
  }, [query])

  useEffect(() => setActive(0), [query])

  useEffect(() => {
    if (!open) return
    setQuery('')
    const at = fontFamilies().findIndex((f) => f.name === value)
    setActive(Math.max(0, at))
    requestAnimationFrame(() => listRef.current?.querySelector('[data-current]')?.scrollIntoView({ block: 'center' }))
  }, [open, value])

  useEffect(() => {
    listRef.current?.querySelector('[data-active]')?.scrollIntoView({ block: 'nearest' })
  }, [active])

  const pick = (f: FontFamily | undefined): void => {
    if (!f) return
    onChange(f.name)
    setOpen(false)
  }

  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'ArrowDown') setActive((i) => Math.min(matches.length - 1, i + 1))
    else if (e.key === 'ArrowUp') setActive((i) => Math.max(0, i - 1))
    else if (e.key === 'Enter') pick(matches[active])
    else return
    e.preventDefault()
  }

  const firstInstalled = matches.findIndex((f) => !f.bundled)

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger className={`${k.field} ${s.fontTrigger}`}>
        <span style={face(value)}>{value}</span>
        <IconChevron size={12} />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content className={`${k.menu} ${s.fontMenu}`} align="start" sideOffset={6} collisionPadding={12} onKeyDown={onKey}>
          <label className={s.fontSearch}>
            <IconSearch size={13} />
            <input
              autoFocus
              value={query}
              placeholder={`Search ${fontFamilies().length} fonts`}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
          <div ref={listRef} className={s.fontList}>
            {matches.length === 0 && <p className={s.hint}>No font matches “{query}”.</p>}
            {matches.map((f, i) => (
              <div key={f.name}>
                {i === 0 && f.bundled && <div className={k.menuLabel}>Thumbnail fonts</div>}
                {i === firstInstalled && <div className={k.menuLabel}>Installed on this PC</div>}
                <button
                  className={`${s.fontItem} ${i === active ? s.fontItemActive : ''}`}
                  data-active={i === active || undefined}
                  data-current={f.name === value || undefined}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => pick(f)}
                >
                  <span className={s.fontName} style={face(f.name)}>
                    {f.name}
                  </span>
                  {f.weights.length > 1 && <span className={s.fontMeta}>{f.weights.length} weights</span>}
                  {f.name === value && <span className={s.fontCurrent} />}
                </button>
              </div>
            ))}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
