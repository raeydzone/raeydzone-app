import * as Menu from '@radix-ui/react-context-menu'
import type { ReactNode } from 'react'
import { useStore } from '../../state/store'
import { copyLayers, cutLayers, pasteLayers } from '../clipboard'
import type { Studio, VariantState } from '../engine'
import k from '../../styles/soft.module.css'

export function LayerMenu({ studio, variant, children }: { studio: Studio; variant: VariantState; children: ReactNode }): ReactNode {
  const { notify } = useStore()
  const v = variant.id
  const ids = studio.selection(v)
  const none = !ids.length
  const groups = [...new Set(variant.doc.layers.filter((l) => ids.includes(l.id) && l.group).map((l) => l.group!))]
  const run = (fn: () => Promise<unknown> | unknown): void => {
    void (async () => fn())().catch((err: Error) => notify(err.message, 'bad'))
  }
  const item = (label: string, keys: string, fn: () => Promise<unknown> | unknown, disabled = none): ReactNode => (
    <Menu.Item className={k.menuItem} disabled={disabled} onSelect={() => run(fn)}>
      <span className={k.menuText}>{label}</span>
      <span className={k.menuMeta}>{keys}</span>
    </Menu.Item>
  )
  return (
    <Menu.Root>
      <Menu.Trigger asChild>{children}</Menu.Trigger>
      <Menu.Portal>
        <Menu.Content className={k.menu} collisionPadding={12}>
          {ids.length > 1 && <Menu.Label className={k.menuLabel}>{ids.length} layers</Menu.Label>}
          {item('Copy', 'Ctrl+C', () => copyLayers(studio, v, ids))}
          {item('Cut', 'Ctrl+X', () => cutLayers(studio, v, ids))}
          {item('Paste', 'Ctrl+V', async () => {
            if (!(await pasteLayers(studio, v))) notify('The clipboard holds no image', 'bad')
          }, false)}
          <Menu.Separator className={k.menuSep} />
          {item('Group', 'Ctrl+G', () => studio.group(v, ids), ids.length < 2)}
          {item('Ungroup', 'Ctrl+Shift+G', () => groups.forEach((g) => studio.ungroup(v, g)), !groups.length)}
          <Menu.Separator className={k.menuSep} />
          {item('Duplicate', 'Ctrl+D', () => studio.duplicateMany(v, ids))}
          {item('Delete', 'Del', () => studio.removeMany(v, ids))}
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  )
}
