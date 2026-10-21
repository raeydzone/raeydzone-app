import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { BLEND_MODES } from '@shared/studio'
import type { Glow, Gradient, Layer, Outline, Shadow, ShapeLayer, TextLayer } from '@shared/studio'
import { Toggle } from '../../components/Bits'
import { useStore } from '../../state/store'
import { cutOut, editMask } from '../ai'
import { MenuSelect } from '../../components/MenuSelect'
import { NEUTRAL, effectDefault } from '../doc'
import { WEIGHT_NAMES, findFont, nearestWeight } from '../fonts'
import type { Studio } from '../engine'
import { ColorField, NumField, Section, Segmented, SliderField } from './fields'
import { FontPicker } from './FontPicker'
import type { Tool } from './Stage'
import k from '../../styles/soft.module.css'
import s from './studio.module.css'

type Patch = (patch: Record<string, unknown>, key?: string) => void

const TEXT_GRADIENT = { type: 'linear', from: '#ff6a5a', to: '#a30000', angle: 90 }

const blendName = (mode: string): string => mode.charAt(0).toUpperCase() + mode.slice(1).replace('-', ' ')

function Tint({ layer, patch }: { layer: Layer; patch: Patch }): ReactNode {
  const tint = layer.tint
  return (
    <div className={s.effect}>
      <Toggle checked={!!tint} onChange={(on) => patch({ tint: on ? {} : null })} label="Colour tint" />
      {tint && (
        <div className={s.effectBody}>
          <ColorField label="Colour" value={tint.color} onChange={(color) => patch({ tint: { color } }, 'tc')} />
          <SliderField label="Amount" value={Math.round(tint.amount * 100)} min={0} max={100} unit="%" onChange={(v) => patch({ tint: { amount: v / 100 } }, 'ta')} />
        </div>
      )}
    </div>
  )
}

type Stacks = { shadows: Shadow; glows: Glow; strokes: Outline }
const SINGULAR = { shadows: 'shadow', glows: 'glow', strokes: 'stroke' } as const

// Each entry is edited in place and the whole list written back, so a slider drag on the
// second outline coalesces into one undo step like any other field.
function EffectStack<K extends keyof Stacks>({
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
  children: (value: Stacks[K], set: (p: Partial<Stacks[K]>, key?: string) => void) => ReactNode
}): ReactNode {
  const list = layer[name] as Stacks[K][]
  const write = (next: Stacks[K][], key?: string): void => patch({ [name]: next }, key)
  const fresh = (): Stacks[K] => effectDefault(SINGULAR[name]) as Stacks[K]
  return (
    <div className={s.effect}>
      <Toggle checked={list.length > 0} onChange={(on) => write(on ? [fresh()] : [])} label={title} />
      {list.map((entry, i) => (
        <div key={i} className={s.effectBody}>
          {list.length > 1 && (
            <div className={s.effectHead}>
              <span>
                {title} {i + 1}
              </span>
              <button
                className={s.effectDrop}
                title={'Remove this ' + title.toLowerCase()}
                onClick={() => write(list.filter((_, j) => j !== i))}
              >
                Remove
              </button>
            </div>
          )}
          {children(entry, (p, key) =>
            write(list.map((e, j) => (j === i ? { ...e, ...p } : e)), key ? key + i : undefined)
          )}
        </div>
      ))}
      {list.length > 0 && list.length < 8 && (
        <button className={s.linkBtn} onClick={() => write([...list, fresh()])}>
          + Add another {title.toLowerCase()}
        </button>
      )}
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
  const weights = findFont(layer.font)?.weights ?? [layer.weight]
  return (
    <Section title="Text">
      <textarea
        ref={ref}
        className={`${k.field} ${s.textArea}`}
        value={layer.text}
        rows={2}
        onChange={(e) => patch({ text: e.target.value }, 'text')}
      />
      <p className={s.hint}>Wrap words in *stars* to paint them in the highlight colour.</p>
      <FontPicker value={layer.font} onChange={(font) => patch({ font })} />
      <div className={s.grid2}>
        {weights.length > 1 ? (
          <MenuSelect
            wide
            align="start"
            trigger={<span className={s.pillGrow}>{WEIGHT_NAMES[nearestWeight(layer.font, layer.weight)] ?? layer.weight}</span>}
            groups={[{
              title: 'Weight',
              value: String(nearestWeight(layer.font, layer.weight)),
              options: weights.map((w) => ({ id: String(w), label: `${WEIGHT_NAMES[w] ?? w} · ${w}` })),
              onChange: (w) => patch({ weight: Number(w) })
            }]}
          />
        ) : (
          <span className={s.hint}>One weight only</span>
        )}
        <NumField label="Size" value={layer.size} onChange={(v) => patch({ size: v }, 'size')} />
      </div>
      <Segmented
        value={layer.align}
        onChange={(align) => patch({ align })}
        options={[
          { id: 'left', label: 'Left', title: 'Align left' },
          { id: 'center', label: 'Centre', title: 'Centre' },
          { id: 'right', label: 'Right', title: 'Align right' }
        ]}
      />
      <GradientFields
        value={layer.gradient ?? null}
        patch={patch}
        onDefault={TEXT_GRADIENT}
        fallback={<ColorField label="Fill" value={layer.fill} onChange={(fill) => patch({ fill }, 'fill')} />}
      />
      <ColorField label="Highlight" value={layer.highlight} onChange={(highlight) => patch({ highlight }, 'highlight')} />
      <div className={s.rowGap}>
        <Toggle checked={layer.uppercase} onChange={(uppercase) => patch({ uppercase })} label="Caps" />
        <Toggle checked={layer.italic} onChange={(italic) => patch({ italic })} label="Italic" />
      </div>
      <SliderField label="Letter spacing" value={layer.letterSpacing} min={-20} max={60} unit="px" onChange={(v) => patch({ letterSpacing: v }, 'ls')} />
      <SliderField label="Line height" value={layer.lineHeight} min={0.6} max={2} step={0.01} onChange={(v) => patch({ lineHeight: v }, 'lh')} />
    </Section>
  )
}

// Text keeps its solid fill underneath, so switching the gradient off restores it.
function GradientFields({ value, fallback, patch, onDefault }: {
  value: Gradient | null
  fallback: ReactNode
  patch: Patch
  onDefault: Record<string, unknown>
}): ReactNode {
  return (
    <>
      {value ? (
        <>
          <div className={s.grid2}>
            <ColorField label="From" alpha value={value.from} onChange={(from) => patch({ gradient: { from } }, 'gfrom')} />
            <ColorField label="To" alpha value={value.to} onChange={(to) => patch({ gradient: { to } }, 'gto')} />
          </div>
          <Segmented
            value={value.type}
            onChange={(type) => patch({ gradient: { type } })}
            options={[{ id: 'radial', label: 'Radial' }, { id: 'linear', label: 'Linear' }]}
          />
          {value.type === 'linear' && (
            <SliderField label="Angle" value={value.angle} min={0} max={360} unit="°" onChange={(angle) => patch({ gradient: { angle } }, 'gangle')} />
          )}
        </>
      ) : (
        fallback
      )}
      <Toggle checked={!!value} onChange={(on) => patch({ gradient: on ? onDefault : null })} label="Gradient" />
    </>
  )
}

function ShapeSection({ layer, patch }: { layer: ShapeLayer; patch: Patch }): ReactNode {
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
      <GradientFields
        value={layer.gradient}
        patch={patch}
        onDefault={{}}
        fallback={<ColorField label="Fill" alpha value={layer.fill} onChange={(fill) => patch({ fill }, 'fill')} />}
      />
      {layer.shape === 'rect' && (
        <SliderField label="Corner radius" value={layer.radius} min={0} max={200} unit="px" onChange={(radius) => patch({ radius }, 'radius')} />
      )}
      <SliderField label="Feather" value={layer.feather} min={0} max={200} unit="px" onChange={(feather) => patch({ feather }, 'feather')} />
    </Section>
  )
}

function MaskSection({
  studio,
  variantId,
  layer,
  setTool
}: {
  studio: Studio
  variantId: string
  layer: Layer
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
    <Section
      title={layer.kind === 'image' ? 'Cut-out & mask' : 'Mask'}
      aside={layer.mask ? <span className={k.tag}>masked</span> : null}
    >
      {layer.kind === 'image' && (
        <>
          <input
            className={k.field}
            placeholder="What to keep (optional) — e.g. the man"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
          />
          <div className={s.rowGap}>
            <button
              className={`${k.btn} ${k.btnPrimary} ${s.grow}`}
              disabled={!!busy}
              onClick={() => void run('cut', () => cutOut(studio, variantId, layer.id, subject || undefined))}
            >
              {busy === 'cut' ? 'Cutting out…' : 'Smart cut-out'}
            </button>
            <button className={k.btn} title="Drag a box around one object to cut it out" onClick={() => setTool('cut')}>
              In box
            </button>
          </div>
        </>
      )}
      <div className={s.rowGap}>
        <button className={`${k.btn} ${s.grow}`} onClick={() => setTool('brush')}>Brush</button>
        <button className={`${k.btn} ${s.grow}`} onClick={() => setTool('lasso')}>Lasso</button>
        <button
          className={`${k.btn} ${s.grow}`}
          disabled={!!busy}
          onClick={() => void run('invert', () => editMask(studio, variantId, layer.id, 'invert'))}
        >
          Invert
        </button>
      </div>
      <SliderField label="Feather amount" value={feather} min={1} max={40} unit="px" onChange={setFeather} />
      <div className={s.rowGap}>
        <button
          className={`${k.btn} ${s.grow}`}
          disabled={!!busy || !layer.mask}
          onClick={() => void run('feather', () => editMask(studio, variantId, layer.id, 'feather', [], feather))}
        >
          Feather edges
        </button>
        <button
          className={`${k.btn} ${k.btnGhost}`}
          disabled={!!busy || !layer.mask}
          onClick={() => void run('reset', () => editMask(studio, variantId, layer.id, 'reset'))}
        >
          Reset mask
        </button>
      </div>
    </Section>
  )
}

const layerLabel = (l: Layer): string =>
  l.kind === 'text' ? l.text.replace(/\*/g, '').slice(0, 28) || l.name : l.name

function ClipSection({
  studio,
  variantId,
  layer,
  patch
}: {
  studio: Studio
  variantId: string
  layer: Layer
  patch: Patch
}): ReactNode {
  const doc = studio.doc(variantId)
  const clip = layer.clip
  const groups = doc.groups.map((g) => ({ id: g.id, label: 'Group · ' + g.name }))
  const layers = [...doc.layers]
    .reverse()
    .filter((l) => l.id !== layer.id)
    .map((l) => ({ id: l.id, label: layerLabel(l) }))
  const options = [...groups, ...layers]
  const source = options.find((o) => o.id === clip?.from)

  return (
    <Section
      title="Clip to"
      aside={
        clip ? (
          <button className={s.linkBtn} onClick={() => patch({ clip: null })}>
            Clear
          </button>
        ) : null
      }
    >
      {options.length === 0 ? (
        <p className={s.hint}>Add another layer to clip this one to it.</p>
      ) : (
        <MenuSelect
          wide
          align="start"
          trigger={
            <span className={s.pillGrow}>
              <span className={s.pillDim}>Shape of</span> {source?.label ?? 'nothing'}
            </span>
          }
          groups={[
            {
              title: 'Clip to the shape of',
              value: clip?.from ?? '',
              options,
              onChange: (from) => patch({ clip: { from } })
            }
          ]}
        />
      )}
      {clip && (
        <>
          <Segmented
            value={clip.mode}
            onChange={(mode) => patch({ clip: { mode } })}
            options={[
              { id: 'alpha', label: 'Shape', title: 'Show wherever the source covers anything' },
              { id: 'luma', label: 'Brightness', title: 'Bright areas of the source show, dark areas hide' }
            ]}
          />
          <Toggle checked={clip.invert} onChange={(invert) => patch({ clip: { invert } })} label="Invert" />
          <SliderField
            label="Soften edge"
            value={clip.feather}
            min={0}
            max={120}
            unit="px"
            onChange={(feather) => patch({ clip: { feather } }, 'cf')}
          />
          <p className={s.hint}>The layer it clips to can stay hidden — it still shapes this one.</p>
        </>
      )}
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
      <Section title="Layer" aside={<span className={k.tag}>{layer.kind}</span>}>
        <input className={k.field} value={layer.name} onChange={(e) => patch({ name: e.target.value }, 'name')} />
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
            <button className={`${s.miniBtn} ${layer.flipX ? s.miniOn : ''}`} title="Mirror horizontally" onClick={() => patch({ flipX: !layer.flipX })}>Flip H</button>
            <button className={`${s.miniBtn} ${layer.flipY ? s.miniOn : ''}`} title="Mirror vertically" onClick={() => patch({ flipY: !layer.flipY })}>Flip V</button>
          </div>
        </div>
        <SliderField label="Opacity" value={Math.round(layer.opacity * 100)} min={0} max={100} unit="%" onChange={(v) => patch({ opacity: v / 100 }, 'opacity')} />
        <MenuSelect
          wide
          align="start"
          trigger={
            <span className={s.pillGrow}>
              <span className={s.pillDim}>Blend</span> {blendName(layer.blend)}
            </span>
          }
          groups={[{
            title: 'Blend mode',
            value: layer.blend,
            grid: true,
            options: BLEND_MODES.map((b) => ({ id: b, label: blendName(b) })),
            onChange: (blend) => patch({ blend })
          }]}
        />
      </Section>

      {layer.kind === 'text' && <TextSection layer={layer} patch={patch} focus={focusText} />}
      {layer.kind === 'shape' && <ShapeSection layer={layer} patch={patch} />}
      <MaskSection studio={studio} variantId={variantId} layer={layer} setTool={setTool} />
      <ClipSection studio={studio} variantId={variantId} layer={layer} patch={patch} />

      <Section title="Effects">
        <EffectStack layer={layer} name="strokes" title="Outline" patch={patch}>
          {(e, set) => (
            <>
              <ColorField label="Colour" value={e.color} onChange={(color) => set({ color }, 'sc')} />
              <SliderField label="Width" value={e.width} min={1} max={60} unit="px" onChange={(width) => set({ width }, 'sw')} />
              <Segmented
                value={e.position}
                onChange={(position) => set({ position })}
                options={[
                  { id: 'outside', label: 'Outside', title: 'Grows out of the shape' },
                  { id: 'center', label: 'Centre', title: 'Half in, half out' },
                  { id: 'inside', label: 'Inside', title: 'Eats into the shape, size unchanged' }
                ]}
              />
              <SliderField label="Opacity" value={Math.round(e.opacity * 100)} min={0} max={100} unit="%" onChange={(v) => set({ opacity: v / 100 }, 'so')} />
            </>
          )}
        </EffectStack>
        <EffectStack layer={layer} name="shadows" title="Shadow" patch={patch}>
          {(e, set) => (
            <>
              <Segmented
                value={e.inner ? 'inner' : 'drop'}
                onChange={(m) => set({ inner: m === 'inner' })}
                options={[
                  { id: 'drop', label: 'Drop', title: 'Cast behind the layer' },
                  { id: 'inner', label: 'Inner', title: 'Cast inside the layer edge' }
                ]}
              />
              <ColorField label="Colour" value={e.color} onChange={(color) => set({ color }, 'shc')} />
              <SliderField label="Opacity" value={Math.round(e.opacity * 100)} min={0} max={100} unit="%" onChange={(v) => set({ opacity: v / 100 }, 'sho')} />
              <SliderField label="Blur" value={e.blur} min={0} max={120} unit="px" onChange={(blur) => set({ blur }, 'shb')} />
              <div className={s.grid2}>
                <NumField label="X" value={e.x} onChange={(x) => set({ x }, 'shx')} />
                <NumField label="Y" value={e.y} onChange={(y) => set({ y }, 'shy')} />
              </div>
            </>
          )}
        </EffectStack>
        <EffectStack layer={layer} name="glows" title="Glow" patch={patch}>
          {(e, set) => (
            <>
              <Segmented
                value={e.inner ? 'inner' : 'outer'}
                onChange={(m) => set({ inner: m === 'inner' })}
                options={[
                  { id: 'outer', label: 'Outer', title: 'Light spilling out around the layer' },
                  { id: 'inner', label: 'Inner', title: 'Light along the inside of the edge' }
                ]}
              />
              <ColorField label="Colour" value={e.color} onChange={(color) => set({ color }, 'gc')} />
              <SliderField label="Size" value={e.size} min={4} max={160} unit="px" onChange={(size) => set({ size }, 'gs')} />
              <SliderField label="Opacity" value={Math.round(e.opacity * 100)} min={0} max={100} unit="%" onChange={(v) => set({ opacity: v / 100 }, 'go')} />
            </>
          )}
        </EffectStack>
        <Tint layer={layer} patch={patch} />
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
