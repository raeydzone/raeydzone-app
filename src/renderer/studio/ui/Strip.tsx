import { motion } from 'motion/react'
import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import { IconClose, IconCopy, IconPlus } from '../../components/Icons'
import type { Studio, VariantState } from '../engine'
import { drawDoc } from '../render'
import s from './studio.module.css'

function Preview({ studio, variant }: { studio: Studio; variant: VariantState }): ReactNode {
  const ref = useRef<HTMLCanvasElement>(null)
  const tick = studio.state.tick
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      const c = ref.current
      if (!c) return
      const g = c.getContext('2d')!
      g.setTransform(c.width / variant.doc.width, 0, 0, c.height / variant.doc.height, 0, 0)
      drawDoc(g, variant.doc, studio.assets)
    })
    return () => cancelAnimationFrame(id)
  }, [studio, variant.doc, tick])
  return <canvas ref={ref} className={s.cardCanvas} width={224} height={126} />
}

export function Strip({
  studio,
  activeId,
  generating,
  onPick,
  onNew,
  onBlank,
  onDiscard
}: {
  studio: Studio
  activeId: string | null
  generating: boolean
  onPick: (id: string) => void
  onNew: () => void
  onBlank: () => void
  onDiscard: (id: string) => void
}): ReactNode {
  const variants = studio.state.variants
  return (
    <div className={s.strip}>
      {variants.map((v) => (
        <motion.div
          key={v.id}
          layout
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.18 }}
          className={`${s.card} ${v.id === activeId && !generating ? s.cardOn : ''}`}
          whileHover={{ y: -2 }}
          onClick={() => onPick(v.id)}
        >
          <Preview studio={studio} variant={v} />
          <div className={s.cardFoot}>
            <span className={`${s.statusDot} ${s['status_' + v.status]}`} />
            <span className={s.cardName}>{v.name}</span>
            <button
              className={s.cardAction}
              title="Duplicate this version to try something else"
              onClick={(e) => {
                e.stopPropagation()
                onPick(studio.duplicateVariant(v.id).id)
              }}
            >
              <IconCopy size={11} />
            </button>
            <button
              className={s.cardAction}
              title="Discard this version"
              onClick={(e) => {
                e.stopPropagation()
                onDiscard(v.id)
              }}
            >
              <IconClose size={9} />
            </button>
          </div>
        </motion.div>
      ))}
      <div className={s.stripActions}>
        <button className={`${s.stripBtn} ${generating ? s.stripBtnOn : ''}`} onClick={onNew}>
          <IconPlus size={14} />
          New versions
        </button>
        <button className={s.stripBtn} onClick={onBlank}>
          Blank canvas
        </button>
      </div>
    </div>
  )
}
