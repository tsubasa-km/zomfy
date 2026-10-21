import { TriangleAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'

// Orca's ExternalFileChangeBanner: shown when another process (usually an agent) rewrites a
// file while the tab holds unsaved edits, so the next save does not silently clobber it.
export function ExternalFileChangeBanner({
  deleted,
  onCompare,
  onReload,
  onKeepEdits
}: {
  deleted: boolean
  onCompare?: () => void
  onReload: () => void
  onKeepEdits: () => void
}): React.JSX.Element {
  return (
    <div role="alert" className="shrink-0 border-b border-status-warning-border bg-status-warning-background px-4 py-2 text-xs">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <TriangleAlert className="size-3.5 shrink-0 text-status-warning" />
          <span className="min-w-0 font-medium text-foreground">
            {deleted
              ? 'This file was deleted on disk while you have unsaved edits. Saving will recreate it.'
              : 'This file changed on disk while you have unsaved edits. Saving will overwrite the newer disk content.'}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {onCompare && !deleted && (
            <Button type="button" size="xs" variant="outline" onClick={onCompare}>
              Compare
            </Button>
          )}
          {!deleted && (
            <Button type="button" size="xs" variant="outline" onClick={onReload}>
              Reload from Disk
            </Button>
          )}
          <Button type="button" size="xs" variant="ghost" onClick={onKeepEdits}>
            Keep My Edits
          </Button>
        </div>
      </div>
    </div>
  )
}
