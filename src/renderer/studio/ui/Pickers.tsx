import * as Menu from '@radix-ui/react-dropdown-menu'
import type { ReactNode } from 'react'
import { CLAUDE_EFFORTS, CLAUDE_MODELS } from '@shared/studio'
import type { AiPrefs } from '@shared/studio'
import { MenuSelect } from '../../components/MenuSelect'
import { IconCheck, IconChevron, IconClaude, IconPlus } from '../../components/Icons'
import type { VariantState } from '../engine'
import k from '../../styles/soft.module.css'
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
        <Menu.Content className={k.menu} align="start" sideOffset={6}>
          <Menu.Label className={k.menuLabel}>Versions · {variants.length}</Menu.Label>
          {variants.map((v) => (
            <Menu.Item key={v.id} className={k.menuItem} onSelect={() => onPick(v.id)}>
              <span className={`${s.statusDot} ${s['status_' + v.status]}`} />
              <span className={k.menuText}>{v.name}</span>
              <span className={k.menuMeta}>{STATUS_LABEL[v.status]}</span>
              {!generating && v.id === activeId && <IconCheck size={13} />}
            </Menu.Item>
          ))}
          <Menu.Separator className={k.menuSep} />
          <Menu.Item className={k.menuItem} onSelect={onNew}>
            <IconPlus size={13} />
            <span className={k.menuText}>New versions…</span>
          </Menu.Item>
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  )
}

export function ClaudePicker({
  prefs,
  onChange
}: {
  prefs: AiPrefs
  onChange: (patch: Partial<AiPrefs>) => void
}): ReactNode {
  const model = CLAUDE_MODELS.find((m) => m.id === prefs.claudeModel) ?? CLAUDE_MODELS[0]
  const effort = CLAUDE_EFFORTS.find((e) => e.id === prefs.claudeEffort) ?? CLAUDE_EFFORTS[1]
  return (
    <MenuSelect
      claude
      title="Model and effort Claude designs with — higher effort uses more of your plan"
      trigger={
        <>
          <IconClaude size={15} />
          <span>{model.label.replace('Claude ', '')}</span>
          <span className={s.pillDim}>· {effort.label}</span>
        </>
      }
      groups={[
        { title: 'Model', value: model.id, options: CLAUDE_MODELS, onChange: (claudeModel) => onChange({ claudeModel }) },
        { title: 'Effort', value: effort.id, options: CLAUDE_EFFORTS, onChange: (claudeEffort) => onChange({ claudeEffort }) }
      ]}
    />
  )
}
