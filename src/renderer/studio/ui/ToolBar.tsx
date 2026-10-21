import * as Tooltip from '@radix-ui/react-tooltip'
import { useState } from 'react'
import type { ReactNode } from 'react'
import type { Layer } from '@shared/studio'
import { Toggle } from '../../components/Bits'
import {
  IconBrush, IconCursor, IconDistort, IconEllipse, IconLasso, IconMarquee, IconPaint, IconPen, IconRect,
  IconScissors, IconSparkle, IconText
} from '../../components/Icons'
import { useStore } from '../../state/store'
import type { Studio } from '../engine'
import { newPaintLayer } from '../paint'
import { fillSelection, layerFromSelection, maskWithSelection, refine } from '../selection'
import type { Refine } from '../selection'
import { Segmented, SliderField, Swatch } from './fields'
import type { Tool, ToolOptions } from './Stage'
import k from '../../styles/soft.module.css'
import s from './studio.module.css'

const TOOLS: { id: Tool; icon: ReactNode; label: string; key: string }[] = [
  { id: 'move', icon: <IconCursor />, label: 'Select & move', key: 'V' },
  { id: 'text', icon: <IconText />, label: 'Text — click to place', key: 'T' },
  { id: 'rect', icon: <IconRect />, label: 'Rectangle', key: 'R' },
  { id: 'ellipse', icon: <IconEllipse />, label: 'Ellipse', key: 'E' },
  { id: 'pen', icon: <IconPen />, label: 'Shape from anchor points — manual glows', key: 'P' },
  { id: 'lasso', icon: <IconLasso />, label: 'Lasso mask — hide or reveal an area of any layer', key: 'L' },
  { id: 'brush', icon: <IconBrush />, label: 'Mask brush — paint any layer away or back', key: 'B' },
  { id: 'cut', icon: <IconScissors />, label: 'Smart cut-out — box an object', key: 'C' },
  { id: 'fill', icon: <IconSparkle />, label: 'Generative fill — box an area', key: 'G' },
  { id: 'select', icon: <IconMarquee />, label: 'Select — marquee, lasso, magic wand, colour range', key: 'M' },
  { id: 'paint', icon: <IconPaint />, label: 'Paint — brush, eraser, clone, heal', key: 'N' },
  { id: 'distort', icon: <IconDistort />, label: 'Distort — drag the corners of a layer', key: 'D' }
]

export function ToolBar({ tool, setTool, disabled }: { tool: Tool; setTool: (t: Tool) => void; disabled: boolean }): ReactNode {
  return (
    <Tooltip.Provider delayDuration={250}>
      <div className={s.toolbar}>
        {TOOLS.map((t) => (
          <Tooltip.Root key={t.id}>
            <Tooltip.Trigger asChild>
              <button
                className={`${s.toolBtn} ${tool === t.id ? s.toolOn : ''}`}
                disabled={disabled}
                onClick={() => setTool(t.id)}
                aria-label={t.label}
              >
                {t.icon}
              </button>
            </Tooltip.Trigger>
            <Tooltip.Portal>
              <Tooltip.Content className={s.tooltip} side="right" sideOffset={8} collisionPadding={8}>
                {t.label} <span className={s.tooltipKey}>{t.key}</span>
              </Tooltip.Content>
            </Tooltip.Portal>
          </Tooltip.Root>
        ))}
      </div>
    </Tooltip.Provider>
  )
}

const HINTS: Partial<Record<Tool, string>> = {
  text: 'Click on the canvas to place text.',
  rect: 'Drag to draw a rectangle.',
  ellipse: 'Drag to draw an ellipse.',
  pen: 'Click to set anchor points. Click the first point, double-click or press Enter to close. Backspace removes the last point.',
  lasso: 'Click anchor points around the area on the selected layer, then close the shape.',
  brush: 'Paint over the selected layer.',
  cut: 'Drag a box around one object. The selected image layer (or the top image) is cut down to it.',
  fill: 'Drag a box over the area to repaint, then describe what should appear.',
  distort: 'Drag a corner to skew, add perspective or distort freely. Click a layer to switch to it.'
}

const SELECT_HINT: Record<ToolOptions['selectShape'], string> = {
  rect: 'Drag a box.',
  ellipse: 'Drag an ellipse.',
  lasso: 'Click points around the area, then close the shape.',
  wand: 'Click a colour — touching pixels like it are selected.',
  color: 'Click a colour — every pixel like it is selected.'
}

const REFINES: { op: Refine; label: string; title: string }[] = [
  { op: 'feather', label: 'Feather', title: 'Soften the edge' },
  { op: 'grow', label: 'Grow', title: 'Push the edge outwards' },
  { op: 'shrink', label: 'Shrink', title: 'Pull the edge inwards' },
  { op: 'smooth', label: 'Smooth', title: 'Round off jagged corners' },
  { op: 'invert', label: 'Invert', title: 'Select everything else' }
]

function SelectOptions({
  options,
  setOptions,
  selected,
  studio,
  variantId
}: {
  options: ToolOptions
  setOptions: (o: ToolOptions) => void
  selected: Layer | null
  studio: Studio
  variantId: string
}): ReactNode {
  const { notify } = useStore()
  const [amount, setAmount] = useState(8)
  const [color, setColor] = useState('#ff2a2a')
  const [busy, setBusy] = useState(false)
  const sel = studio.selectionOf(variantId)
  const run = async (fn: () => Promise<unknown>): Promise<void> => {
    setBusy(true)
    try {
      await fn()
    } catch (err) {
      notify((err as Error).message, 'bad')
    } finally {
      setBusy(false)
    }
  }
  return (
    <>
      <Segmented
        value={options.selectShape}
        onChange={(selectShape) => setOptions({ ...options, selectShape })}
        options={[
          { id: 'rect', label: 'Box' },
          { id: 'ellipse', label: 'Ellipse' },
          { id: 'lasso', label: 'Lasso' },
          { id: 'wand', label: 'Wand', title: 'Magic wand' },
          { id: 'color', label: 'Colour', title: 'Colour range' }
        ]}
      />
      {(options.selectShape === 'wand' || options.selectShape === 'color') && (
        <div className={s.optionSlider}>
          <SliderField label="Tolerance" value={options.tolerance} min={0} max={160} onChange={(tolerance) => setOptions({ ...options, tolerance })} />
        </div>
      )}
      {sel ? (
        <>
          <div className={s.optionSlider}>
            <SliderField label="Amount" value={amount} min={1} max={60} unit="px" onChange={setAmount} />
          </div>
          {REFINES.map((r) => (
            <button
              key={r.op}
              className={k.chip}
              title={r.title}
              disabled={busy}
              onClick={() => studio.setSelection(variantId, refine(sel, r.op, amount))}
            >
              {r.label}
            </button>
          ))}
          <span className={s.optionGap} />
          <button
            className={k.chip}
            disabled={busy || !selected}
            title="Keep only what is inside the selection on the selected layer"
            onClick={() => selected && void run(() => maskWithSelection(studio, variantId, selected, sel, 'inside'))}
          >
            Keep inside
          </button>
          <button
            className={k.chip}
            disabled={busy || !selected}
            title="Hide the selected area on the selected layer"
            onClick={() => selected && void run(() => maskWithSelection(studio, variantId, selected, sel, 'outside'))}
          >
            Hide inside
          </button>
          <button
            className={k.chip}
            disabled={busy}
            title="Copy what is selected into its own layer"
            onClick={() => void run(() => layerFromSelection(studio, variantId, sel, selected))}
          >
            New layer
          </button>
          <Swatch value={color} onChange={setColor} title="Fill colour" />
          <button className={k.chip} disabled={busy} onClick={() => void run(() => fillSelection(studio, variantId, sel, color))}>
            Fill
          </button>
          <button className={k.chip} onClick={() => studio.setSelection(variantId, null)}>
            Deselect
          </button>
        </>
      ) : (
        <span className={s.optionHint}>{SELECT_HINT[options.selectShape]} Shift adds, Alt subtracts, both intersect.</span>
      )}
    </>
  )
}

function PaintOptions({
  options,
  setOptions,
  selected,
  studio,
  variantId
}: {
  options: ToolOptions
  setOptions: (o: ToolOptions) => void
  selected: Layer | null
  studio: Studio
  variantId: string
}): ReactNode {
  const { notify } = useStore()
  const cloning = options.paintMode === 'clone' || options.paintMode === 'heal'
  const hint = selected?.kind !== 'image'
    ? 'Select an image or paint layer, or add a paint layer.'
    : cloning
      ? options.cloneSource ? 'Paint to copy from the marked spot.' : 'Alt-click where to copy from.'
      : studio.selectionOf(variantId) ? 'Strokes stay inside the selection.' : 'Paint on the selected layer.'
  return (
    <>
      <Segmented
        value={options.paintMode}
        onChange={(paintMode) => setOptions({ ...options, paintMode })}
        options={[
          { id: 'brush', label: 'Brush' },
          { id: 'erase', label: 'Eraser' },
          { id: 'clone', label: 'Clone', title: 'Copy pixels from another spot' },
          { id: 'heal', label: 'Heal', title: 'Clone, matched to the colour where it lands' }
        ]}
      />
      {options.paintMode === 'brush' && (
        <Swatch value={options.paintColor} onChange={(paintColor) => setOptions({ ...options, paintColor })} title="Brush colour" />
      )}
      <div className={s.optionSlider}>
        <SliderField label="Size" value={options.paintSize} min={1} max={200} unit="px" onChange={(paintSize) => setOptions({ ...options, paintSize })} />
      </div>
      <div className={s.optionSlider}>
        <SliderField label="Hardness" value={Math.round(options.hardness * 100)} min={0} max={100} unit="%" onChange={(v) => setOptions({ ...options, hardness: v / 100 })} />
      </div>
      <div className={s.optionSlider}>
        <SliderField label="Opacity" value={Math.round(options.paintOpacity * 100)} min={1} max={100} unit="%" onChange={(v) => setOptions({ ...options, paintOpacity: v / 100 })} />
      </div>
      <button
        className={k.chip}
        onClick={() => void newPaintLayer(studio, variantId).catch((err: Error) => notify(err.message, 'bad'))}
      >
        New paint layer
      </button>
      <span className={s.optionHint}>{hint}</span>
    </>
  )
}

export function ToolOptionsBar({
  tool,
  options,
  setOptions,
  selected,
  studio,
  variantId,
  setTool
}: {
  tool: Tool
  options: ToolOptions
  setOptions: (o: ToolOptions) => void
  selected: Layer | null
  studio: Studio
  variantId: string
  setTool: (t: Tool) => void
}): ReactNode {
  const masking = tool === 'lasso' || tool === 'brush'
  const selecting = tool === 'move' && !!studio.selectionOf(variantId)
  if (tool === 'select' || selecting) {
    return (
      <div className={s.optionsBar}>
        {tool !== 'select' && (
          <button className={k.chip} onClick={() => setTool('select')}>
            Selection
          </button>
        )}
        <SelectOptions options={options} setOptions={setOptions} selected={selected} studio={studio} variantId={variantId} />
      </div>
    )
  }
  if (tool === 'paint') {
    return (
      <div className={s.optionsBar}>
        <PaintOptions options={options} setOptions={setOptions} selected={selected} studio={studio} variantId={variantId} />
      </div>
    )
  }
  return (
    <div className={s.optionsBar}>
      {masking && (
        <Segmented
          value={options.maskShow ? 'show' : 'hide'}
          onChange={(m) => setOptions({ ...options, maskShow: m === 'show' })}
          options={[
            { id: 'hide', label: 'Hide', title: 'Cut away' },
            { id: 'show', label: 'Reveal', title: 'Bring back' }
          ]}
        />
      )}
      {tool === 'brush' && (
        <div className={s.optionSlider}>
          <SliderField label="Size" value={options.brush} min={2} max={160} unit="px" onChange={(brush) => setOptions({ ...options, brush })} />
        </div>
      )}
      {tool === 'pen' && (
        <Toggle checked={options.glowPen} onChange={(glowPen) => setOptions({ ...options, glowPen })} label="Soft glow shape" />
      )}
      <span className={s.optionHint}>
        {masking && !selected ? 'Select a layer first.' : HINTS[tool] ?? 'Click to select, drag to move. Handles resize and rotate; Shift keeps proportions free.'}
      </span>
    </div>
  )
}
