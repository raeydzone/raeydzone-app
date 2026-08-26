import { useEffect, useMemo, useState } from 'react'
import type { DragEvent, ReactNode } from 'react'
import type { ProjectFile } from '@shared/types'
import { formatBytes } from '@shared/format'
import { IconFolder, IconSearch } from './Icons'
import { useStore } from '../state/store'
import s from './components.module.css'
import ui from '../styles/ui.module.css'

const BUCKET_LABEL: Record<string, string> = {
  footage: 'footage',
  assets: 'assets',
  project: 'project'
}

export function FilesPanel({
  kind,
  id
}: {
  kind: 'video' | 'stream'
  id: string
}): ReactNode {
  const { rev, notify } = useStore()
  const [files, setFiles] = useState<ProjectFile[]>([])
  const [query, setQuery] = useState('')
  const api = window.raeydzone

  useEffect(() => {
    let live = true
    api
      .listFiles(kind, id)
      .then((list) => {
        if (live) setFiles(list)
      })
      .catch(() => {
        if (live) setFiles([])
      })
    return () => {
      live = false
    }
  }, [kind, id, rev, api])

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return files
    return files.filter(
      (f) => f.name.toLowerCase().includes(needle) || f.bucket.includes(needle)
    )
  }, [files, query])

  const dragOut = (e: DragEvent, paths: string[]): void => {
    e.preventDefault()
    api.startDrag(paths)
  }

  return (
    <div className={ui.panel}>
      <div className={ui.between} style={{ marginBottom: 'var(--s-3)' }}>
        <div className={ui.sectionTitle} style={{ margin: 0 }}>
          Files · {files.length}
        </div>
        <div className={s.searchField}>
          <IconSearch />
          <input
            className={s.searchInput}
            placeholder="Search files…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      </div>

      {files.length === 0 ? (
        <p className={ui.faint}>Nothing here yet — drop footage or assets above.</p>
      ) : (
        <>
          <div className={s.dragHint}>
            <span>Drag a row straight into Premiere’s project panel.</span>
            {shown.length > 1 && (
              <button
                className={`${ui.btn} ${ui.btnGhost}`}
                draggable
                onDragStart={(e) => dragOut(e, shown.map((f) => f.path))}
                title="Drag all listed files at once"
              >
                Drag all {shown.length}
              </button>
            )}
          </div>

          <div className={s.fileList}>
            {shown.map((file) => (
              <div
                key={file.rel}
                className={s.fileRow}
                draggable
                onDragStart={(e) => dragOut(e, [file.path])}
                onDoubleClick={() =>
                  void api.openFile(file.path).catch((err) => notify(err.message, 'bad'))
                }
                title={file.rel}
              >
                <span className={`${s.fileTag} ${s['kind_' + file.kind] ?? ''}`}>
                  {(file.name.split('.').pop() ?? '?').slice(0, 4)}
                </span>
                <span className={s.fileName}>{file.name}</span>
                <span className={s.fileBucket}>{BUCKET_LABEL[file.bucket] ?? file.bucket}</span>
                <span className={s.fileSize}>{formatBytes(file.size)}</span>
                <button
                  className={s.fileAction}
                  title="Show in Explorer"
                  onClick={() =>
                    void api.showFile(file.path).catch((err) => notify(err.message, 'bad'))
                  }
                >
                  <IconFolder size={14} />
                </button>
              </div>
            ))}
          </div>

          {shown.length === 0 && <p className={ui.faint}>No file matches “{query}”.</p>}
        </>
      )}
    </div>
  )
}
