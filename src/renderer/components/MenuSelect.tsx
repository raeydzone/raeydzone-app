import * as Menu from '@radix-ui/react-dropdown-menu'
import type { ReactNode } from 'react'
import { IconCheck, IconChevron } from './Icons'
import k from '../styles/soft.module.css'

export interface MenuOption {
  id: string
  label: string
  note?: string
}

export interface MenuGroup {
  title: string
  value: string
  options: readonly MenuOption[]
  onChange: (id: string) => void
}

export function MenuSelect({
  groups,
  trigger,
  title,
  align = 'end',
  claude = false
}: {
  groups: MenuGroup[]
  trigger: ReactNode
  title?: string
  align?: 'start' | 'end'
  claude?: boolean
}): ReactNode {
  return (
    <Menu.Root>
      <Menu.Trigger className={`${k.pill} ${claude ? k.pillClaude : ''}`} title={title}>
        {trigger}
        <IconChevron size={12} />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Content className={k.menu} align={align} sideOffset={6}>
          {groups.map((g, i) => (
            <div key={g.title}>
              {i > 0 && <Menu.Separator className={k.menuSep} />}
              <Menu.Label className={k.menuLabel}>{g.title}</Menu.Label>
              {g.options.map((o) => (
                <Menu.Item key={o.id} className={k.menuItem} onSelect={() => g.onChange(o.id)}>
                  <span className={k.menuText}>
                    {o.label}
                    {o.note && <span className={k.menuNote}>{o.note}</span>}
                  </span>
                  {o.id === g.value && <IconCheck size={13} />}
                </Menu.Item>
              ))}
            </div>
          ))}
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  )
}
