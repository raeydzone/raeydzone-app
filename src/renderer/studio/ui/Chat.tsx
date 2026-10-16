import * as Slider from '@radix-ui/react-slider'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { CLAUDE_MODELS } from '@shared/studio'
import type { AssetInfo, ChatItem, ClaudeStatus } from '@shared/studio'
import { IconClose, IconImage, IconStop } from '../../components/Icons'
import { useStore } from '../../state/store'
import type { Studio, VariantState } from '../engine'
import s from './studio.module.css'
import ui from '../../styles/ui.module.css'

function Attachment({ studio, asset, onRemove }: { studio: Studio; asset: AssetInfo; onRemove?: () => void }): ReactNode {
  const ref = useRef<HTMLCanvasElement>(null)
  const tick = studio.state.tick
  useEffect(() => {
    const px = studio.assets.peek(asset.id)
    const c = ref.current
    if (!px || !c) return
    const k = Math.max(c.width / px.width, c.height / px.height)
    c.getContext('2d')!.drawImage(px, (c.width - px.width * k) / 2, (c.height - px.height * k) / 2, px.width * k, px.height * k)
  }, [studio, asset.id, tick])
  return (
    <div className={s.attachment} title={asset.label}>
      <canvas ref={ref} width={96} height={64} />
      {onRemove && (
        <button className={s.attachmentRemove} onClick={onRemove} aria-label="Remove attachment">
          <IconClose size={9} />
        </button>
      )}
    </div>
  )
}

function Message({ studio, item }: { studio: Studio; item: ChatItem }): ReactNode {
  if (item.kind === 'tool') {
    return (
      <div className={`${s.toolRow} ${s['tool_' + item.status]}`} title={item.detail ?? item.name}>
        <span className={s.toolDot} />
        <span className={s.toolText}>{item.summary}</span>
        {item.detail && <span className={s.toolError}>{item.detail}</span>}
      </div>
    )
  }
  if (item.kind === 'note') return <div className={`${s.note} ${item.bad ? s.noteBad : ''}`}>{item.text}</div>
  if (item.kind === 'user') {
    const assets = item.images.map((id) => studio.state.assets.find((a) => a.id === id)).filter(Boolean) as AssetInfo[]
    return (
      <div className={s.userMsg}>
        {assets.length > 0 && (
          <div className={s.attachRow}>
            {assets.map((a) => <Attachment key={a.id} studio={studio} asset={a} />)}
          </div>
        )}
        {item.text}
      </div>
    )
  }
  return <div className={s.aiMsg}>{item.text}</div>
}

const STATUS_TEXT: Record<VariantState['status'], string> = {
  idle: 'Ready',
  working: 'Claude is working…',
  stopped: 'Stopped',
  error: 'Stopped with an error'
}

export function Chat({
  studio,
  variant,
  generating,
  setGenerating,
  claude
}: {
  studio: Studio
  variant: VariantState | null
  generating: boolean
  setGenerating: (v: boolean) => void
  claude: ClaudeStatus | null
}): ReactNode {
  const { notify } = useStore()
  const [text, setText] = useState('')
  const [attached, setAttached] = useState<AssetInfo[]>([])
  const [count, setCount] = useState(3)
  const [model, setModel] = useState<string>(CLAUDE_MODELS[0].id)
  const [sending, setSending] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)
  const working = variant?.status === 'working'
  const usage = studio.state.usage
  const blocked = claude && (!claude.found || !claude.loggedIn)

  useEffect(() => {
    void window.raeydzone.ai.prefs().then((p) => setModel(p.claudeModel)).catch(() => {})
  }, [])

  useEffect(() => {
    const el = listRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [variant?.chat.length, variant?.id])

  const attach = async (fn: () => Promise<AssetInfo[]>): Promise<void> => {
    try {
      const added = await fn()
      setAttached((list) => [...list, ...added.filter((a) => !list.some((x) => x.id === a.id))])
    } catch (err) {
      notify((err as Error).message, 'bad')
    }
  }

  const pick = (): Promise<void> =>
    attach(async () => {
      const paths = await window.raeydzone.studio.pickImages()
      return paths.length ? studio.importPaths(paths) : []
    })

  const submit = async (): Promise<void> => {
    const brief = text.trim()
    if (!brief || sending) return
    setSending(true)
    try {
      if (generating || !variant) {
        await studio.generate(brief, attached, count)
        setGenerating(false)
      } else {
        await studio.message(variant.id, brief, attached)
      }
      setText('')
      setAttached([])
    } catch (err) {
      notify((err as Error).message, 'bad')
    } finally {
      setSending(false)
    }
  }

  const fresh = generating || !variant
  const placeholder = fresh
    ? 'Describe the thumbnail — the idea, the text, the mood. Attach photos and screenshots.'
    : `Message ${variant!.name} — steer it or ask for changes…`

  return (
    <div className={s.chat}>
      <div className={s.chatHead}>
        <div>
          <div className={s.chatTitle}>{fresh ? 'New thumbnails' : variant!.name}</div>
          <div className={`${s.chatStatus} ${working ? s.chatWorking : ''}`}>
            {fresh ? 'Claude designs each version on the canvas' : STATUS_TEXT[variant!.status]}
          </div>
        </div>
        <select
          className={`${ui.input} ${s.modelSelect}`}
          value={model}
          title="Model that designs the thumbnail"
          onChange={(e) => {
            setModel(e.target.value)
            void window.raeydzone.ai.setPrefs({ claudeModel: e.target.value })
          }}
        >
          {CLAUDE_MODELS.map((m) => (
            <option key={m.id} value={m.id}>{m.label}</option>
          ))}
        </select>
      </div>

      <div ref={listRef} className={s.chatList}>
        {fresh ? (
          <div className={s.chatIntro}>
            <p>
              Write what the thumbnail should be. Claude builds it layer by layer on the canvas — you watch every
              step, can move things yourself at any time, and steer it with messages.
            </p>
            <p className={s.hint}>Each version runs as its own Claude session from your subscription.</p>
          </div>
        ) : (
          <AnimatePresence initial={false}>
            {variant!.chat.map((item) => (
              <motion.div
                key={item.id}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.16, ease: [0.22, 0.61, 0.36, 1] }}
              >
                <Message studio={studio} item={item} />
              </motion.div>
            ))}
          </AnimatePresence>
        )}
      </div>

      <div className={s.composer}>
        {blocked && (
          <div className={s.noteBad + ' ' + s.note}>
            {claude!.found ? 'Claude is not signed in.' : 'Claude Code is not installed.'} Connect it in Settings.
          </div>
        )}
        {attached.length > 0 && (
          <div className={s.attachRow}>
            {attached.map((a) => (
              <Attachment key={a.id} studio={studio} asset={a} onRemove={() => setAttached((l) => l.filter((x) => x.id !== a.id))} />
            ))}
          </div>
        )}
        <textarea
          className={s.composerInput}
          value={text}
          placeholder={placeholder}
          rows={fresh ? 4 : 2}
          onChange={(e) => setText(e.target.value)}
          onPaste={(e) => {
            if (!e.clipboardData.types.includes('Files')) return
            e.preventDefault()
            const paths = window.raeydzone.pathsOf(Array.from(e.clipboardData.files)).filter(Boolean)
            void attach(async () => {
              if (paths.length) return studio.importPaths(paths)
              const one = await studio.pasteClipboard()
              return one ? [one] : []
            })
          }}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault()
            const paths = window.raeydzone.pathsOf(Array.from(e.dataTransfer.files)).filter(Boolean)
            if (paths.length) void attach(() => studio.importPaths(paths))
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              void submit()
            }
          }}
        />
        {fresh && (
          <div className={s.countRow}>
            <span>Versions</span>
            <Slider.Root className={s.slider} value={[count]} min={1} max={6} step={1} onValueChange={([n]) => setCount(n)}>
              <Slider.Track className={s.sliderTrack}>
                <Slider.Range className={s.sliderRange} />
              </Slider.Track>
              <Slider.Thumb className={s.sliderThumb} aria-label="Number of versions" />
            </Slider.Root>
            <span className={s.countValue}>{count}</span>
          </div>
        )}
        <div className={s.composerBar}>
          <button className={`${ui.btn} ${ui.btnGhost}`} title="Attach images" onClick={() => void pick()}>
            <IconImage size={15} />
          </button>
          {usage?.fiveHour != null && (
            <span className={s.usage} title="Claude subscription usage in the current 5-hour window">
              {Math.round(usage.fiveHour * 100)}% of 5h limit
            </span>
          )}
          <span className={s.grow} />
          {!fresh && variant && generating === false && (
            <button className={`${ui.btn} ${ui.btnGhost}`} onClick={() => setGenerating(true)}>
              New versions
            </button>
          )}
          {fresh && variant && (
            <button className={`${ui.btn} ${ui.btnGhost}`} onClick={() => setGenerating(false)}>
              Back to chat
            </button>
          )}
          {working && !fresh ? (
            <>
              <button className={`${ui.btn} ${ui.btnDanger}`} onClick={() => studio.stop(variant!.id)}>
                <IconStop size={13} />
                Stop
              </button>
              <button className={`${ui.btn} ${ui.btnPrimary}`} disabled={!text.trim() || sending} onClick={() => void submit()}>
                Steer
              </button>
            </>
          ) : (
            <button className={`${ui.btn} ${ui.btnPrimary}`} disabled={!text.trim() || sending || !!blocked} onClick={() => void submit()}>
              {fresh ? `Generate ${count}` : 'Send'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
