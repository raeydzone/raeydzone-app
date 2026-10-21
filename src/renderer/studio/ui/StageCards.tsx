import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { StudioDoc } from '@shared/studio'
import { ctx2d } from '../assets'
import { diagnose } from '../doctor'
import { downscale } from '../exporter'
import type { Issue } from '../doctor'
import type { Studio } from '../engine'
import { renderDoc } from '../render'
import s from './studio.module.css'

const SIZES = [
  { w: 320, label: 'Home feed · 320px' },
  { w: 210, label: 'Suggested · 210px' }
]

function PreviewCard({ studio, doc }: { studio: Studio; doc: StudioDoc }): ReactNode {
  const refs = useRef<(HTMLCanvasElement | null)[]>([])
  const tick = studio.state.tick
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      const full = renderDoc(doc, studio.assets)
      const dpr = window.devicePixelRatio || 1
      SIZES.forEach((size, i) => {
        const c = refs.current[i]
        if (!c) return
        const w = Math.round(size.w * dpr)
        const h = Math.round((w * doc.height) / doc.width)
        c.width = w
        c.height = h
        const g = ctx2d(c)
        g.drawImage(downscale(full, w, h), 0, 0)
        const pad = 4 * dpr
        g.font = `600 ${11 * dpr}px "Segoe UI", sans-serif`
        const tw = g.measureText('12:34').width + 8 * dpr
        const bh = 16 * dpr
        g.fillStyle = 'rgba(0, 0, 0, 0.8)'
        g.beginPath()
        g.roundRect(w - pad - tw, h - pad - bh, tw, bh, 4 * dpr)
        g.fill()
        g.fillStyle = '#ffffff'
        g.textBaseline = 'middle'
        g.fillText('12:34', w - pad - tw + 4 * dpr, h - pad - bh / 2)
      })
    })
    return () => cancelAnimationFrame(id)
  }, [doc, tick, studio])
  return (
    <div className={s.stageCard}>
      <div className={s.stageCardHead}>How it reads small</div>
      {SIZES.map((size, i) => (
        <figure key={size.w} className={s.previewFig}>
          <canvas ref={(el) => void (refs.current[i] = el)} className={s.previewCanvas} style={{ width: size.w }} />
          <figcaption className={s.hint}>{size.label}</figcaption>
        </figure>
      ))}
    </div>
  )
}

function DoctorCard({ studio, variantId, doc }: { studio: Studio; variantId: string; doc: StudioDoc }): ReactNode {
  const [issues, setIssues] = useState<Issue[] | null>(null)
  const tick = studio.state.tick
  useEffect(() => {
    const t = setTimeout(() => setIssues(diagnose(doc, studio.assets)), 500)
    return () => clearTimeout(t)
  }, [doc, tick, studio])
  return (
    <div className={s.stageCard}>
      <div className={s.stageCardHead}>
        Design doctor
        {issues && <span className={s.hint}>{issues.length ? `${issues.length} to look at` : 'All clear'}</span>}
      </div>
      {issues?.length === 0 && <p className={s.hint}>Readable, clear of the overlays, faces uncovered.</p>}
      <div className={s.issueList}>
        {issues?.map((issue) => (
          <button
            key={issue.id}
            className={`${s.issue} ${issue.level === 'warn' ? s.issueWarn : ''}`}
            disabled={!issue.layer}
            onClick={() => issue.layer && studio.select(variantId, issue.layer)}
          >
            <span className={s.issueTitle}>{issue.title}</span>
            <span className={s.hint}>{issue.detail}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

export function StageCards({
  studio,
  variantId,
  doc,
  preview,
  doctor
}: {
  studio: Studio
  variantId: string
  doc: StudioDoc
  preview: boolean
  doctor: boolean
}): ReactNode {
  return (
    <div className={s.stageCards}>
      <AnimatePresence>
        {[preview && 'preview', doctor && 'doctor'].filter(Boolean).map((id) => (
          <motion.div
            key={id as string}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ duration: 0.16, ease: 'easeOut' }}
          >
            {id === 'preview' ? <PreviewCard studio={studio} doc={doc} /> : <DoctorCard studio={studio} variantId={variantId} doc={doc} />}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  )
}
