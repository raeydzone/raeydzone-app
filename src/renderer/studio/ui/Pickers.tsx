import * as Menu from '@radix-ui/react-dropdown-menu'
import type { ReactNode } from 'react'
import { CLAUDE_EFFORTS, CLAUDE_MODELS, IMAGE_MODELS, IMAGE_TASKS } from '@shared/studio'
import type { ClaudeChoice, ImageModels, ImageTask } from '@shared/studio'
import { MenuSelect } from '../../components/MenuSelect'
import { IconCheck, IconChevron, IconClaude, IconImage, IconPlus } from '../../components/Icons'
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
        <Menu.Content className={k.menu} align="start" sideOffset={6} collisionPadding={12}>
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
  choice,
  scope,
  onChange
}: {
  choice: ClaudeChoice
  scope: string
  onChange: (patch: Partial<ClaudeChoice>) => void
}): ReactNode {
  const model = CLAUDE_MODELS.find((m) => m.id === choice.model) ?? CLAUDE_MODELS[0]
  const effort = CLAUDE_EFFORTS.find((e) => e.id === choice.effort) ?? CLAUDE_EFFORTS[1]
  return (
    <MenuSelect
      claude
      title={`Model and effort for ${scope} — higher effort uses more of your plan`}
      trigger={
        <>
          <IconClaude size={15} />
          <span>{model.label.replace('Claude ', '')}</span>
          <span className={s.pillDim}>· {effort.label}</span>
        </>
      }
      groups={[
        { title: `Model · ${scope}`, value: model.id, options: CLAUDE_MODELS, onChange: (id) => onChange({ model: id }) },
        { title: 'Effort', value: effort.id, options: CLAUDE_EFFORTS, onChange: (id) => onChange({ effort: id }) }
      ]}
    />
  )
}

export function ImageModelsPicker({
  models,
  onChange
}: {
  models: ImageModels
  onChange: (task: ImageTask, id: string) => void
}): ReactNode {
  return (
    <MenuSelect
      title="Image models used by this studio — by you and by Claude"
      trigger={
        <>
          <IconImage size={14} />
          <span>Image models</span>
        </>
      }
      groups={IMAGE_TASKS.map((t) => ({
        title: t.label,
        value: models[t.id],
        options: IMAGE_MODELS,
        onChange: (id: string) => onChange(t.id, id)
      }))}
    />
  )
}
