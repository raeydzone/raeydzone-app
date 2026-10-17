import * as Dialog from '@radix-ui/react-dialog'
import { PresenceContext } from 'motion/react'
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { ClaudeStatus } from '@shared/studio'
import type { Video } from '@shared/types'
import { Prompt } from '../../components/Bits'
import { useStore } from '../../state/store'
import { cutOut, generateAsset, generativeFill, placeAsset } from '../ai'
import type { Box } from '../ai'
import { encode } from '../assets'
import { emptyDoc } from '../doc'
import { openStudio } from '../engine'
import { loadDocAssets, renderDoc } from '../render'
import { Chat } from './Chat'
import { Inspector } from './Inspector'
import { ImageModelsPicker } from './Pickers'
import { LayersPanel } from './LayersPanel'
import { Stage } from './Stage'
import type { Tool, ToolOptions } from './Stage'
import { Strip } from './Strip'
import { ToolBar, ToolOptionsBar } from './ToolBar'
import c from '../../components/components.module.css'
import k from '../../styles/soft.module.css'
import s from './studio.module.css'

const SHORTCUTS: Record<string, Tool> = {
  v: 'move', t: 'text', r: 'rect', e: 'ellipse', p: 'pen', l: 'lasso', b: 'brush', c: 'cut', g: 'fill'
}

function typing(): boolean {
  const el = document.activeElement
  return el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement
}

export default function Studio({ video, onBack }: { video: Video; onBack: () => void }): ReactNode {
  const { notify } = useStore()
  const studio = useMemo(() => openStudio(video.id), [video.id])
  const state = useSyncExternalStore(studio.subscribe, studio.getState)
  const [tool, setTool] = useState<Tool>('move')
  const [options, setOptions] = useState<ToolOptions>({ brush: 24, maskShow: false, glowPen: true })
  const [generating, setGenerating] = useState(false)
  const [focusText, setFocusText] = useState<string | null>(null)
  const [pendingBox, setPendingBox] = useState<Box | null>(null)
  const [askGenerate, setAskGenerate] = useState(false)
  const [discard, setDiscard] = useState<string | null>(null)
  const [job, setJob] = useState<string | null>(null)
  const [claude, setClaude] = useState<ClaudeStatus | null>(null)

  const variant = state.variants.find((v) => v.id === state.activeId) ?? null
  const selected = variant?.doc.layers.find((l) => l.id === variant.selected) ?? null

  useEffect(() => {
    void window.raeydzone.ai.claudeStatus().then(setClaude).catch(() => {})
  }, [])

  useEffect(() => () => void studio.flush(), [studio])

  useEffect(() => {
    if (!focusText) return
    const t = setTimeout(() => setFocusText(null), 400)
    return () => clearTimeout(t)
  }, [focusText])

  const runJob = async (label: string, fn: () => Promise<unknown>): Promise<void> => {
    setJob(label)
    try {
      await fn()
    } catch (err) {
      notify((err as Error).message, 'bad')
    } finally {
      setJob(null)
    }
  }

  const onBox = (kind: 'cut' | 'fill', box: Box): void => {
    if (!variant) return
    if (kind === 'fill') {
      setPendingBox(box)
      return
    }
    const target = selected?.kind === 'image' ? selected : [...variant.doc.layers].reverse().find((l) => l.kind === 'image' && l.visible)
    if (!target) {
      notify('There is no image layer to cut from', 'bad')
      return
    }
    studio.select(variant.id, target.id)
    setTool('move')
    void runJob('Cutting out…', () => cutOut(studio, variant.id, target.id, undefined, box))
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (!variant || typing()) return
      const v = variant.id
      const key = e.key.toLowerCase()
      const sel = variant.selected
      if (e.ctrlKey && key === 'z') studio[e.shiftKey ? 'redo' : 'undo'](v)
      else if (e.ctrlKey && key === 'y') studio.redo(v)
      else if (e.ctrlKey && key === 'd' && sel) studio.select(v, studio.duplicate(v, sel).id)
      else if (e.ctrlKey && key === 'v') {
        void runJob('Pasting…', async () => {
          const info = await studio.pasteClipboard()
          if (info) studio.select(v, placeAsset(studio, v, info).id)
        })
      } else if ((key === 'delete' || key === 'backspace') && sel) studio.remove(v, sel)
      else if (key.startsWith('arrow') && sel) {
        const step = e.shiftKey ? 10 : 1
        const l = variant.doc.layers.find((x) => x.id === sel)!
        const dx = key === 'arrowleft' ? -step : key === 'arrowright' ? step : 0
        const dy = key === 'arrowup' ? -step : key === 'arrowdown' ? step : 0
        studio.patch(v, sel, { x: l.x + dx, y: l.y + dy }, 'nudge')
      } else if (key === 'escape') {
        if (tool !== 'move') setTool('move')
        else studio.select(v, null)
      } else if (!e.ctrlKey && !e.altKey && SHORTCUTS[key]) setTool(SHORTCUTS[key])
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const apply = (): void => {
    if (!variant) return
    void runJob('Applying…', async () => {
      await loadDocAssets(studio.assets, variant.doc)
      const out = renderDoc(variant.doc, studio.assets)
      let data = await encode(out, 'image/png')
      let ext: 'png' | 'jpg' = 'png'
      if (data.length > 2_000_000) {
        data = await encode(out, 'image/jpeg', 0.93)
        ext = 'jpg'
      }
      await window.raeydzone.studio.apply(video.id, data, ext)
      notify(`${variant.name} is now the thumbnail of “${video.name}”`)
    })
  }

  const pickVersion = (id: string): void => {
    studio.setActive(id)
    setGenerating(false)
    setTool('move')
  }

  // The studio is portalled out of the page's route transition; left inside its presence
  // tree, the studio's own animations hold the next page's entry hostage after it closes.
  return createPortal(
    <PresenceContext.Provider value={null}>
    <div className={s.studio}>
      <header className={s.head}>
        <button className={s.back} onClick={onBack}>
          ← {video.name}
        </button>
        <span className={s.headTitle}>Thumbnail Studio</span>
        {job && <span className={s.jobPill}>{job}</span>}
        <span className={s.grow} />
        <ImageModelsPicker models={state.imageModels} onChange={(task, id) => studio.setImageModel(task, id)} />
        {variant && (
          <>
            <button className={`${k.btn} ${k.btnGhost}`} disabled={!variant.past.length} title="Undo (Ctrl+Z)" onClick={() => studio.undo(variant.id)}>
              Undo
            </button>
            <button className={`${k.btn} ${k.btnGhost}`} disabled={!variant.future.length} title="Redo (Ctrl+Y)" onClick={() => studio.redo(variant.id)}>
              Redo
            </button>
            <button className={`${k.btn} ${k.btnPrimary}`} disabled={!!job} onClick={apply}>
              Apply as thumbnail
            </button>
          </>
        )}
      </header>

      <div className={`${s.body} ${variant ? '' : s.bodyBare}`}>
        <ToolBar tool={tool} setTool={setTool} disabled={!variant} />

        <div className={s.center}>
          {variant ? (
            <>
              <ToolOptionsBar tool={tool} options={options} setOptions={setOptions} selected={selected} />
              <Stage
                studio={studio}
                variant={variant}
                tool={tool}
                options={options}
                setTool={setTool}
                onBox={onBox}
                onTextCreated={setFocusText}
              />
            </>
          ) : (
            <div className={s.emptyStage}>
              {state.ready ? (
                <>
                  <p>No versions yet.</p>
                  <p className={s.hint}>Describe the thumbnail in the panel on the right, or start from a blank canvas.</p>
                  <button className={k.btn} onClick={() => studio.addVariant(emptyDoc())}>
                    Blank canvas
                  </button>
                </>
              ) : (
                <p className={s.hint}>{state.error ?? 'Opening the studio…'}</p>
              )}
            </div>
          )}
          {state.variants.length > 0 && (
            <Strip
              studio={studio}
              activeId={state.activeId}
              generating={generating}
              onPick={pickVersion}
              onNew={() => setGenerating(true)}
              onBlank={() => {
                pickVersion(studio.addVariant(emptyDoc()).id)
              }}
              onDiscard={setDiscard}
            />
          )}
        </div>

        {variant && (
          <div className={s.side}>
            <LayersPanel studio={studio} variant={variant} onGenerate={() => setAskGenerate(true)} />
            <Inspector
              key={selected?.id ?? 'canvas'}
              studio={studio}
              variantId={variant.id}
              layer={selected}
              background={variant.doc.background}
              focusText={focusText === selected?.id}
              setTool={setTool}
            />
          </div>
        )}

        <Chat
          studio={studio}
          variant={variant}
          generating={generating}
          setGenerating={setGenerating}
          onPick={pickVersion}
          claude={claude}
        />
      </div>

      <Prompt
        open={!!pendingBox}
        title="Generative fill"
        placeholder="What should appear in the box? e.g. roaring fire and embers"
        confirmLabel="Fill"
        onOpenChange={(open) => !open && setPendingBox(null)}
        onConfirm={(prompt) => {
          const box = pendingBox
          if (!box || !variant) return
          setTool('move')
          void runJob('Generating fill…', async () => {
            const { layer } = await generativeFill(studio, variant.id, prompt, box)
            studio.select(variant.id, layer.id)
          })
        }}
      />

      <Prompt
        open={askGenerate}
        title="Generate an image"
        placeholder="e.g. a giant red explosion on a plain black background"
        confirmLabel="Generate"
        onOpenChange={setAskGenerate}
        onConfirm={(prompt) => {
          if (!variant) return
          void runJob('Generating image…', async () => {
            const { info } = await generateAsset(studio, variant.id, { prompt })
            studio.select(variant.id, placeAsset(studio, variant.id, info).id)
          })
        }}
      />

      <Dialog.Root open={!!discard} onOpenChange={(open) => !open && setDiscard(null)}>
        <Dialog.Portal>
          <Dialog.Overlay className={c.overlay} />
          <Dialog.Content className={c.modal}>
            <Dialog.Title className={c.modalTitle}>
              Discard {state.variants.find((v) => v.id === discard)?.name}?
            </Dialog.Title>
            <Dialog.Description className={c.modalText}>
              The version, its layers and its chat are removed. Applied thumbnails are not affected.
            </Dialog.Description>
            <div className={c.modalActions}>
              <Dialog.Close asChild>
                <button className={`${k.btn} ${k.btnGhost}`}>Cancel</button>
              </Dialog.Close>
              <button
                className={`${k.btn} ${k.btnDanger}`}
                onClick={() => {
                  if (discard) studio.removeVariant(discard)
                  setDiscard(null)
                }}
              >
                Discard
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
    </PresenceContext.Provider>,
    document.body
  )
}
