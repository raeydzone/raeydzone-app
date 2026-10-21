import * as Dialog from '@radix-ui/react-dialog'
import * as Popover from '@radix-ui/react-popover'
import { useState } from 'react'
import type { ReactNode } from 'react'
import { formatStamp } from '@shared/format'
import { Toggle } from '../../components/Bits'
import { useStore } from '../../state/store'
import type { Studio, VariantState } from '../engine'
import { EXPORT_SIZES, exportFiles } from '../exporter'
import { Segmented } from './fields'
import c from '../../components/components.module.css'
import k from '../../styles/soft.module.css'
import s from './studio.module.css'

export function SnapshotsButton({
  studio,
  variant,
  compare,
  setCompare
}: {
  studio: Studio
  variant: VariantState
  compare: string | null
  setCompare: (id: string | null) => void
}): ReactNode {
  const [name, setName] = useState('')
  const v = variant.id
  const snaps = [...variant.snapshots].reverse()
  return (
    <Popover.Root>
      <Popover.Trigger className={`${k.btn} ${k.btnGhost} ${compare ? s.chipOn : ''}`} title="Save the design as it is now, compare and go back">
        Snapshots{variant.snapshots.length ? ` · ${variant.snapshots.length}` : ''}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content className={`${k.menu} ${s.snapMenu}`} align="end" sideOffset={6} collisionPadding={12}>
          <div className={s.rowGap}>
            <input
              className={`${k.field} ${s.grow}`}
              placeholder="Name it, e.g. Red version"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== 'Enter') return
                studio.saveSnapshot(v, name)
                setName('')
              }}
            />
            <button
              className={`${k.btn} ${k.btnPrimary}`}
              onClick={() => {
                studio.saveSnapshot(v, name)
                setName('')
              }}
            >
              Save
            </button>
          </div>
          {snaps.length === 0 && <p className={s.hint}>No snapshots yet. Save one before a big change to compare it side by side.</p>}
          <div className={s.snapList}>
            {snaps.map((sn) => (
              <div key={sn.id} className={`${s.snapRow} ${compare === sn.id ? s.snapRowOn : ''}`}>
                <div className={s.layerLabel}>
                  <span className={s.layerName}>{sn.name}</span>
                  <span className={s.layerKind}>{formatStamp(sn.at)}</span>
                </div>
                <button className={k.chip} title="Split view: the snapshot left, now right" onClick={() => setCompare(compare === sn.id ? null : sn.id)}>
                  {compare === sn.id ? 'Stop' : 'Compare'}
                </button>
                <button
                  className={k.chip}
                  title="Bring this design back — undo returns to now"
                  onClick={() => {
                    studio.restoreSnapshot(v, sn.id)
                    setCompare(null)
                  }}
                >
                  Restore
                </button>
                <button
                  className={k.chip}
                  title="Delete the snapshot"
                  onClick={() => {
                    if (compare === sn.id) setCompare(null)
                    studio.removeSnapshot(v, sn.id)
                  }}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}

export function ExportButton({ studio, variant, projectName }: { studio: Studio; variant: VariantState; projectName: string }): ReactNode {
  const { notify } = useStore()
  const [open, setOpen] = useState(false)
  const [sizes, setSizes] = useState<number[]>([1280])
  const [format, setFormat] = useState<'jpg' | 'png'>('jpg')
  const [supersample, setSupersample] = useState(true)
  const [limit, setLimit] = useState(true)
  const [busy, setBusy] = useState(false)
  const run = async (): Promise<void> => {
    setBusy(true)
    try {
      const items = await exportFiles(variant.doc, studio.assets, `${projectName} ${variant.name}`, { sizes, format, supersample, limit })
      const n = await window.raeydzone.studio.exportFiles(studio.projectId, items)
      notify(`Exported ${n} ${n === 1 ? 'file' : 'files'} into the project's thumbnail_studio/exports folder`)
      setOpen(false)
    } catch (err) {
      notify((err as Error).message, 'bad')
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger className={`${k.btn} ${k.btnGhost}`}>Export…</Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className={c.overlay} />
        <Dialog.Content className={c.modal}>
          <Dialog.Title className={c.modalTitle}>Export {variant.name}</Dialog.Title>
          <Dialog.Description className={c.modalText}>
            Every size is rendered fresh from the layers, not stretched from the canvas.
          </Dialog.Description>
          <div className={s.exportBody}>
            <div className={s.exportGrid}>
              {EXPORT_SIZES.map((size) => (
                <Toggle
                  key={size.w}
                  checked={sizes.includes(size.w)}
                  onChange={(on) => setSizes(on ? [...sizes, size.w].sort((a, b) => a - b) : sizes.filter((w) => w !== size.w))}
                  label={`${size.label} · ${size.note}`}
                />
              ))}
            </div>
            <Segmented value={format} onChange={setFormat} options={[{ id: 'jpg', label: 'JPG' }, { id: 'png', label: 'PNG' }]} />
            <Toggle checked={supersample} onChange={setSupersample} label="Supersample — render at double size for cleaner edges" />
            {format === 'jpg' && <Toggle checked={limit} onChange={setLimit} label="Keep each file under 2 MB, YouTube's limit" />}
          </div>
          <div className={c.modalActions}>
            <Dialog.Close asChild>
              <button className={`${k.btn} ${k.btnGhost}`}>Cancel</button>
            </Dialog.Close>
            <button className={`${k.btn} ${k.btnPrimary}`} disabled={busy || !sizes.length} onClick={() => void run()}>
              {busy ? 'Exporting…' : 'Export'}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
