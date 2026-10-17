import * as Menu from '@radix-ui/react-dropdown-menu'
import type { ReactNode } from 'react'
import { CLAUDE_MODELS } from '@shared/studio'
import { IconCheck, IconChevron, IconClaude, IconPlus } from '../../components/Icons'
import type { VariantState } from '../engine'
import s from './studio.module.css'

const STATUS_LABEL: Record<VariantState['status'], string> = {
  idle: 'ready',
  working: 'working',
  stopped: 'stopped',
  error: 'error'
}

export function VersionPicker({
  variants,
  activeId,
  generating,
  onPick,
  onNew
}: {
  variants: VariantState[]
  activeId: string | null
  generating: boolean
  onPick: (id: string) => void
  onNew: () => void
}): ReactNode {
  const active = variants.find((v) => v.id === activeId)
  const title = generating || !active ? 'New versions' : active.name
  return (
    <Menu.Root>
      <Menu.Trigger className={s.pickerTitle} disabled={!variants.length}>
        <span>{title}</span>
        {variants.length > 0 && <IconChevron size={13} />}
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Content className={s.menu} align="start" sideOffset={6}>
          <Menu.Label className={s.menuLabel}>Versions · {variants.length}</Menu.Label>
          {variants.map((v) => (
            <Menu.Item key={v.id} className={s.menuItem} onSelect={() => onPick(v.id)}>
              <span className={`${s.statusDot} ${s['status_' + v.status]}`} />
              <span className={s.menuText}>{v.name}</span>
              <span className={s.menuMeta}>{STATUS_LABEL[v.status]}</span>
              {!generating && v.id === activeId && <IconCheck size={13} />}
            </Menu.Item>
          ))}
          <Menu.Separator className={s.menuSep} />
          <Menu.Item className={s.menuItem} onSelect={onNew}>
            <IconPlus size={13} />
            <span className={s.menuText}>New versions…</span>
          </Menu.Item>
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  )
}

export function ModelPicker({ model, onChange }: { model: string; onChange: (id: string) => void }): ReactNode {
  const current = CLAUDE_MODELS.find((m) => m.id === model) ?? CLAUDE_MODELS[0]
  return (
    <Menu.Root>
      <Menu.Trigger className={s.modelPill} title="Model that designs the thumbnail">
        <IconClaude size={15} />
        <span>{current.label.replace('Claude ', '')}</span>
        <IconChevron size={12} />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Content className={s.menu} align="end" sideOffset={6}>
          <Menu.Label className={s.menuLabel}>Designer model</Menu.Label>
          {CLAUDE_MODELS.map((m) => (
            <Menu.Item key={m.id} className={s.menuItem} onSelect={() => onChange(m.id)}>
              <IconClaude size={14} />
              <span className={s.menuText}>{m.label}</span>
              {m.id === current.id && <IconCheck size={13} />}
            </Menu.Item>
          ))}
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  )
}
