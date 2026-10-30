import { useCallback, useEffect, useRef, useState } from 'react'
import { HARNESS_METHODS, type FileBinaryContent } from '@acp-harness/protocol'
import { harnessRequest } from '@/daemon-connection'
import type { EditorTab } from '@/session-store'
import { DropdownMenuItem } from '@/components/ui/dropdown-menu'
import { EditorPanelHeader } from './EditorPanelHeader'
import { ImageViewer } from './ImageViewer'
import { PdfViewer } from './PdfViewer'
import { imageMimeType } from './editor-file-kind'
import { useFileDiskWatch } from './use-file-disk-watch'
import { t } from '@/i18n/i18n'

/** Image and PDF tabs: read-only, reloaded whenever the file changes on disk. */
export function BinaryFileView({ tab, kind }: { tab: EditorTab; kind: 'image' | 'pdf' }): React.JSX.Element {
  const [file, setFile] = useState<FileBinaryContent | null>(null)
  const [error, setError] = useState<string | null>(null)
  const mtime = useRef<number | undefined>(undefined)

  const load = useCallback(async () => {
    setError(null)
    try {
      const content = await harnessRequest(HARNESS_METHODS.fsReadBinary, { workspaceId: tab.workspaceId, path: tab.path })
      mtime.current = content.mtimeMs
      setFile(content)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [tab.workspaceId, tab.path])

  useEffect(() => {
    void load()
  }, [load])

  useFileDiskWatch({
    workspaceId: tab.workspaceId,
    path: tab.path,
    knownMtimeMs: mtime,
    enabled: file !== null,
    onChange: (stat) => {
      if (stat.exists) void load()
    }
  })

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-editor-surface" data-editor-tab={tab.id}>
      <EditorPanelHeader
        workspaceId={tab.workspaceId}
        path={tab.path}
        status={
          error && (
            <span className="min-w-0 truncate text-xs text-destructive" title={error}>
              {error}
            </span>
          )
        }
        menuItems={<DropdownMenuItem onSelect={() => void load()}>{t('Reload from Disk')}</DropdownMenuItem>}
      />
      <div className="min-h-0 flex-1">
        {file ? (
          kind === 'pdf' ? (
            <PdfViewer base64={file.base64} filePath={tab.path} />
          ) : (
            <ImageViewer
              base64={file.base64}
              mimeType={imageMimeType(tab.path) ?? 'image/png'}
              filePath={tab.path}
              size={file.size}
            />
          )
        ) : (
          !error && <div className="flex h-full items-center justify-center text-sm text-muted-foreground">{t('Loading preview...')}</div>
        )}
      </div>
    </div>
  )
}
