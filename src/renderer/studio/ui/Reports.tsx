import * as Dialog from '@radix-ui/react-dialog'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { formatStamp } from '@shared/format'
import { CLAUDE_MODELS } from '@shared/studio'
import type { FeatureReport } from '@shared/studio'
import { IconCheck, IconCopy, IconFlag, IconRefresh, IconTrash } from '../../components/Icons'
import { useStore } from '../../state/store'
import { Segmented } from './fields'
import c from '../../components/components.module.css'
import k from '../../styles/soft.module.css'
import s from './insights.module.css'

const modelName = (id: string): string => CLAUDE_MODELS.find((m) => m.id === id)?.label ?? id

function markdown(list: FeatureReport[]): string {
  return list
    .map((r) =>
      [
        `## ${r.title}${r.count > 1 ? ` (hit ${r.count}×)` : ''}`,
        `${r.kind === 'bug' ? 'Bug' : 'Missing feature'} · ${r.project} · ${modelName(r.model)} · ${formatStamp(r.lastAt)}`,
        '',
        r.detail,
        r.workaround ? `\nWorkaround used: ${r.workaround}` : ''
      ].join('\n')
    )
    .join('\n\n')
}

function Report({ report, onDone, onRemove }: { report: FeatureReport; onDone: () => void; onRemove: () => void }): ReactNode {
  return (
    <motion.div
      layout
      className={`${s.report} ${report.done ? s.reportDone : ''}`}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: -12 }}
      transition={{ duration: 0.16, ease: [0.22, 0.61, 0.36, 1] }}
    >
      <div className={s.reportHead}>
        <span className={`${s.kind} ${report.kind === 'bug' ? s.kindBug : ''}`}>{report.kind === 'bug' ? 'Bug' : 'Missing'}</span>
        <span className={s.reportTitle}>{report.title}</span>
        {report.count > 1 && <span className={s.count} title="How often Claude hit this gap">{report.count}×</span>}
        <button className={k.iconBtn} title={report.done ? 'Reopen' : 'Mark as built'} onClick={onDone}>
          {report.done ? <IconRefresh size={14} /> : <IconCheck size={14} />}
        </button>
        <button className={k.iconBtn} title="Delete" onClick={onRemove}>
          <IconTrash size={14} />
        </button>
      </div>
      <p className={s.reportText}>{report.detail}</p>
      {report.workaround && (
        <p className={s.reportWork}>
          <span>Workaround</span> {report.workaround}
        </p>
      )}
      <span className={s.reportMeta}>
        {report.project} · {modelName(report.model)} · {formatStamp(report.lastAt)}
      </span>
    </motion.div>
  )
}

export function ReportsButton(): ReactNode {
  const { notify } = useStore()
  const [reports, setReports] = useState<FeatureReport[]>([])
  const [view, setView] = useState<'open' | 'done'>('open')
  const studio = window.raeydzone.studio

  useEffect(() => {
    void studio.reports().then(setReports).catch(() => {})
    return studio.onReports(setReports)
  }, [studio])

  const open = reports.filter((r) => !r.done)
  const shown = view === 'open' ? open : reports.filter((r) => r.done)

  const act = (fn: () => Promise<FeatureReport[]>): void => {
    fn().then(setReports).catch((err: Error) => notify(err.message, 'bad'))
  }

  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(`# RaeydZone studio — missing features\n\n${markdown(open)}\n`)
      notify(`Copied ${open.length} ${open.length === 1 ? 'report' : 'reports'}`)
    } catch (err) {
      notify('Could not copy: ' + (err as Error).message, 'bad')
    }
  }

  return (
    <Dialog.Root>
      <Dialog.Trigger className={`${k.pill} ${s.flagPill}`} title="What Claude could not do with the current tools">
        <IconFlag size={13} />
        <span>Missing features</span>
        {open.length > 0 && <span className={s.badge}>{open.length}</span>}
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className={c.overlay} />
        <Dialog.Content className={`${c.modal} ${s.reports}`}>
          <Dialog.Title className={c.modalTitle}>Missing features</Dialog.Title>
          <Dialog.Description className={c.modalText}>
            When the studio cannot do what a request needs, Claude flags the gap here. Repeats of the same gap count up
            instead of piling on. Copy the open ones to get them built.
          </Dialog.Description>
          <div className={s.reportsBar}>
            <Segmented
              value={view}
              onChange={setView}
              options={[
                { id: 'open', label: `Open · ${open.length}` },
                { id: 'done', label: `Built · ${reports.length - open.length}` }
              ]}
            />
            <button className={k.btn} disabled={!open.length} onClick={() => void copy()}>
              <IconCopy size={14} />
              Copy as Markdown
            </button>
          </div>
          <div className={s.reportList}>
            {shown.length === 0 && (
              <p className={s.empty}>
                {view === 'open' ? 'Nothing flagged yet — Claude has had every tool it needed.' : 'Nothing marked as built yet.'}
              </p>
            )}
            <AnimatePresence initial={false}>
              {shown.map((r) => (
                <Report
                  key={r.id}
                  report={r}
                  onDone={() => act(() => studio.setReportDone(r.id, !r.done))}
                  onRemove={() => act(() => studio.removeReport(r.id))}
                />
              ))}
            </AnimatePresence>
          </div>
          <div className={c.modalActions}>
            <Dialog.Close asChild>
              <button className={`${k.btn} ${k.btnGhost}`}>Close</button>
            </Dialog.Close>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
