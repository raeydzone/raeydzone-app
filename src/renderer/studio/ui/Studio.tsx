import * as Dialog from '@radix-ui/react-dialog'
import { PresenceContext } from 'motion/react'
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { ClaudeStatus, StudioProject } from '@shared/studio'
import { Prompt } from '../../components/Bits'
import { useStore } from '../../state/store'
import { cutOut, generateAsset, generativeFill, placeAsset } from '../ai'
import { copyLayers, cutLayers, pasteLayers } from '../clipboard'
import type { Box } from '../ai'
import { encode } from '../assets'
import { emptyDoc } from '../doc'
import { openStudio } from '../engine'
import { loadDocAssets, renderDoc } from '../render'
import { Chat } from './Chat'
import { Inspector } from './Inspector'
import { LayerMenu } from './LayerMenu'
import { ImageModelsPicker } from './Pickers'
import { LayersPanel } from './LayersPanel'
import { ReportsButton } from './Reports'
import { SpendPill } from './Spend'
import { Stage } from './Stage'
import { DEFAULT_OPTIONS } from './Stage'
import type { Tool, ToolOptions } from './Stage'
import { Strip } from './Strip'
import { ToolBar, ToolOptionsBar } from './ToolBar'
import c from '../../components/components.module.css'
import k from '../../styles/soft.module.css'
import s from './studio.module.css'

const SHORTCUTS: Record<string, Tool> = {
  v: 'move', t: 'text', r: 'rect', e: 'ellipse', p: 'pen', l: 'lasso', b: 'brush', c: 'cut', g: 'fill',
  m: 'select', n: 'paint', d: 'distort'
}

function typing(): boolean {
  const el = document.activeElement
  return el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement
}

export default function Studio({ project, onBack }: { project: StudioProject; onBack: () => void }): ReactNode {
  const { notify } = useStore()
  const studio = useMemo(() => openStudio(project), [project])
  const state = useSyncExternalStore(studio.subscribe, studio.getState)
  const [tool, setTool] = useState<Tool>('move')
  const [options, setOptions] = useState<ToolOptions>(DEFAULT_OPTIONS)
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

  useEffect(() => {
    void studio.syncThumbnail().catch((err: Error) => notify(err.message, 'bad'))
    return () => void studio.flush()
  }, [studio, notify])

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
      const ids = studio.selection(v)
      const any = ids.length > 0
      if (e.ctrlKey && key === 'z') studio[e.shiftKey ? 'redo' : 'undo'](v)
      else if (e.ctrlKey && key === 'y') studio.redo(v)
      else if (e.ctrlKey && key === 'a') studio.pick(v, variant.doc.layers.filter((l) => !l.locked).map((l) => l.id))
      else if (e.ctrlKey && key === 'd' && any) studio.duplicateMany(v, ids)
      else if (e.ctrlKey && key === 'g' && e.shiftKey) {
        for (const g of new Set(variant.doc.layers.filter((l) => ids.includes(l.id) && l.group).map((l) => l.group!))) studio.ungroup(v, g)
      } else if (e.ctrlKey && key === 'g' && ids.length > 1) studio.group(v, ids)
      else if (e.ctrlKey && key === 'c' && any) void runJob('Copying…', () => copyLayers(studio, v, ids))
      else if (e.ctrlKey && key === 'x' && any) void runJob('Cutting…', () => cutLayers(studio, v, ids))
      else if (e.ctrlKey && key === 'v') void runJob('Pasting…', () => pasteLayers(studio, v))
      else if ((key === 'delete' || key === 'backspace') && any) studio.removeMany(v, ids)
      else if (key.startsWith('arrow') && any) {
        const step = e.shiftKey ? 10 : 1
        const dx = key === 'arrowleft' ? -step : key === 'arrowright' ? step : 0
        const dy = key === 'arrowup' ? -step : key === 'arrowdown' ? step : 0
        const moved = variant.doc.layers.filter((l) => ids.includes(l.id)).map((l) => [l.id, [l.x + dx, l.y + dy]])
        studio.place(v, Object.fromEntries(moved), 'nudge')
      } else if (key === 'escape') {
        if (studio.selectionOf(v)) studio.setSelection(v, null)
        else if (tool !== 'move') setTool('move')
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
      studio.markApplied((await window.raeydzone.studio.apply(project.id, data, ext)).hash)
      notify(`${variant.name} is now the thumbnail of “${project.name}”`)
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
          ← {project.name}
        </button>
        <span className={s.headTitle}>Thumbnail Studio</span>
        {job && <span className={s.jobPill}>{job}</span>}
        <span className={s.grow} />
        <ReportsButton />
        <SpendPill project={project} />
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
              <ToolOptionsBar
                tool={tool}
                options={options}
                setOptions={setOptions}
                selected={selected}
                studio={studio}
                variantId={variant.id}
                setTool={setTool}
              />
              <LayerMenu studio={studio} variant={variant}>
                <div className={s.menuHost}>
                  <Stage
                    studio={studio}
                    variant={variant}
                    tool={tool}
                    options={options}
                    setOptions={setOptions}
                    setTool={setTool}
                    onBox={onBox}
                    onTextCreated={setFocusText}
                  />
                </div>
              </LayerMenu>
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
