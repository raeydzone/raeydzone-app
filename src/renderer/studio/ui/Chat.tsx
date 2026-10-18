import * as Slider from '@radix-ui/react-slider'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { formatMoney } from '@shared/format'
import type { AssetInfo, ChatItem, ClaudeStatus } from '@shared/studio'
import {
  IconArrowDown, IconArrowUp, IconBrush, IconCheck, IconChevron, IconClaude, IconClose, IconCopy, IconCursor, IconEye, IconFlag,
  IconImage, IconLasso, IconLayers, IconLog, IconRect, IconRefresh, IconScissors, IconSparkle, IconStop, IconText,
  IconTools, IconTrash, IconWand
} from '../../components/Icons'
import { useStore } from '../../state/store'
import type { Studio, VariantState } from '../engine'
import { ClaudePicker, VersionPicker } from './Pickers'
import k from '../../styles/soft.module.css'
import s from './studio.module.css'

type ToolItem = Extract<ChatItem, { kind: 'tool' }>
type Block = { kind: 'steps'; id: string; items: ToolItem[] } | { kind: 'item'; id: string; item: ChatItem }

const EASE = [0.22, 0.61, 0.36, 1] as const

const TOOL_ICONS: Record<string, (p: { size?: number }) => ReactNode> = {
  get_document: IconLog,
  list_fonts: IconText,
  view_canvas: IconEye,
  view_asset: IconEye,
  add_image: IconImage,
  add_text: IconText,
  add_shape: IconRect,
  update_layer: IconCursor,
  arrange_layer: IconLayers,
  duplicate_layer: IconCopy,
  delete_layer: IconTrash,
  set_background: IconBrush,
  cut_out: IconScissors,
  edit_mask: IconLasso,
  generate_image: IconSparkle,
  generative_fill: IconWand,
  undo: IconRefresh,
  report_missing_feature: IconFlag
}

function blocksOf(chat: ChatItem[]): Block[] {
  const out: Block[] = []
  for (const item of chat) {
    const last = out[out.length - 1]
    if (item.kind !== 'tool') out.push({ kind: 'item', id: item.id, item })
    else if (last?.kind === 'steps') last.items.push(item)
    else out.push({ kind: 'steps', id: item.id, items: [item] })
  }
  return out
}

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

function Step({ item }: { item: ToolItem }): ReactNode {
  const Icon = TOOL_ICONS[item.name] ?? IconTools
  const flag = item.name === 'report_missing_feature'
  return (
    <div className={`${s.step} ${s['step_' + item.status]} ${flag ? s.stepFlag : ''}`} title={item.detail ?? undefined}>
      <span className={s.stepIcon}>
        <Icon size={12} />
      </span>
      <span className={s.stepText}>{item.summary}</span>
      {!!item.cost && <span className={s.stepCost}>{formatMoney(item.cost)}</span>}
      {item.status === 'error' && <span className={s.stepBad}>failed</span>}
      {item.detail && <span className={s.stepDetail}>{item.detail}</span>}
    </div>
  )
}

function Steps({ items, latest }: { items: ToolItem[]; latest: boolean }): ReactNode {
  const [toggled, setToggled] = useState<boolean | null>(null)
  const running = items.find((i) => i.status === 'running')
  const open = toggled ?? (latest || !!running)
  const failed = items.filter((i) => i.status === 'error').length
  const cost = items.reduce((sum, i) => sum + (i.cost ?? 0), 0)
  return (
    <div className={`${s.steps} ${running ? s.stepsLive : ''}`}>
      <button className={s.stepsHead} onClick={() => setToggled(!open)} aria-expanded={open}>
        <span className={s.stepsMark}>
          {running ? (
            <motion.span
              className={s.spin}
              animate={{ rotate: 360 }}
              transition={{ duration: 2.4, ease: 'linear', repeat: Infinity }}
            >
              <IconClaude size={13} />
            </motion.span>
          ) : (
            <IconCheck size={12} />
          )}
        </span>
        <span className={s.stepsTitle}>
          {running ? 'Working' : 'Worked through'} · {items.length} {items.length === 1 ? 'step' : 'steps'}
        </span>
        {failed > 0 && <span className={s.stepBad}>{failed} failed</span>}
        {cost > 0 && <span className={s.stepCost}>{formatMoney(cost)}</span>}
        <motion.span className={s.stepsChevron} animate={{ rotate: open ? 180 : 0 }} transition={{ duration: 0.16, ease: EASE }}>
          <IconChevron size={12} />
        </motion.span>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            className={s.stepsBody}
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18, ease: EASE }}
          >
            <div className={s.stepList}>
              {items.map((item) => (
                <Step key={item.id} item={item} />
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function Message({ studio, item }: { studio: Studio; item: ChatItem }): ReactNode {
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
  if (item.kind === 'tool') return null
  return (
    <div className={s.aiMsg}>
      <span className={s.aiAvatar}>
        <IconClaude size={13} />
      </span>
      <div className={s.aiText}>{item.text}</div>
    </div>
  )
}

const STATUS_TEXT: Record<VariantState['status'], string> = {
  idle: 'Ready for changes',
  working: 'Claude is designing…',
  stopped: 'Stopped',
  error: 'Stopped with an error'
}

function Thread({ studio, variant }: { studio: Studio; variant: VariantState }): ReactNode {
  const blocks = blocksOf(variant.chat)
  return (
    <AnimatePresence initial={false}>
      {blocks.map((b, i) => (
        <motion.div
          key={b.id}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.16, ease: EASE }}
        >
          {b.kind === 'steps' ? (
            <Steps items={b.items} latest={i === blocks.length - 1} />
          ) : (
            <Message studio={studio} item={b.item} />
          )}
        </motion.div>
      ))}
    </AnimatePresence>
  )
}

export function Chat({
  studio,
  variant,
  generating,
  setGenerating,
  onPick,
  claude
}: {
  studio: Studio
  variant: VariantState | null
  generating: boolean
  setGenerating: (v: boolean) => void
  onPick: (id: string) => void
  claude: ClaudeStatus | null
}): ReactNode {
  const { notify } = useStore()
  const [text, setText] = useState('')
  const [attached, setAttached] = useState<AssetInfo[]>([])
  const [count, setCount] = useState(3)
  const [sending, setSending] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)
  const fresh = generating || !variant
  const working = !fresh && variant?.status === 'working'
  const usage = studio.state.usage
  const blocked = claude && (!claude.found || !claude.loggedIn)
  const variants = studio.state.variants
  const lastItem = variant?.chat[variant.chat.length - 1]

  const threadRef = useRef<HTMLDivElement>(null)
  const pinnedRef = useRef(true)
  const jumpingRef = useRef(false)
  const [pinned, setPinned] = useState(true)
  const pin = (next: boolean): void => {
    pinnedRef.current = next
    setPinned(next)
  }
  const follow = (): void => {
    const el = listRef.current
    if (el && pinnedRef.current && !jumpingRef.current) el.scrollTop = el.scrollHeight
  }
  const jump = (): void => {
    const el = listRef.current
    if (!el) return
    jumpingRef.current = true
    pin(true)
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
  }
  const onScroll = (): void => {
    const el = listRef.current
    if (!el) return
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 48
    if (atBottom) jumpingRef.current = false
    if (!jumpingRef.current && atBottom !== pinnedRef.current) pin(atBottom)
  }

  useEffect(() => {
    pin(true)
    jumpingRef.current = false
    const el = listRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [variant?.id, fresh])

  useEffect(follow, [variant?.chat.length, lastItem?.kind === 'tool' && lastItem.status])

  useEffect(() => {
    const el = threadRef.current
    if (!el) return
    const ro = new ResizeObserver(follow)
    ro.observe(el)
    return () => ro.disconnect()
  })

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
      if (fresh) {
        await studio.generate(brief, attached, count)
        setGenerating(false)
      } else {
        await studio.message(variant!.id, brief, attached)
      }
      setText('')
      setAttached([])
    } catch (err) {
      notify((err as Error).message, 'bad')
    } finally {
      setSending(false)
    }
  }

  const placeholder = fresh
    ? 'Describe the thumbnail — the idea, the text, the mood. Attach photos and screenshots.'
    : working
      ? 'Steer Claude while it works…'
      : `Message ${variant!.name} — ask for changes…`
  const canSend = !!text.trim() && !sending && !blocked

  return (
    <div className={s.chat}>
      <div className={s.chatHead}>
        <div className={s.chatHeadMain}>
          <VersionPicker
            variants={variants}
            activeId={variant?.id ?? studio.state.activeId}
            generating={fresh}
            onPick={onPick}
            onNew={() => setGenerating(true)}
          />
          <div className={`${s.chatStatus} ${working ? s.chatWorking : ''}`}>
            {fresh ? 'Built live on the canvas' : STATUS_TEXT[variant!.status]}
          </div>
        </div>
        {fresh && variant ? (
          <button className={k.chip} onClick={() => setGenerating(false)}>
            Back to {variant.name}
          </button>
        ) : usage?.fiveHour != null && (
          <div className={s.usage} title="Claude subscription usage in the current 5-hour window">
            <span>5h limit</span>
            <span className={s.usageBar}>
              <motion.span
                className={s.usageFill}
                animate={{ width: `${Math.min(100, Math.round(usage.fiveHour * 100))}%` }}
                transition={{ duration: 0.2, ease: EASE }}
              />
            </span>
            <span className={s.usageValue}>{Math.round(usage.fiveHour * 100)}%</span>
          </div>
        )}
      </div>

      <div className={s.chatScroller}>
        <div
          ref={listRef}
          className={s.chatList}
          onScroll={onScroll}
          onWheel={(e) => {
            if (e.deltaY < 0) jumpingRef.current = false
          }}
        >
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              ref={threadRef}
              key={fresh ? 'fresh' : variant!.id}
              className={s.chatThread}
              initial={{ opacity: 0, x: 10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -10 }}
              transition={{ duration: 0.16, ease: EASE }}
            >
              {fresh ? (
                <div className={s.chatIntro}>
                  <div className={s.introMark}>
                    <IconClaude size={30} />
                  </div>
                  <p>
                    Write what the thumbnail should be. Claude builds it layer by layer on the canvas — you watch every
                    step, can move things yourself at any time, and steer it with messages.
                  </p>
                  <p className={s.hint}>
                    Each version runs as its own Claude session from your subscription.
                    {variants.length > 0 ? ' Your existing versions stay in the strip below the canvas.' : ''}
                  </p>
                </div>
              ) : (
                <Thread studio={studio} variant={variant!} />
              )}
            </motion.div>
          </AnimatePresence>
        </div>
        <AnimatePresence>
          {!pinned && (
            <motion.button
              className={s.jumpLatest}
              style={{ x: '-50%' }}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 6 }}
              transition={{ duration: 0.16, ease: EASE }}
              onClick={jump}
              title="Jump to latest"
              aria-label="Jump to latest"
            >
              <IconArrowDown size={14} />
            </motion.button>
          )}
        </AnimatePresence>
      </div>

      <div className={s.composerWrap}>
        {blocked && (
          <div className={`${s.note} ${s.noteBad}`}>
            {claude!.found ? 'Claude is not signed in.' : 'Claude Code is not installed.'} Connect it in Settings.
          </div>
        )}
        <div className={s.composer}>
          {attached.length > 0 && (
            <div className={s.attachRow}>
              {attached.map((a) => (
                <Attachment key={a.id} studio={studio} asset={a} onRemove={() => setAttached((l) => l.filter((x) => x.id !== a.id))} />
              ))}
            </div>
          )}
          <textarea
            className={`${s.composerInput} ${fresh ? s.composerFresh : ''}`}
            value={text}
            placeholder={placeholder}
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
            <button className={k.iconBtn} title="Attach images" onClick={() => void pick()}>
              <IconImage size={15} />
            </button>
            <ClaudePicker
              choice={fresh ? studio.state.claude : variant!.claude}
              scope={fresh ? 'new versions' : variant!.name}
              onChange={(patch) => studio.setClaude(fresh ? null : variant!.id, patch)}
            />
            <span className={s.grow} />
            {working && (
              <button className={`${s.roundBtn} ${s.roundStop}`} title="Stop" onClick={() => studio.stop(variant!.id)}>
                <IconStop size={12} />
              </button>
            )}
            {fresh ? (
              <button className={`${k.btn} ${k.btnPrimary} ${s.sendWide}`} disabled={!canSend} onClick={() => void submit()}>
                Generate
                <IconArrowUp size={13} />
              </button>
            ) : (
              <button
                className={`${s.roundBtn} ${s.roundSend}`}
                disabled={!canSend}
                title={working ? 'Steer (Enter)' : 'Send (Enter)'}
                onClick={() => void submit()}
              >
                <IconArrowUp size={15} />
              </button>
            )}
          </div>
        </div>
        <p className={s.composerHint}>Enter sends · Shift+Enter for a new line</p>
      </div>
    </div>
  )
}
