import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { AssetInfo, Layer } from '@shared/studio'
import { IconEye, IconImage, IconLock, IconPlus, IconTrash } from '../../components/Icons'
import { useStore } from '../../state/store'
import { placeAsset } from '../ai'
import type { Studio, VariantState } from '../engine'
import { Segmented } from './fields'
import k from '../../styles/soft.module.css'
import s from './studio.module.css'

function AssetThumb({ studio, asset }: { studio: Studio; asset: AssetInfo }): ReactNode {
  const ref = useRef<HTMLCanvasElement>(null)
  const tick = studio.state.tick
  useEffect(() => {
    const px = studio.assets.peek(asset.id)
    const c = ref.current
    if (!px || !c) return
    const g = c.getContext('2d')!
    const k = Math.min(c.width / px.width, c.height / px.height)
    g.clearRect(0, 0, c.width, c.height)
    g.drawImage(px, (c.width - px.width * k) / 2, (c.height - px.height * k) / 2, px.width * k, px.height * k)
  }, [studio, asset.id, tick])
  return <canvas ref={ref} className={s.assetCanvas} width={160} height={90} />
}

const KIND_LABEL: Record<Layer['kind'], string> = { image: 'IMG', text: 'TXT', shape: 'SHP' }

function LayerRow({
  studio,
  variant,
  layer,
  index,
  dragging,
  setDragging
}: {
  studio: Studio
  variant: VariantState
  layer: Layer
  index: number
  dragging: number | null
  setDragging: (i: number | null) => void
}): ReactNode {
  const [renaming, setRenaming] = useState(false)
  const v = variant.id
  const selected = variant.selected === layer.id
  return (
    <div
      className={`${s.layerRow} ${selected ? s.layerOn : ''} ${layer.visible ? '' : s.layerHidden}`}
      draggable={!renaming}
      onDragStart={() => setDragging(index)}
      onDragEnd={() => setDragging(null)}
      onDragOver={(e) => e.preventDefault()}
      onDrop={() => {
        if (dragging !== null && dragging !== index) studio.arrange(v, variant.doc.layers[dragging].id, index)
        setDragging(null)
      }}
      onClick={() => studio.select(v, layer.id)}
    >
      <button
        className={s.layerIcon}
        title={layer.visible ? 'Hide' : 'Show'}
        onClick={(e) => {
          e.stopPropagation()
          studio.patch(v, layer.id, { visible: !layer.visible })
        }}
      >
        <IconEye size={13} />
      </button>
      <span className={s.layerKind}>{KIND_LABEL[layer.kind]}</span>
      {renaming ? (
        <input
          className={s.layerRename}
          autoFocus
          defaultValue={layer.name}
          onBlur={(e) => {
            studio.patch(v, layer.id, { name: e.target.value || layer.name })
            setRenaming(false)
          }}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        />
      ) : (
        <span className={s.layerName} onDoubleClick={() => setRenaming(true)}>
          {layer.name}
        </span>
      )}
      <button
        className={`${s.layerIcon} ${layer.locked ? s.layerLocked : ''}`}
        title={layer.locked ? 'Unlock' : 'Lock — clicks on the canvas pass through'}
        onClick={(e) => {
          e.stopPropagation()
          studio.patch(v, layer.id, { locked: !layer.locked })
        }}
      >
        <IconLock size={12} />
      </button>
    </div>
  )
}

export function LayersPanel({
  studio,
  variant,
  onGenerate
}: {
  studio: Studio
  variant: VariantState
  onGenerate: () => void
}): ReactNode {
  const { notify } = useStore()
  const [tab, setTab] = useState<'layers' | 'assets'>('layers')
  const [dragging, setDragging] = useState<number | null>(null)
  const v = variant.id
  const layers = variant.doc.layers
  const assets = studio.state.assets.filter((a) => a.source === 'upload' || a.source === 'generated')
  const selected = variant.selected

  const importFiles = async (): Promise<void> => {
    try {
      const paths = await window.raeydzone.studio.pickImages()
      if (paths.length) await studio.importPaths(paths)
    } catch (err) {
      notify((err as Error).message, 'bad')
    }
  }

  return (
    <div className={s.layersPanel}>
      <div className={s.panelTabs}>
        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            { id: 'layers', label: `Layers · ${layers.length}` },
            { id: 'assets', label: `Assets · ${assets.length}` }
          ]}
        />
      </div>

      {tab === 'layers' ? (
        <>
          <div className={s.layerList}>
            {layers.length === 0 && <p className={s.hint}>No layers yet.</p>}
            {[...layers].reverse().map((layer) => (
              <LayerRow
                key={layer.id}
                studio={studio}
                variant={variant}
                layer={layer}
                index={layers.indexOf(layer)}
                dragging={dragging}
                setDragging={setDragging}
              />
            ))}
          </div>
          <div className={s.panelFoot}>
            <button className={s.footBtn} title="Move up" disabled={!selected} onClick={() => selected && studio.arrange(v, selected, 'up')}>↑</button>
            <button className={s.footBtn} title="Move down" disabled={!selected} onClick={() => selected && studio.arrange(v, selected, 'down')}>↓</button>
            <button
              className={s.footBtn}
              title="Duplicate (Ctrl+D)"
              disabled={!selected}
              onClick={() => selected && studio.select(v, studio.duplicate(v, selected).id)}
            >
              <IconPlus size={14} />
            </button>
            <button className={s.footBtn} title="Delete (Del)" disabled={!selected} onClick={() => selected && studio.remove(v, selected)}>
              <IconTrash size={14} />
            </button>
          </div>
        </>
      ) : (
        <>
          <div className={s.assetGrid}>
            {assets.length === 0 && <p className={s.hint}>Attach or import images, or generate one.</p>}
            {assets.map((a) => (
              <button
                key={a.id}
                className={s.assetCell}
                title={`${a.label} · ${a.w}×${a.h} — click to place`}
                onClick={() => {
                  const layer = placeAsset(studio, v, a)
                  studio.select(v, layer.id)
                  setTab('layers')
                }}
              >
                <AssetThumb studio={studio} asset={a} />
                <span>{a.source === 'generated' ? '✦ ' : ''}{a.label}</span>
              </button>
            ))}
          </div>
          <div className={s.panelFoot}>
            <button className={`${k.btn} ${s.grow}`} onClick={() => void importFiles()}>
              <IconImage size={14} />
              Import
            </button>
            <button className={`${k.btn} ${s.grow}`} onClick={onGenerate}>
              Generate…
            </button>
          </div>
        </>
      )}
    </div>
  )
}
