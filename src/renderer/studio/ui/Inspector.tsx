import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { BLEND_MODES, FONTS } from '@shared/studio'
import type { Layer, ShapeLayer, TextLayer } from '@shared/studio'
import { Toggle } from '../../components/Bits'
import { useStore } from '../../state/store'
import { cutOut, editMask } from '../ai'
import { NEUTRAL } from '../doc'
import type { Studio } from '../engine'
import { ColorField, NumField, Section, Segmented, SliderField } from './fields'
import type { Tool } from './Stage'
import s from './studio.module.css'

type Patch = (patch: Record<string, unknown>, key?: string) => void

const WEIGHTED = new Set(['Montserrat', 'Oswald', 'Segoe UI'])

function Effect<K extends 'shadow' | 'glow' | 'stroke' | 'tint'>({
  layer,
  name,
  title,
  patch,
  children
}: {
  layer: Layer
  name: K
  title: string
  patch: Patch
  children: (value: NonNullable<Layer[K]>) => ReactNode
}): ReactNode {
  const value = layer[name]
  return (
    <div className={s.effect}>
      <Toggle checked={!!value} onChange={(on) => patch({ [name]: on ? {} : null })} label={title} />
      {value && <div className={s.effectBody}>{children(value as NonNullable<Layer[K]>)}</div>}
    </div>
  )
}

function TextSection({ layer, patch, focus }: { layer: TextLayer; patch: Patch; focus: boolean }): ReactNode {
  const ref = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    if (focus && ref.current) {
      ref.current.focus()
      ref.current.select()
    }
  }, [focus])
  return (
    <Section title="Text">
      <textarea
        ref={ref}
        className={`${s.field} ${s.textArea}`}
        value={layer.text}
        rows={2}
        onChange={(e) => patch({ text: e.target.value }, 'text')}
      />
      <p className={s.hint}>Wrap words in *stars* to paint them in the highlight colour.</p>
      <div className={s.grid2}>
        <select className={s.field} value={layer.font} onChange={(e) => patch({ font: e.target.value })}>
          {FONTS.map((f) => (
            <option key={f} value={f}>{f}</option>
          ))}
        </select>
        {WEIGHTED.has(layer.font) ? (
          <select className={s.field} value={layer.weight} onChange={(e) => patch({ weight: Number(e.target.value) })}>
            {[400, 500, 600, 700, 800, 900].map((w) => (
              <option key={w} value={w}>{w}</option>
            ))}
          </select>
        ) : (
          <span />
        )}
      </div>
      <div className={s.grid2}>
        <NumField label="Size" value={layer.size} onChange={(v) => patch({ size: v }, 'size')} />
        <Segmented
          value={layer.align}
          onChange={(align) => patch({ align })}
          options={[
            { id: 'left', label: 'L', title: 'Align left' },
            { id: 'center', label: 'C', title: 'Centre' },
            { id: 'right', label: 'R', title: 'Align right' }
          ]}
        />
      </div>
      <div className={s.grid2}>
        <ColorField label="Fill" value={layer.fill} onChange={(fill) => patch({ fill }, 'fill')} />
        <ColorField label="Highlight" value={layer.highlight} onChange={(highlight) => patch({ highlight }, 'highlight')} />
      </div>
      <div className={s.rowGap}>
        <Toggle checked={layer.uppercase} onChange={(uppercase) => patch({ uppercase })} label="Caps" />
        <Toggle checked={layer.italic} onChange={(italic) => patch({ italic })} label="Italic" />
      </div>
      <SliderField label="Letter spacing" value={layer.letterSpacing} min={-20} max={60} unit="px" onChange={(v) => patch({ letterSpacing: v }, 'ls')} />
      <SliderField label="Line height" value={layer.lineHeight} min={0.6} max={2} step={0.01} onChange={(v) => patch({ lineHeight: v }, 'lh')} />
    </Section>
  )
}

function ShapeSection({ layer, patch }: { layer: ShapeLayer; patch: Patch }): ReactNode {
  const g = layer.gradient
  return (
    <Section title="Shape">
      <Segmented
        value={layer.shape}
        onChange={(shape) => patch({ shape })}
        options={[
          { id: 'rect', label: 'Rectangle' },
          { id: 'ellipse', label: 'Ellipse' },
          ...(layer.points.length >= 3 ? [{ id: 'polygon' as const, label: 'Polygon' }] : [])
        ]}
      />
      {g ? (
        <>
          <div className={s.grid2}>
            <ColorField label="From" alpha value={g.from} onChange={(from) => patch({ gradient: { from } }, 'gfrom')} />
            <ColorField label="To" alpha value={g.to} onChange={(to) => patch({ gradient: { to } }, 'gto')} />
          </div>
          <Segmented
            value={g.type}
            onChange={(type) => patch({ gradient: { type } })}
            options={[{ id: 'radial', label: 'Radial' }, { id: 'linear', label: 'Linear' }]}
          />
          {g.type === 'linear' && (
            <SliderField label="Angle" value={g.angle} min={0} max={360} unit="°" onChange={(angle) => patch({ gradient: { angle } }, 'gangle')} />
          )}
        </>
      ) : (
        <ColorField label="Fill" alpha value={layer.fill} onChange={(fill) => patch({ fill }, 'fill')} />
      )}
      <Toggle checked={!!g} onChange={(on) => patch({ gradient: on ? {} : null })} label="Gradient" />
      {layer.shape === 'rect' && (
        <SliderField label="Corner radius" value={layer.radius} min={0} max={200} unit="px" onChange={(radius) => patch({ radius }, 'radius')} />
      )}
      <SliderField label="Feather" value={layer.feather} min={0} max={200} unit="px" onChange={(feather) => patch({ feather }, 'feather')} />
    </Section>
  )
}

function ImageSection({
  studio,
  variantId,
  layer,
  setTool
}: {
  studio: Studio
  variantId: string
  layer: Extract<Layer, { kind: 'image' }>
  setTool: (t: Tool) => void
}): ReactNode {
  const { notify } = useStore()
  const [subject, setSubject] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [feather, setFeather] = useState(4)

  const run = async (label: string, fn: () => Promise<unknown>): Promise<void> => {
    setBusy(label)
    try {
      await fn()
    } catch (err) {
      notify((err as Error).message, 'bad')
    } finally {
      setBusy(null)
    }
  }

  return (
    <Section title="Cut-out & mask" aside={layer.mask ? <span className={s.tag}>masked</span> : null}>
      <input
        className={s.field}
        placeholder="What to keep (optional) — e.g. the man"
        value={subject}
        onChange={(e) => setSubject(e.target.value)}
      />
      <div className={s.rowGap}>
        <button
          className={`${s.btn} ${s.btnPrimary} ${s.grow}`}
          disabled={!!busy}
          onClick={() => void run('cut', () => cutOut(studio, variantId, layer.id, subject || undefined))}
        >
          {busy === 'cut' ? 'Cutting out…' : 'Smart cut-out'}
        </button>
        <button className={s.btn} title="Drag a box around one object to cut it out" onClick={() => setTool('cut')}>
          In box
        </button>
      </div>
      <div className={s.rowGap}>
        <button className={`${s.btn} ${s.grow}`} onClick={() => setTool('brush')}>Brush</button>
        <button className={`${s.btn} ${s.grow}`} onClick={() => setTool('lasso')}>Lasso</button>
        <button
          className={`${s.btn} ${s.grow}`}
          disabled={!!busy}
          onClick={() => void run('invert', () => editMask(studio, variantId, layer.id, 'invert'))}
        >
          Invert
        </button>
      </div>
      <SliderField label="Feather amount" value={feather} min={1} max={40} unit="px" onChange={setFeather} />
      <div className={s.rowGap}>
        <button
          className={`${s.btn} ${s.grow}`}
          disabled={!!busy || !layer.mask}
          onClick={() => void run('feather', () => editMask(studio, variantId, layer.id, 'feather', [], feather))}
        >
          Feather edges
        </button>
        <button
          className={`${s.btn} ${s.btnGhost}`}
          disabled={!!busy || !layer.mask}
          onClick={() => void run('reset', () => editMask(studio, variantId, layer.id, 'reset'))}
        >
          Reset mask
        </button>
      </div>
    </Section>
  )
}

export function Inspector({
  studio,
  variantId,
  layer,
  background,
  focusText,
  setTool
}: {
  studio: Studio
  variantId: string
  layer: Layer | null
  background: string
  focusText: boolean
  setTool: (t: Tool) => void
}): ReactNode {
  if (!layer) {
    return (
      <div className={s.inspector}>
        <Section title="Canvas">
          <ColorField label="Background" value={background} onChange={(c) => studio.setBackground(variantId, c, 'bg')} />
          <p className={s.hint}>
            Click a layer to edit it. Drop images onto the canvas to place them. Ctrl+Z undoes, Delete removes,
            arrows nudge, Ctrl+D duplicates.
          </p>
        </Section>
      </div>
    )
  }

  const patch: Patch = (p, key) => studio.patch(variantId, layer.id, p, key)
  const a = layer.adjust

  return (
    <div className={s.inspector}>
      <Section title="Layer" aside={<span className={s.tag}>{layer.kind}</span>}>
        <input className={s.field} value={layer.name} onChange={(e) => patch({ name: e.target.value }, 'name')} />
        <div className={s.grid2}>
          <NumField label="X" value={layer.x} onChange={(x) => patch({ x }, 'x')} />
          <NumField label="Y" value={layer.y} onChange={(y) => patch({ y }, 'y')} />
        </div>
        <div className={s.grid2}>
          <NumField label="W" value={layer.width} onChange={(width) => patch(layer.kind === 'text' ? { size: (layer.size * width) / layer.width } : { width }, 'w')} />
          <NumField label="H" value={layer.height} onChange={(height) => patch(layer.kind === 'text' ? { size: (layer.size * height) / layer.height } : { height }, 'h')} />
        </div>
        <div className={s.grid2}>
          <NumField label="Rotate" value={layer.rotation} onChange={(rotation) => patch({ rotation }, 'rot')} />
          <div className={s.rowGap}>
            <button className={`${s.btn} ${s.grow} ${layer.flipX ? s.btnOn : ''}`} onClick={() => patch({ flipX: !layer.flipX })}>Flip H</button>
            <button className={`${s.btn} ${s.grow} ${layer.flipY ? s.btnOn : ''}`} onClick={() => patch({ flipY: !layer.flipY })}>Flip V</button>
          </div>
        </div>
        <SliderField label="Opacity" value={Math.round(layer.opacity * 100)} min={0} max={100} unit="%" onChange={(v) => patch({ opacity: v / 100 }, 'opacity')} />
        <select className={s.field} value={layer.blend} onChange={(e) => patch({ blend: e.target.value })}>
          {BLEND_MODES.map((b) => (
            <option key={b} value={b}>Blend · {b}</option>
          ))}
        </select>
      </Section>

      {layer.kind === 'text' && <TextSection layer={layer} patch={patch} focus={focusText} />}
      {layer.kind === 'shape' && <ShapeSection layer={layer} patch={patch} />}
      {layer.kind === 'image' && <ImageSection studio={studio} variantId={variantId} layer={layer} setTool={setTool} />}

      <Section title="Effects">
        <Effect layer={layer} name="stroke" title="Outline" patch={patch}>
          {(e) => (
            <>
              <ColorField label="Colour" value={e.color} onChange={(color) => patch({ stroke: { color } }, 'sc')} />
              <SliderField label="Width" value={e.width} min={1} max={40} unit="px" onChange={(width) => patch({ stroke: { width } }, 'sw')} />
            </>
          )}
        </Effect>
        <Effect layer={layer} name="shadow" title="Drop shadow" patch={patch}>
          {(e) => (
            <>
              <ColorField label="Colour" value={e.color} onChange={(color) => patch({ shadow: { color } }, 'shc')} />
              <SliderField label="Opacity" value={Math.round(e.opacity * 100)} min={0} max={100} unit="%" onChange={(v) => patch({ shadow: { opacity: v / 100 } }, 'sho')} />
              <SliderField label="Blur" value={e.blur} min={0} max={120} unit="px" onChange={(blur) => patch({ shadow: { blur } }, 'shb')} />
              <div className={s.grid2}>
                <NumField label="X" value={e.x} onChange={(x) => patch({ shadow: { x } }, 'shx')} />
                <NumField label="Y" value={e.y} onChange={(y) => patch({ shadow: { y } }, 'shy')} />
              </div>
            </>
          )}
        </Effect>
        <Effect layer={layer} name="glow" title="Outer glow" patch={patch}>
          {(e) => (
            <>
              <ColorField label="Colour" value={e.color} onChange={(color) => patch({ glow: { color } }, 'gc')} />
              <SliderField label="Size" value={e.size} min={4} max={160} unit="px" onChange={(size) => patch({ glow: { size } }, 'gs')} />
              <SliderField label="Opacity" value={Math.round(e.opacity * 100)} min={0} max={100} unit="%" onChange={(v) => patch({ glow: { opacity: v / 100 } }, 'go')} />
            </>
          )}
        </Effect>
        <Effect layer={layer} name="tint" title="Colour tint" patch={patch}>
          {(e) => (
            <>
              <ColorField label="Colour" value={e.color} onChange={(color) => patch({ tint: { color } }, 'tc')} />
              <SliderField label="Amount" value={Math.round(e.amount * 100)} min={0} max={100} unit="%" onChange={(v) => patch({ tint: { amount: v / 100 } }, 'ta')} />
            </>
          )}
        </Effect>
      </Section>

      <Section
        title="Adjust"
        aside={
          <button className={s.linkBtn} onClick={() => patch({ adjust: NEUTRAL })}>
            Reset
          </button>
        }
      >
        <SliderField label="Brightness" value={a.brightness} min={0} max={200} unit="%" onChange={(v) => patch({ adjust: { brightness: v } }, 'ab')} />
        <SliderField label="Contrast" value={a.contrast} min={0} max={200} unit="%" onChange={(v) => patch({ adjust: { contrast: v } }, 'ac')} />
        <SliderField label="Saturation" value={a.saturation} min={0} max={300} unit="%" onChange={(v) => patch({ adjust: { saturation: v } }, 'as')} />
        <SliderField label="Hue" value={a.hue} min={-180} max={180} unit="°" onChange={(v) => patch({ adjust: { hue: v } }, 'ah')} />
        <SliderField label="Blur" value={a.blur} min={0} max={40} unit="px" onChange={(v) => patch({ adjust: { blur: v } }, 'abl')} />
      </Section>
    </div>
  )
}
