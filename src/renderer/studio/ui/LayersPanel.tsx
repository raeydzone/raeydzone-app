import { useEffect, useRef, useState } from 'react'
import type { MouseEvent, ReactNode } from 'react'
import type { AssetInfo, Layer, StudioDoc } from '@shared/studio'
import {
  IconArrowDown, IconArrowUp, IconCopy, IconEye, IconEyeOff, IconImage, IconLock, IconTrash
} from '../../components/Icons'
import { useStore } from '../../state/store'
import { placeAsset } from '../ai'
import type { Studio, VariantState } from '../engine'
import { drawDoc } from '../render'
import { LayerMenu } from './LayerMenu'
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

const KIND_LABEL: Record<Layer['kind'], string> = { image: 'Image', text: 'Text', shape: 'Shape' }

function LayerThumb({ studio, doc, layer }: { studio: Studio; doc: StudioDoc; layer: Layer }): ReactNode {
  const ref = useRef<HTMLCanvasElement>(null)
  const tick = studio.state.tick
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      const c = ref.current
      if (!c) return
      const g = c.getContext('2d')!
      g.setTransform(c.width / doc.width, 0, 0, c.height / doc.height, 0, 0)
      drawDoc(g, doc, studio.assets, layer.id)
    })
    return () => cancelAnimationFrame(id)
  }, [studio, doc, layer, tick])
  return <canvas ref={ref} className={s.layerThumb} width={80} height={45} />
}

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
  const selected = variant.picked.includes(layer.id) || variant.selected === layer.id
  const click = (e: MouseEvent): void => {
    if (e.ctrlKey || e.metaKey) return studio.toggle(v, layer.id)
    const layers = variant.doc.layers
    const anchor = layers.findIndex((l) => l.id === variant.selected)
    if (!e.shiftKey || anchor < 0) return studio.select(v, layer.id)
    const [a, b] = [anchor, index].sort((x, y) => x - y)
    studio.pick(v, layers.slice(a, b + 1).map((l) => l.id), variant.selected)
  }
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
      onClick={click}
      onContextMenu={() => !selected && studio.select(v, layer.id)}
    >
      <LayerThumb studio={studio} doc={variant.doc} layer={layer} />
      <div className={s.layerLabel}>
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
          <span className={s.layerName} onDoubleClick={() => setRenaming(true)} title="Double-click to rename">
            {layer.name}
          </span>
        )}
        <span className={s.layerKind}>{KIND_LABEL[layer.kind]}</span>
      </div>
      <button
        className={`${s.layerIcon} ${layer.locked ? s.layerIconOn : ''}`}
        title={layer.locked ? 'Unlock' : 'Lock — clicks on the canvas pass through'}
        onClick={(e) => {
          e.stopPropagation()
          studio.patch(v, layer.id, { locked: !layer.locked })
        }}
      >
        <IconLock size={12} />
      </button>
      <button
        className={`${s.layerIcon} ${layer.visible ? '' : s.layerIconOn}`}
        title={layer.visible ? 'Hide' : 'Show'}
        onClick={(e) => {
          e.stopPropagation()
          studio.patch(v, layer.id, { visible: !layer.visible })
        }}
      >
        {layer.visible ? <IconEye size={13} /> : <IconEyeOff size={13} />}
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
  const ids = studio.selection(v)

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
          <LayerMenu studio={studio} variant={variant}>
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
          </LayerMenu>
          <div className={s.panelFoot}>
            <button className={s.footBtn} title="Move up" disabled={!selected} onClick={() => selected && studio.arrange(v, selected, 'up')}>
              <IconArrowUp size={13} />
            </button>
            <button className={s.footBtn} title="Move down" disabled={!selected} onClick={() => selected && studio.arrange(v, selected, 'down')}>
              <IconArrowDown size={13} />
            </button>
            <button
              className={s.footBtn}
              title="Duplicate (Ctrl+D)"
              disabled={!ids.length}
              onClick={() => studio.duplicateMany(v, ids)}
            >
              <IconCopy size={13} />
            </button>
            <button className={s.footBtn} title="Delete (Del)" disabled={!ids.length} onClick={() => studio.removeMany(v, ids)}>
              <IconTrash size={13} />
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
