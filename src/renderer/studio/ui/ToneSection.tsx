import { useRef, useState } from 'react'
import type { PointerEvent, ReactNode } from 'react'
import type { BlurStyle, CurvePoint, Curves, GradientStop, Layer } from '@shared/studio'
import { Toggle } from '../../components/Bits'
import { MenuSelect } from '../../components/MenuSelect'
import { useStore } from '../../state/store'
import { applyLook, autoLevelsOn, loadLut, matchColors } from '../adjustments'
import { LEVELS_NEUTRAL } from '../doc'
import type { Studio } from '../engine'
import { LOOKS, curveTable } from '../tone'
import { ColorField, Section, Segmented, SliderField } from './fields'
import k from '../../styles/soft.module.css'
import s from './studio.module.css'

type Patch = (patch: Record<string, unknown>, key?: string) => void
type Channel = keyof Curves

const IDENTITY: CurvePoint[] = [[0, 0], [255, 255]]
const DUO: GradientStop[] = [{ at: 0, color: '#0a0a0a' }, { at: 1, color: '#ff2a2a' }]

// Photoshop's curve box: click to add a point, drag to move it, drag it out of the box or
// double-click it to remove it. The ends stay, so a curve always spans the full range.
function CurveEditor({ points, onChange }: { points: CurvePoint[]; onChange: (pts: CurvePoint[], key?: string) => void }): ReactNode {
  const svg = useRef<SVGSVGElement>(null)
  const [drag, setDrag] = useState<number | null>(null)
  const pts = points.length >= 2 ? points : IDENTITY
  const table = curveTable(pts)
  const path = Array.from(table, (v, i) => `${i ? 'L' : 'M'}${i} ${255 - v * 255}`).join(' ')
  const at = (e: PointerEvent): CurvePoint => {
    const r = svg.current!.getBoundingClientRect()
    return [((e.clientX - r.left) / r.width) * 255, 255 - ((e.clientY - r.top) / r.height) * 255]
  }
  const clampPt = ([x, y]: CurvePoint): CurvePoint => [Math.round(Math.min(255, Math.max(0, x))), Math.round(Math.min(255, Math.max(0, y)))]
  const down = (e: PointerEvent<SVGSVGElement>): void => {
    svg.current!.setPointerCapture(e.pointerId)
    const hit = (e.target as Element).getAttribute('data-point')
    if (hit !== null) return setDrag(Number(hit))
    const p = clampPt(at(e))
    const next = [...pts, p].sort((a, b) => a[0] - b[0])
    onChange(next)
    setDrag(next.indexOf(p))
  }
  const move = (e: PointerEvent<SVGSVGElement>): void => {
    if (drag === null) return
    const [x, y] = at(e)
    if (y < -24 || y > 279) return
    onChange(pts.map((q, i) => (i === drag ? clampPt([x, y]) : q)), 'curve')
  }
  const up = (e: PointerEvent<SVGSVGElement>): void => {
    const [, y] = at(e)
    if (drag !== null && (y < -24 || y > 279) && pts.length > 2) onChange(pts.filter((_, i) => i !== drag))
    setDrag(null)
  }
  return (
    <svg ref={svg} className={s.curveBox} viewBox="0 0 255 255" onPointerDown={down} onPointerMove={move} onPointerUp={up}>
      <path className={s.curveGrid} d="M64 0V255M128 0V255M192 0V255M0 64H255M0 128H255M0 192H255" />
      <path className={s.curveDiag} d="M0 255L255 0" />
      <path className={s.curveLine} d={path} />
      {pts.map(([x, y], i) => (
        <circle
          key={i}
          className={`${s.curvePoint} ${drag === i ? s.curvePointOn : ''}`}
          data-point={i}
          cx={x}
          cy={255 - y}
          r={6}
          onDoubleClick={() => pts.length > 2 && onChange(pts.filter((_, j) => j !== i))}
        />
      ))}
    </svg>
  )
}

function MapStops({ stops, patch }: { stops: GradientStop[]; patch: Patch }): ReactNode {
  const write = (next: GradientStop[], key?: string): void => patch({ tone: { map: { stops: next } } }, key)
  return (
    <>
      {stops.map((stop, i) => (
        <div key={i} className={s.stopRow}>
          <ColorField label={i === 0 ? 'Shadows' : i === stops.length - 1 ? 'Highlights' : 'Colour ' + (i + 1)} value={stop.color} onChange={(color) => write(stops.map((x, j) => (j === i ? { ...x, color } : x)), 'mc' + i)} />
          <SliderField label="At" value={Math.round(stop.at * 100)} min={0} max={100} unit="%" onChange={(v) => write(stops.map((x, j) => (j === i ? { ...x, at: v / 100 } : x)), 'ma' + i)} />
          {stops.length > 2 && (
            <button className={s.effectDrop} onClick={() => write(stops.filter((_, j) => j !== i))}>
              Remove
            </button>
          )}
        </div>
      ))}
      {stops.length < 16 && (
        <button className={s.linkBtn} onClick={() => write([...stops, { at: 0.5, color: '#ffffff' }])}>
          + Add a colour
        </button>
      )}
    </>
  )
}

const layerLabel = (l: Layer): string => (l.kind === 'text' ? l.text.replace(/\*/g, '').slice(0, 28) || l.name : l.name)

export function ToneSection({ studio, variantId, layer, patch }: { studio: Studio; variantId: string; layer: Layer; patch: Patch }): ReactNode {
  const { notify } = useStore()
  const [channel, setChannel] = useState<Channel>('rgb')
  const [busy, setBusy] = useState(false)
  const tone = layer.tone
  const lv = tone?.levels
  const curves = tone?.curves
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
  const others = [...studio.doc(variantId).layers].reverse().filter((l) => l.id !== layer.id && l.kind !== 'adjust')
  const level = (key: keyof typeof LEVELS_NEUTRAL, v: number): void => patch({ tone: { levels: { [key]: v } } }, 'lv' + key)

  return (
    <Section title={layer.kind === 'adjust' ? 'Tone of everything below' : 'Tone'} aside={tone ? <button className={s.linkBtn} onClick={() => patch({ tone: null })}>Reset</button> : null}>
      <MenuSelect
        wide
        align="start"
        trigger={<span className={s.pillGrow}><span className={s.pillDim}>Look</span> Pick a preset…</span>}
        groups={[{ title: 'Look', value: '', options: LOOKS.map((l) => ({ id: l.id, label: l.label })), onChange: (id) => applyLook(studio, variantId, layer.id, id) }]}
      />

      <div className={s.effect}>
        <div className={s.rowGap}>
          <Toggle checked={!!lv} onChange={(on) => patch({ tone: { levels: on ? {} : null } })} label="Levels" />
          <button className={s.linkBtn} disabled={busy} onClick={() => void run(() => autoLevelsOn(studio, variantId, layer.id))}>
            Auto
          </button>
        </div>
        {lv && (
          <div className={s.effectBody}>
            <SliderField label="Black point" value={lv.black} min={0} max={254} onChange={(v) => level('black', v)} />
            <SliderField label="Midtones" value={lv.gamma} min={0.1} max={3} step={0.01} onChange={(v) => level('gamma', v)} />
            <SliderField label="White point" value={lv.white} min={1} max={255} onChange={(v) => level('white', v)} />
            <SliderField label="Output black" value={lv.outBlack} min={0} max={255} onChange={(v) => level('outBlack', v)} />
            <SliderField label="Output white" value={lv.outWhite} min={0} max={255} onChange={(v) => level('outWhite', v)} />
          </div>
        )}
      </div>

      <div className={s.effect}>
        <Toggle checked={!!curves} onChange={(on) => patch({ tone: { curves: on ? { rgb: [[0, 0], [64, 52], [192, 204], [255, 255]] } : null } })} label="Curves" />
        {curves && (
          <div className={s.effectBody}>
            <Segmented
              value={channel}
              onChange={setChannel}
              options={[{ id: 'rgb', label: 'RGB' }, { id: 'r', label: 'Red' }, { id: 'g', label: 'Green' }, { id: 'b', label: 'Blue' }]}
            />
            <CurveEditor points={curves[channel]} onChange={(pts, key) => patch({ tone: { curves: { [channel]: pts } } }, key && key + channel)} />
            <p className={s.hint}>Click to add a point, drag it out of the box to remove it.</p>
          </div>
        )}
      </div>

      <div className={s.effect}>
        <Toggle checked={!!tone?.map} onChange={(on) => patch({ tone: { map: on ? { stops: DUO, amount: 1 } : null } })} label="Gradient map" />
        {tone?.map && (
          <div className={s.effectBody}>
            <MapStops stops={tone.map.stops} patch={patch} />
            <SliderField label="Amount" value={Math.round(tone.map.amount * 100)} min={0} max={100} unit="%" onChange={(v) => patch({ tone: { map: { amount: v / 100 } } }, 'mamt')} />
          </div>
        )}
      </div>

      <div className={s.effect}>
        {tone?.lut ? (
          <>
            <div className={s.rowGap}>
              <span className={s.fieldLabel}>LUT · {tone.lut.name}</span>
              <button className={s.linkBtn} onClick={() => patch({ tone: { lut: null } })}>Remove</button>
            </div>
            <SliderField label="Strength" value={Math.round(tone.lut.amount * 100)} min={0} max={100} unit="%" onChange={(v) => patch({ tone: { lut: { amount: v / 100 } } }, 'lut')} />
          </>
        ) : (
          <button className={k.btn} disabled={busy} onClick={() => void run(() => loadLut(studio, variantId, layer.id))}>
            Load a .cube LUT…
          </button>
        )}
      </div>

      <div className={s.effect}>
        <div className={s.rowGap}>
          <button className={`${k.btn} ${s.grow}`} disabled={busy} title="Match the colours of the rest of the thumbnail" onClick={() => void run(() => matchColors(studio, variantId, layer.id, null))}>
            Match the scene
          </button>
          {others.length > 0 && (
            <MenuSelect
              align="end"
              trigger={<span className={s.pillGrow}>Match to…</span>}
              groups={[{ title: 'Match colours to', value: '', options: others.map((l) => ({ id: l.id, label: layerLabel(l) })), onChange: (id) => void run(() => matchColors(studio, variantId, layer.id, id)) }]}
            />
          )}
        </div>
        {tone?.grade && (
          <div className={s.rowGap}>
            <div className={s.grow}>
              <SliderField label="Match strength" value={Math.round(tone.grade.amount * 100)} min={0} max={100} unit="%" onChange={(v) => patch({ tone: { grade: { amount: v / 100 } } }, 'gamt')} />
            </div>
            <button className={s.linkBtn} onClick={() => patch({ tone: { grade: null } })}>Clear</button>
          </div>
        )}
      </div>
    </Section>
  )
}

const BLUR_LABELS: Record<BlurStyle, string> = { motion: 'Motion', zoom: 'Zoom', spin: 'Spin', lens: 'Lens', tilt: 'Tilt-shift' }

export function BlurSection({ layer, patch }: { layer: Layer; patch: Patch }): ReactNode {
  const b = layer.blurFx
  const centred = b && b.style !== 'motion'
  return (
    <Section title="Camera blur" aside={b ? <button className={s.linkBtn} onClick={() => patch({ blurFx: null })}>Remove</button> : null}>
      <MenuSelect
        wide
        align="start"
        trigger={<span className={s.pillGrow}><span className={s.pillDim}>Blur</span> {b ? BLUR_LABELS[b.style] : 'None'}</span>}
        groups={[{
          title: 'Camera blur',
          value: b?.style ?? 'none',
          options: [{ id: 'none', label: 'None' }, ...(Object.keys(BLUR_LABELS) as BlurStyle[]).map((id) => ({ id, label: BLUR_LABELS[id] }))],
          onChange: (style) => patch({ blurFx: style === 'none' ? null : { style, amount: style === 'spin' ? 8 : 24 } })
        }]}
      />
      {b && (
        <>
          <SliderField
            label={b.style === 'spin' ? 'Angle' : 'Amount'}
            value={b.amount}
            min={0}
            max={b.style === 'spin' ? 90 : 200}
            unit={b.style === 'spin' ? '°' : 'px'}
            onChange={(amount) => patch({ blurFx: { amount } }, 'bamt')}
          />
          {(b.style === 'motion' || b.style === 'tilt') && (
            <SliderField label="Direction" value={b.angle} min={-180} max={180} unit="°" onChange={(angle) => patch({ blurFx: { angle } }, 'bang')} />
          )}
          {centred && (
            <div className={s.grid2}>
              <SliderField label="Centre X" value={Math.round(b.x * 100)} min={0} max={100} unit="%" onChange={(v) => patch({ blurFx: { x: v / 100 } }, 'bx')} />
              <SliderField label="Centre Y" value={Math.round(b.y * 100)} min={0} max={100} unit="%" onChange={(v) => patch({ blurFx: { y: v / 100 } }, 'by')} />
            </div>
          )}
          {(b.style === 'lens' || b.style === 'tilt') && (
            <SliderField label="Sharp area" value={Math.round(b.focus * 100)} min={0} max={100} unit="%" onChange={(v) => patch({ blurFx: { focus: v / 100 } }, 'bf')} />
          )}
        </>
      )}
    </Section>
  )
}
