import { motion } from 'motion/react'
import type { ReactNode } from 'react'
import { IconExternal } from '../components/Icons'
import { useAppState, useStore } from '../state/store'
import { TOOLS } from '../tools/catalog'
import { EncoderPicker } from '../tools/kit'
import k from '../styles/soft.module.css'
import t from '../tools/tools.module.css'
import ui from '../styles/ui.module.css'

export default function ToolsPage(): ReactNode {
  const { encoder } = useAppState()
  const { run } = useStore()
  const api = window.raeydzone

  return (
    <div className={ui.page}>
      <div className={ui.pageHead}>
        <div>
          <h1 className={ui.title}>Tools</h1>
          <p className={ui.sub}>Each tool opens in its own window that stays on top while you work.</p>
        </div>
      </div>

      <div className={t.grid}>
        {TOOLS.map((tool, i) => (
          <motion.button
            key={tool.id}
            className={t.tile}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            whileHover={{ y: -3 }}
            whileTap={{ scale: 0.985 }}
            transition={{ duration: 0.18, delay: i * 0.04, ease: [0.22, 0.61, 0.36, 1] }}
            onClick={() => void run(() => api.popoutTool(tool.id))}
          >
            <span className={t.tileIcon}>
              <tool.Icon size={20} />
            </span>
            <span className={t.tileOpen}>
              <IconExternal size={15} />
            </span>
            <span className={t.tileTitle}>{tool.title}</span>
            <span className={t.tileBlurb}>{tool.blurb}</span>
            <span className={t.tags}>
              {tool.tags.map((tag) => (
                <span key={tag} className={k.tag}>
                  {tag}
                </span>
              ))}
              {tool.encodes && (
                <span className={`${k.tag} ${t.tagHot}`}>
                  {encoder.running === 'gpu' ? 'GPU' : 'CPU'} encode
                </span>
              )}
            </span>
          </motion.button>
        ))}
      </div>

      <div className={t.encoderCard}>
        <div>
          <div className={t.encoderTitle}>Video encoder</div>
          <p className={t.encoderHint}>
            Used by every tool that encodes video. GPU is lighter on the system; CPU only leaves the
            graphics card free for a game or OBS.
          </p>
        </div>
        <EncoderPicker />
      </div>
    </div>
  )
}
