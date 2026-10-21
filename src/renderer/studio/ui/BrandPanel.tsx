import { useEffect, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import type { BrandKit, BrandLogo, Layer } from '@shared/studio'
import { Prompt } from '../../components/Bits'
import { useStore } from '../../state/store'
import { applyStyle, brandId, loadBrand, placeLogo, saveBrand, styleFrom, useBrand } from '../brand'
import type { Studio, VariantState } from '../engine'
import { extractPalette } from '../palette'
import { renderDoc } from '../render'
import { Swatch } from './fields'
import k from '../../styles/soft.module.css'
import s from './studio.module.css'

const logoUrls = new Map<string, Promise<string>>()

function logoUrl(file: string): Promise<string> {
  let url = logoUrls.get(file)
  if (!url) {
    url = window.raeydzone.studio.readLogo(file).then((bytes) => URL.createObjectURL(new Blob([bytes as BlobPart])))
    logoUrls.set(file, url)
  }
  return url
}

function LogoThumb({ logo }: { logo: BrandLogo }): ReactNode {
  const [src, setSrc] = useState<string | null>(null)
  useEffect(() => {
    void logoUrl(logo.file).then(setSrc).catch(() => {})
  }, [logo.file])
  return src ? <img className={s.assetCanvas} src={src} alt={logo.name} /> : <span className={s.assetCanvas} />
}

// Colours applied from the kit land where the creator would expect: the fill of text and
// shapes; anything else just copies the hex.
function colorTarget(l: Layer | null): string | null {
  return l?.kind === 'text' || l?.kind === 'shape' ? l.id : null
}

export function BrandPanel({ studio, variant }: { studio: Studio; variant: VariantState }): ReactNode {
  const { notify } = useStore()
  const kit = useBrand()
  const [draft, setDraft] = useState('#ff2a2a')
  const [palette, setPalette] = useState<string[]>([])
  const [naming, setNaming] = useState(false)
  const v = variant.id
  const selected = variant.doc.layers.find((l) => l.id === variant.selected) ?? null

  useEffect(() => {
    void loadBrand().catch(() => {})
  }, [])

  const save = (next: Partial<BrandKit>): void => void saveBrand({ ...kit, ...next }).catch((err: Error) => notify(err.message, 'bad'))
  const run = (fn: () => Promise<unknown> | unknown): void => void (async () => fn())().catch((err: Error) => notify(err.message, 'bad'))

  const pickColor = (color: string): void => {
    const id = colorTarget(selected)
    if (id) studio.patch(v, id, { fill: color, gradient: null })
    void navigator.clipboard.writeText(color).catch(() => {})
    notify(id ? `Applied ${color.toUpperCase()}` : `Copied ${color.toUpperCase()}`)
  }
  const addColors = (colors: string[]): void =>
    save({ colors: [...kit.colors, ...colors.filter((c) => !kit.colors.some((x) => x.color === c)).map((color) => ({ id: brandId(), name: color, color }))] })

  return (
    <div className={s.brandPanel}>
      <section className={s.brandBlock}>
        <span className={s.fieldLabel}>Colours</span>
        <div className={s.brandSwatches}>
          {kit.colors.map((c) => (
            <span key={c.id} className={s.brandSwatchWrap}>
              <button className={s.brandSwatch} style={{ '--swatch': c.color } as CSSProperties} title={`${c.color} — click to use`} onClick={() => pickColor(c.color)} />
              <button className={s.brandDrop} title="Remove from the kit" onClick={() => save({ colors: kit.colors.filter((x) => x.id !== c.id) })}>
                ✕
              </button>
            </span>
          ))}
          <Swatch value={draft} onChange={setDraft} title="Choose a colour to add" />
          <button className={k.chip} onClick={() => addColors([draft])}>
            + Add
          </button>
        </div>
        <div className={s.rowGap}>
          <button className={k.chip} onClick={() => run(() => setPalette(extractPalette(renderDoc(variant.doc, studio.assets))))}>
            Palette from this thumbnail
          </button>
          {palette.length > 0 && (
            <button className={k.chip} onClick={() => addColors(palette)}>
              Add all to the kit
            </button>
          )}
        </div>
        {palette.length > 0 && (
          <div className={s.brandSwatches}>
            {palette.map((c) => (
              <button key={c} className={s.brandSwatch} style={{ '--swatch': c } as CSSProperties} title={`${c} — click to use`} onClick={() => pickColor(c)} />
            ))}
          </div>
        )}
      </section>

      <section className={s.brandBlock}>
        <span className={s.fieldLabel}>Fonts</span>
        <div className={s.wordChips}>
          {kit.fonts.map((f) => (
            <span key={f} className={s.brandSwatchWrap}>
              <button
                className={s.wordChip}
                style={{ fontFamily: `"${f}"` }}
                title={selected?.kind === 'text' ? 'Use on the selected text' : 'Select a text layer to use it'}
                onClick={() => selected?.kind === 'text' && run(() => studio.patch(v, selected.id, { font: f }))}
              >
                {f}
              </button>
              <button className={s.brandDrop} title="Remove from the kit" onClick={() => save({ fonts: kit.fonts.filter((x) => x !== f) })}>
                ✕
              </button>
            </span>
          ))}
          {selected?.kind === 'text' && !kit.fonts.includes(selected.font) && (
            <button className={k.chip} onClick={() => save({ fonts: [...kit.fonts, selected.font] })}>
              + {selected.font}
            </button>
          )}
        </div>
      </section>

      <section className={s.brandBlock}>
        <span className={s.fieldLabel}>Styles</span>
        {kit.styles.length === 0 && <p className={s.hint}>Save a layer's look as a style. Layers given the style follow it when it changes.</p>}
        {kit.styles.map((st) => {
          const linked = variant.doc.layers.filter((l) => l.link === st.id).length
          return (
            <div key={st.id} className={s.snapRow}>
              <div className={s.layerLabel}>
                <span className={s.layerName}>{st.name}</span>
                <span className={s.layerKind}>
                  From {st.kind}
                  {linked ? ` · ${linked} here` : ''}
                </span>
              </div>
              <button className={k.chip} disabled={!selected} title="Give the selected layer this look and link it" onClick={() => selected && run(() => applyStyle(studio, v, selected.id, st))}>
                Apply
              </button>
              <button
                className={k.chip}
                disabled={!selected}
                title="Take the selected layer's look into this style — every linked layer follows"
                onClick={() => selected && save({ styles: kit.styles.map((x) => (x.id === st.id ? { ...x, kind: selected.kind, props: styleFrom(selected), updatedAt: new Date().toISOString() } : x)) })}
              >
                Update
              </button>
              <button className={k.chip} title="Delete the style; linked layers keep their look" onClick={() => save({ styles: kit.styles.filter((x) => x.id !== st.id) })}>
                ✕
              </button>
            </div>
          )
        })}
        <button className={k.chip} disabled={!selected} onClick={() => setNaming(true)}>
          + Save the selected layer's look
        </button>
      </section>

      <section className={s.brandBlock}>
        <span className={s.fieldLabel}>Logos</span>
        <div className={s.assetGrid}>
          {kit.logos.map((logo) => (
            <div key={logo.id} className={s.brandSwatchWrap}>
              <button className={s.assetCell} title={`${logo.name} — click to place`} onClick={() => run(async () => studio.select(v, (await placeLogo(studio, v, logo)).id))}>
                <LogoThumb logo={logo} />
                <span>{logo.name}</span>
              </button>
              <button
                className={s.brandDrop}
                title="Remove from the kit"
                onClick={() => run(async () => {
                  await window.raeydzone.studio.removeLogo(logo.file)
                  save({ logos: kit.logos.filter((x) => x.id !== logo.id) })
                })}
              >
                ✕
              </button>
            </div>
          ))}
        </div>
        <button
          className={k.chip}
          onClick={() => run(async () => {
            const logo = await window.raeydzone.studio.pickLogo()
            if (logo) save({ logos: [...kit.logos, logo] })
          })}
        >
          + Add a logo
        </button>
      </section>

      <Prompt
        open={naming}
        title="Save as a brand style"
        placeholder="e.g. Headline red"
        confirmLabel="Save"
        onOpenChange={setNaming}
        onConfirm={(name) => {
          if (!selected) return
          const id = brandId()
          const style = { id, name: name.trim() || 'Style', kind: selected.kind, props: styleFrom(selected), updatedAt: new Date().toISOString() }
          save({ styles: [...kit.styles, style] })
          studio.patch(v, selected.id, { link: id })
        }}
      />
    </div>
  )
}
