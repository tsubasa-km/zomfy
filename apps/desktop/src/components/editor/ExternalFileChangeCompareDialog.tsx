import { useEffect, useState } from 'react'
import { HARNESS_METHODS } from '@acp-harness/protocol'
import { harnessRequest } from '@/daemon-connection'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { MonacoDiffView } from './MonacoDiffView'
import { useEditorPreferences } from './editor-preferences'
import { t } from '@/i18n/i18n'

/** Orca's ExternalFileChangeCompareDialog: the newer disk content against the tab's unsaved buffer. */
export function ExternalFileChangeCompareDialog({
  workspaceId,
  path,
  currentContent,
  onClose,
  onReload,
  onKeepEdits
}: {
  workspaceId: string
  path: string
  currentContent: string
  onClose: () => void
  onReload: () => void
  onKeepEdits: () => void
}): React.JSX.Element {
  const [disk, setDisk] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const prefs = useEditorPreferences()

  useEffect(() => {
    void harnessRequest(HARNESS_METHODS.fsRead, { workspaceId, path })
      .then((file) => setDisk(file.content))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
  }, [workspaceId, path])

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex h-[80vh] max-w-[90vw] flex-col gap-3 sm:max-w-[90vw]">
        <DialogHeader>
          <DialogTitle>{t('Compare with Disk')}</DialogTitle>
          <DialogDescription>{t('Left is the newer content on disk; right is your unsaved edits.')}</DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-hidden rounded-md border border-border">
          {error && <p className="p-3 text-xs text-destructive">{error}</p>}
          {disk !== null && (
            <MonacoDiffView
              modelKey={`${workspaceId}/${path}#compare`}
              original={disk}
              modified={currentContent}
              sideBySide
              editable={false}
              wordWrap={prefs.diffWordWrap}
              showWhitespace={prefs.diffShowWhitespace}
              collapseUnchanged={false}
            />
          )}
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              onClose()
              onReload()
            }}
          >
            {t('Reload from Disk')}
          </Button>
          <Button
            size="sm"
            onClick={() => {
              onClose()
              onKeepEdits()
            }}
          >
            {t('Keep My Edits')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
