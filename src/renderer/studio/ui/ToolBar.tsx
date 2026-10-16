import * as Tooltip from '@radix-ui/react-tooltip'
import type { ReactNode } from 'react'
import type { Layer } from '@shared/studio'
import { Toggle } from '../../components/Bits'
import {
  IconBrush, IconCursor, IconEllipse, IconLasso, IconPen, IconRect, IconScissors, IconSparkle, IconText
} from '../../components/Icons'
import { Segmented, SliderField } from './fields'
import type { Tool, ToolOptions } from './Stage'
import s from './studio.module.css'

const TOOLS: { id: Tool; icon: ReactNode; label: string; key: string }[] = [
  { id: 'move', icon: <IconCursor />, label: 'Select & move', key: 'V' },
  { id: 'text', icon: <IconText />, label: 'Text — click to place', key: 'T' },
  { id: 'rect', icon: <IconRect />, label: 'Rectangle', key: 'R' },
  { id: 'ellipse', icon: <IconEllipse />, label: 'Ellipse', key: 'E' },
  { id: 'pen', icon: <IconPen />, label: 'Shape from anchor points — manual glows', key: 'P' },
  { id: 'lasso', icon: <IconLasso />, label: 'Lasso mask — hide or reveal an area', key: 'L' },
  { id: 'brush', icon: <IconBrush />, label: 'Mask brush — paint edges away or back', key: 'B' },
  { id: 'cut', icon: <IconScissors />, label: 'Smart cut-out — box an object', key: 'C' },
  { id: 'fill', icon: <IconSparkle />, label: 'Generative fill — box an area', key: 'G' }
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
              <Tooltip.Content className={s.tooltip} side="right" sideOffset={8}>
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
  lasso: 'Click anchor points around the area on the selected image layer, then close the shape.',
  brush: 'Paint over the selected image layer.',
  cut: 'Drag a box around one object. The selected image layer (or the top image) is cut down to it.',
  fill: 'Drag a box over the area to repaint, then describe what should appear.'
}

export function ToolOptionsBar({
  tool,
  options,
  setOptions,
  selected
}: {
  tool: Tool
  options: ToolOptions
  setOptions: (o: ToolOptions) => void
  selected: Layer | null
}): ReactNode {
  const masking = tool === 'lasso' || tool === 'brush'
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
        {masking && selected?.kind !== 'image' ? 'Select an image layer first.' : HINTS[tool] ?? 'Click to select, drag to move. Handles resize and rotate; Shift keeps proportions free.'}
      </span>
    </div>
  )
}
