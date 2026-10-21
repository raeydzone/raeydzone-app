import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { BLEND_MODES, WARP_STYLES } from '@shared/studio'
import type {
  Finish, Glow, Gradient, GradientStop, Layer, Outline, Shadow, ShapeKind, ShapeLayer, TextLayer, TextStyle, WarpStyle
} from '@shared/studio'
import { Toggle } from '../../components/Bits'
import { useStore } from '../../state/store'
import { cutOut, editMask } from '../ai'
import { MenuSelect } from '../../components/MenuSelect'
import { FINISH_DEFAULT, NEUTRAL, effectDefault, patchFinish } from '../doc'
import { WEIGHT_NAMES, findFont, nearestWeight } from '../fonts'
import type { Studio } from '../engine'
import { ColorField, NumField, Section, Segmented, SliderField } from './fields'
import { FontPicker } from './FontPicker'
import { BlurSection, ToneSection } from './ToneSection'
import { presetAmount, withPreset } from '../warp'
import type { CornerPreset } from '../warp'
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
      <div className={s.rowGap}>
        <Toggle checked={layer.wrap !== null} onChange={(on) => patch({ wrap: on ? Math.round(layer.width) : null, fit: on && layer.fit })} label="Wrap" />
        {layer.wrap !== null && <Toggle checked={layer.fit} onChange={(fit) => patch({ fit })} label="Shrink to fit" />}
      </div>
      {layer.wrap !== null && (
        <NumField label={layer.fit ? 'Fit width' : 'Wrap width'} value={layer.wrap} onChange={(wrap) => patch({ wrap }, 'wrap')} />
      )}
      <SliderField label="Arc" value={layer.arc} min={-360} max={360} unit="°" onChange={(arc) => patch({ arc }, 'arc')} />
      <WordStyles layer={layer} patch={patch} />
    </Section>
  )
}

// Words as they sit in the stored text, so their offsets index it directly, stars included.
function wordsOf(text: string): { start: number; end: number; label: string }[] {
  const out: { start: number; end: number; label: string }[] = []
  const re = /[^\s*]+/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) out.push({ start: m.index, end: m.index + m[0].length, label: m[0] })
  return out
}

function WordStyles({ layer, patch }: { layer: TextLayer; patch: Patch }): ReactNode {
  const [picked, setPicked] = useState<number | null>(null)
  const words = wordsOf(layer.text)
  const word = picked !== null ? words[picked] : undefined
  const style = word ? layer.styles.find((st) => st.start === word.start && st.end === word.end) : undefined
  const write = (next: Partial<TextStyle> | null, key?: string): void => {
    if (!word) return
    const rest = layer.styles.filter((st) => st !== style)
    const merged = next ? { ...(style ?? { start: word.start, end: word.end }), ...next } : null
    patch({ styles: merged ? [...rest, merged] : rest }, key)
  }
  if (!words.length) return null
  return (
    <div className={s.effect}>
      <span className={s.fieldLabel}>Style a word</span>
      <div className={s.wordChips}>
        {words.map((w, i) => {
          const styled = layer.styles.some((st) => st.start === w.start && st.end === w.end)
          return (
            <button
              key={w.start}
              className={`${s.wordChip} ${picked === i ? s.wordChipOn : ''} ${styled ? s.wordChipStyled : ''}`}
              onClick={() => setPicked(picked === i ? null : i)}
            >
              {w.label}
            </button>
          )
        })}
      </div>
      {word && (
        <div className={s.effectBody}>
          <ColorField label="Colour" value={style?.fill ?? layer.fill} onChange={(fill) => write({ fill }, 'wf' + word.start)} />
          <SliderField label="Size" value={Math.round((style?.scale ?? 1) * 100)} min={30} max={300} unit="%" onChange={(v) => write({ scale: v / 100 }, 'ws' + word.start)} />
          <SliderField label="Lift" value={style?.rise ?? 0} min={-120} max={120} unit="px" onChange={(rise) => write({ rise }, 'wr' + word.start)} />
          <div className={s.rowGap}>
            <Toggle checked={style?.italic ?? layer.italic} onChange={(italic) => write({ italic })} label="Italic" />
            {style && (
              <button className={s.linkBtn} onClick={() => write(null)}>
                Clear this word
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// Two colours edit as from/to; the first added stop turns the ramp into an explicit list,
// and dropping back to two folds it into from/to again.
function GradientStops({ value, patch }: { value: Gradient; patch: Patch }): ReactNode {
  const stops = value.stops
  const write = (next: GradientStop[], key?: string): void => {
    if (next.length > 2) return patch({ gradient: { stops: next } }, key)
    const [a, b] = [...next].sort((x, y) => x.at - y.at)
    patch({ gradient: { stops: [], from: a.color, to: b.color } }, key)
  }
  const ramp = stops.length >= 2 ? stops : [{ at: 0, color: value.from }, { at: 1, color: value.to }]
  const add = (): void => {
    const sorted = [...ramp].sort((x, y) => x.at - y.at)
    let gap = 0
    for (let i = 1; i < sorted.length; i++) if (sorted[i].at - sorted[i - 1].at > sorted[gap + 1].at - sorted[gap].at) gap = i - 1
    const at = (sorted[gap].at + sorted[gap + 1].at) / 2
    patch({ gradient: { stops: [...sorted, { at, color: sorted[gap].color }] } })
  }
  if (stops.length < 2) {
    return (
      <>
        <div className={s.grid2}>
          <ColorField label="From" alpha value={value.from} onChange={(from) => patch({ gradient: { from } }, 'gfrom')} />
          <ColorField label="To" alpha value={value.to} onChange={(to) => patch({ gradient: { to } }, 'gto')} />
        </div>
        <button className={s.linkBtn} onClick={add}>
          + Add a colour
        </button>
      </>
    )
  }
  return (
    <>
      {stops.map((stop, i) => (
        <div key={i} className={s.stopRow}>
          <ColorField label={'Colour ' + (i + 1)} alpha value={stop.color} onChange={(color) => write(stops.map((x, j) => (j === i ? { ...x, color } : x)), 'gc' + i)} />
          <SliderField label="At" value={Math.round(stop.at * 100)} min={0} max={100} unit="%" onChange={(v) => write(stops.map((x, j) => (j === i ? { ...x, at: v / 100 } : x)), 'ga' + i)} />
          <button className={s.effectDrop} title="Remove this colour" onClick={() => write(stops.filter((_, j) => j !== i))}>
            Remove
          </button>
        </div>
      ))}
      {stops.length < 16 && (
        <button className={s.linkBtn} onClick={add}>
          + Add a colour
        </button>
      )}
    </>
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
          <GradientStops value={value} patch={patch} />
          <Segmented
            value={value.type}
            onChange={(type) => patch({ gradient: { type } })}
            options={[
              { id: 'radial', label: 'Radial' },
              { id: 'linear', label: 'Linear' },
              { id: 'conic', label: 'Conic', title: 'Sweeps round the centre' }
            ]}
          />
          {value.type !== 'radial' && (
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

const SHAPE_LABELS: Record<ShapeKind, string> = {
  rect: 'Rectangle', ellipse: 'Ellipse', polygon: 'Polygon', star: 'Star', arrow: 'Arrow', bubble: 'Speech bubble'
}

const isHollow = (l: ShapeLayer): boolean =>
  !l.gradient && (l.fill === 'transparent' || /^#[0-9a-f]{6}00$/i.test(l.fill) || /^#[0-9a-f]{3}0$/i.test(l.fill))

function ShapeSection({ layer, patch }: { layer: ShapeLayer; patch: Patch }): ReactNode {
  const kinds = (Object.keys(SHAPE_LABELS) as ShapeKind[]).filter((id) => id !== 'polygon' || layer.points.length >= 3)
  const hollow = isHollow(layer)
  const line = layer.line
  return (
    <Section title="Shape">
      <MenuSelect
        wide
        align="start"
        trigger={
          <span className={s.pillGrow}>
            <span className={s.pillDim}>Kind</span> {SHAPE_LABELS[layer.shape]}
          </span>
        }
        groups={[{
          title: 'Shape',
          value: layer.shape,
          options: kinds.map((id) => ({ id, label: SHAPE_LABELS[id] })),
          onChange: (shape) => patch({ shape })
        }]}
      />
      {layer.shape === 'star' && (
        <>
          <SliderField label="Points" value={layer.sides} min={3} max={24} onChange={(sides) => patch({ sides }, 'sides')} />
          <SliderField label="Inner size" value={Math.round(layer.inset * 100)} min={5} max={95} unit="%" onChange={(v) => patch({ inset: v / 100 }, 'inset')} />
        </>
      )}
      {layer.shape === 'arrow' && (
        <SliderField label="Shaft" value={Math.round(layer.inset * 100)} min={5} max={95} unit="%" onChange={(v) => patch({ inset: v / 100 }, 'inset')} />
      )}
      {layer.shape === 'bubble' && (
        <SliderField label="Tail" value={Math.round(layer.inset * 100)} min={5} max={95} unit="%" onChange={(v) => patch({ inset: v / 100 }, 'inset')} />
      )}
      {(layer.shape === 'polygon' || layer.shape === 'star' || layer.shape === 'arrow') && (
        <SliderField label="Roundness" value={Math.round(layer.smooth * 100)} min={0} max={100} unit="%" onChange={(v) => patch({ smooth: v / 100 }, 'smooth')} />
      )}
      {(layer.shape === 'rect' || layer.shape === 'bubble') && (
        <SliderField label="Corner radius" value={layer.radius} min={0} max={200} unit="px" onChange={(radius) => patch({ radius }, 'radius')} />
      )}

      <Toggle
        checked={!hollow}
        onChange={(on) => patch(on ? { fill: '#ff2a2a' } : { fill: 'transparent', gradient: null })}
        label="Fill"
      />
      {!hollow && (
        <GradientFields
          value={layer.gradient}
          patch={patch}
          onDefault={{}}
          fallback={<ColorField label="Fill" alpha value={layer.fill} onChange={(fill) => patch({ fill }, 'fill')} />}
        />
      )}

      <div className={s.effect}>
        <Toggle checked={!!line} onChange={(on) => patch({ line: on ? {} : null })} label="Line" />
        {line && (
          <div className={s.effectBody}>
            <ColorField label="Colour" value={line.color} onChange={(color) => patch({ line: { color } }, 'lc')} />
            <SliderField label="Width" value={line.width} min={1} max={60} unit="px" onChange={(width) => patch({ line: { width } }, 'lw')} />
            <SliderField label="Dashes" value={line.dash} min={0} max={80} unit="px" onChange={(dash) => patch({ line: { dash } }, 'ld')} />
            <SliderField label="Opacity" value={Math.round(line.opacity * 100)} min={0} max={100} unit="%" onChange={(v) => patch({ line: { opacity: v / 100 } }, 'lo')} />
          </div>
        )}
      </div>
      <SliderField label="Feather" value={layer.feather} min={0} max={200} unit="px" onChange={(feather) => patch({ feather }, 'feather')} />
    </Section>
  )
}

const PRESETS: { kind: CornerPreset; label: string }[] = [
  { kind: 'skewX', label: 'Skew horizontal' },
  { kind: 'skewY', label: 'Skew vertical' },
  { kind: 'perspectiveX', label: 'Perspective sideways' },
  { kind: 'perspectiveY', label: 'Perspective upwards' }
]

const WARP_LABELS: Record<WarpStyle, string> = {
  arc: 'Arc', arch: 'Arch', bulge: 'Bulge', flag: 'Flag', wave: 'Wave', rise: 'Rise'
}

function DistortSection({ layer, patch, setTool }: { layer: Layer; patch: Patch; setTool: (t: Tool) => void }): ReactNode {
  const warp = layer.warp
  const changed = !!layer.corners || !!warp
  return (
    <Section
      title="Distort"
      aside={changed ? <button className={s.linkBtn} onClick={() => patch({ corners: null, warp: null })}>Reset</button> : null}
    >
      {PRESETS.map((pr) => (
        <SliderField
          key={pr.kind}
          label={pr.label}
          value={Math.round(presetAmount(pr.kind, layer.corners, layer.width, layer.height) * 100)}
          min={-100}
          max={100}
          unit="%"
          onChange={(v) => patch({ corners: withPreset(pr.kind, v / 100, layer.corners, layer.width, layer.height) }, 'c-' + pr.kind)}
        />
      ))}
      <button className={k.btn} onClick={() => setTool('distort')}>
        Drag the corners
      </button>
      <MenuSelect
        wide
        align="start"
        trigger={
          <span className={s.pillGrow}>
            <span className={s.pillDim}>Warp</span> {warp ? WARP_LABELS[warp.style] : 'None'}
          </span>
        }
        groups={[{
          title: 'Warp',
          value: warp?.style ?? 'none',
          options: [{ id: 'none', label: 'None' }, ...WARP_STYLES.map((id) => ({ id, label: WARP_LABELS[id] }))],
          onChange: (style) => patch({ warp: style === 'none' ? null : { style } })
        }]}
      />
      {warp && (
        <SliderField label="Bend" value={Math.round(warp.bend * 100)} min={-100} max={100} unit="%" onChange={(v) => patch({ warp: { bend: v / 100 } }, 'bend')} />
      )}
    </Section>
  )
}

const EDGE_TITLES = {
  grow: 'Push the mask edge outwards',
  shrink: 'Pull the edge in — drops a leftover halo',
  smooth: 'Round off jagged corners',
  harden: 'Snap a soft, smeary edge clean'
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
      <SliderField label="Edge amount" value={feather} min={1} max={40} unit="px" onChange={setFeather} />
      <div className={s.rowGap}>
        {(['grow', 'shrink', 'smooth', 'harden'] as const).map((op) => (
          <button
            key={op}
            className={`${s.miniBtn} ${s.grow}`}
            disabled={!!busy || !layer.mask}
            title={EDGE_TITLES[op]}
            onClick={() => void run(op, () => editMask(studio, variantId, layer.id, op, [], feather))}
          >
            {op.charAt(0).toUpperCase() + op.slice(1)}
          </button>
        ))}
      </div>
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

function SceneEffects({ layer, patch }: { layer: Layer; patch: Patch }): ReactNode {
  const wrap = layer.lightWrap
  const contact = layer.contact
  return (
    <>
      <div className={s.effect}>
        <Toggle checked={!!wrap} onChange={(on) => patch({ lightWrap: on ? {} : null })} label="Light wrap" />
        {wrap && (
          <div className={s.effectBody}>
            <SliderField label="Amount" value={Math.round(wrap.amount * 100)} min={0} max={100} unit="%" onChange={(v) => patch({ lightWrap: { amount: v / 100 } }, 'lwa')} />
            <SliderField label="Reach" value={wrap.size} min={2} max={120} unit="px" onChange={(size) => patch({ lightWrap: { size } }, 'lws')} />
          </div>
        )}
      </div>
      <div className={s.effect}>
        <Toggle checked={!!contact} onChange={(on) => patch({ contact: on ? {} : null })} label="Contact shadow" />
        {contact && (
          <div className={s.effectBody}>
            <ColorField label="Colour" value={contact.color} onChange={(color) => patch({ contact: { color } }, 'ctc')} />
            <SliderField label="Opacity" value={Math.round(contact.opacity * 100)} min={0} max={100} unit="%" onChange={(v) => patch({ contact: { opacity: v / 100 } }, 'cto')} />
            <SliderField label="Softness" value={contact.blur} min={0} max={120} unit="px" onChange={(blur) => patch({ contact: { blur } }, 'ctb')} />
            <SliderField label="Flatness" value={Math.round(contact.squash * 100)} min={2} max={100} unit="%" onChange={(v) => patch({ contact: { squash: v / 100 } }, 'cts')} />
            <SliderField label="Drop" value={contact.y} min={-100} max={100} unit="px" onChange={(y) => patch({ contact: { y } }, 'cty')} />
          </div>
        )}
      </div>
    </>
  )
}

const FINISH_SLIDERS: { key: keyof Finish; label: string }[] = [
  { key: 'sharpen', label: 'Sharpen' },
  { key: 'clarity', label: 'Clarity' },
  { key: 'vibrance', label: 'Vibrance' },
  { key: 'bloom', label: 'Bloom' },
  { key: 'vignette', label: 'Vignette' },
  { key: 'grain', label: 'Grain' }
]

function FinishSection({ studio, variantId }: { studio: Studio; variantId: string }): ReactNode {
  const finish = studio.doc(variantId).finish ?? FINISH_DEFAULT
  const set = (key: keyof Finish, v: number): void =>
    studio.update(variantId, (d) => ({ ...d, finish: patchFinish(d.finish, { [key]: v / 100 }) }), { coalesce: 'finish' + key })
  return (
    <Section
      title="Finish"
      aside={studio.doc(variantId).finish ? <button className={s.linkBtn} onClick={() => studio.update(variantId, (d) => ({ ...d, finish: null }))}>Reset</button> : null}
    >
      {FINISH_SLIDERS.map((f) => (
        <SliderField key={f.key} label={f.label} value={Math.round(finish[f.key] * 100)} min={0} max={100} unit="%" onChange={(v) => set(f.key, v)} />
      ))}
      <p className={s.hint}>The last pass over the whole thumbnail, after every layer.</p>
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
        <FinishSection studio={studio} variantId={variantId} />
      </div>
    )
  }

  const patch: Patch = (p, key) => studio.patch(variantId, layer.id, p, key)
  const a = layer.adjust

  return (
    <div className={s.inspector}>
      <Section
        title="Layer"
        aside={
          layer.link ? (
            <button className={s.linkBtn} title="Stop following the brand style; the look stays" onClick={() => patch({ link: null })}>
              Brand style · unlink
            </button>
          ) : (
            <span className={k.tag}>{layer.kind}</span>
          )
        }
      >
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
      <DistortSection layer={layer} patch={patch} setTool={setTool} />
      <MaskSection studio={studio} variantId={variantId} layer={layer} setTool={setTool} />
      <ClipSection studio={studio} variantId={variantId} layer={layer} patch={patch} />

      {layer.kind !== 'adjust' && <Section title="Effects">
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
        <SceneEffects layer={layer} patch={patch} />
      </Section>}

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
        {layer.kind === 'adjust' && <Tint layer={layer} patch={patch} />}
      </Section>
      <ToneSection studio={studio} variantId={variantId} layer={layer} patch={patch} />
      <BlurSection layer={layer} patch={patch} />
    </div>
  )
}
