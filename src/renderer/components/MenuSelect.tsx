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
  grid?: boolean
}

export function MenuSelect({
  groups,
  trigger,
  title,
  align = 'end',
  side = 'bottom',
  claude = false,
  wide = false,
  chip = false
}: {
  groups: MenuGroup[]
  trigger: ReactNode
  title?: string
  align?: 'start' | 'end'
  side?: 'top' | 'bottom'
  claude?: boolean
  wide?: boolean
  chip?: boolean
}): ReactNode {
  const look = chip ? k.chip : `${k.pill} ${claude ? k.pillClaude : ''} ${wide ? k.pillWide : ''}`
  return (
    <Menu.Root>
      <Menu.Trigger className={look} title={title}>
        {trigger}
        <IconChevron size={chip ? 11 : 12} />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Content
          className={`${k.menu} ${wide ? k.menuFit : ''}`}
          align={align}
          side={side}
          sideOffset={6}
          collisionPadding={12}
        >
          {groups.map((g, i) => (
            <div key={g.title}>
              {i > 0 && <Menu.Separator className={k.menuSep} />}
              <Menu.Label className={k.menuLabel}>{g.title}</Menu.Label>
              <div className={g.grid ? k.menuGrid : undefined}>
                {g.options.map((o) => (
                  <Menu.Item
                    key={o.id}
                    className={`${k.menuItem} ${g.grid ? k.menuItemDense : ''} ${o.id === g.value ? k.menuItemOn : ''}`}
                    onSelect={() => g.onChange(o.id)}
                  >
                    <span className={k.menuText}>
                      {o.label}
                      {o.note && <span className={k.menuNote}>{o.note}</span>}
                    </span>
                    {o.id === g.value && !g.grid && <IconCheck size={13} />}
                  </Menu.Item>
                ))}
              </div>
            </div>
          ))}
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  )
}
