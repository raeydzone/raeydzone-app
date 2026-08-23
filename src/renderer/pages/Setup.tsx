import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import mascot from '../assets/mascot.png'
import { useStore } from '../state/store'
import type { RootProposal } from '@shared/types'
import { IconFolder } from '../components/Icons'
import p from './pages.module.css'
import ui from '../styles/ui.module.css'

export default function Setup(): ReactNode {
  const { run, refresh } = useStore()
  const [proposal, setProposal] = useState<RootProposal | null>(null)
  const [chosen, setChosen] = useState<string | null>(null)

  useEffect(() => {
    void window.raeydzone.proposeRoot().then((res) => {
      setProposal(res)
      setChosen(res.path)
    })
  }, [])

  const browse = async (): Promise<void> => {
    const picked = await run(() => window.raeydzone.pickRoot())
    if (picked) setChosen(picked)
  }

  const confirm = async (): Promise<void> => {
    if (!chosen) return
    const ok = await run(() => window.raeydzone.setRoot(chosen), 'Root folder set')
    if (ok) await refresh()
  }

  const onOneDrive = /onedrive/i.test(chosen ?? '')

  return (
    <div className={p.setup}>
      <div className={p.setupCard}>
        <img className={p.setupMascot} src={mascot} alt="" />
        <div>
          <h1 className={ui.title}>Pick your RaeydZone folder</h1>
          <p className={ui.sub}>
            Everything RaeydZone manages — videos, streams, thumbnails, footage — lives
            inside one folder.
          </p>
        </div>

        <div className={p.pathBox}>{chosen ?? '…'}</div>

        {onOneDrive && (
          <p className={p.warn}>
            That folder is inside OneDrive. Pick one outside it — footage would upload to
            the cloud.
          </p>
        )}
        {proposal?.isRemovable && chosen === proposal.path && (
          <p className={p.warn}>This drive is removable. Footage will fill it fast.</p>
        )}

        <div className={ui.row}>
          <button className={ui.btn} onClick={browse}>
            <IconFolder />
            Browse…
          </button>
          <button
            className={`${ui.btn} ${ui.btnPrimary}`}
            onClick={confirm}
            disabled={!chosen || onOneDrive}
          >
            Use this folder
          </button>
        </div>

        <p className={ui.faint}>
          {proposal?.exists
            ? 'This folder already exists — RaeydZone will adopt what is inside it.'
            : 'This folder will be created, with Videos and Streams inside.'}
        </p>
      </div>
    </div>
  )
}
