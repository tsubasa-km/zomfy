import { toast } from 'sonner'
import { useStore } from '@/session-store'
import { confirmNonGitFolder, useNonGitFolderRequest } from '@/lib/project-dialogs'
import { addFolderProject } from '@/lib/project-add-completion'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { t } from '@/i18n/i18n'

/** Orca's NonGitFolderDialog: a folder outside git is only added once the user accepts what it lacks. */
export function NonGitFolderDialog() {
  const request = useNonGitFolderRequest()
  const hostLabel = useStore((s) => (request ? (s.hosts[request.hostId]?.label ?? request.hostId) : ''))

  function confirm() {
    if (!request) return
    void addFolderProject(request.hostId, request.path).catch((e: unknown) =>
      toast.error(t('Failed to add folder'), { description: e instanceof Error ? e.message : String(e) })
    )
    confirmNonGitFolder(null)
  }

  return (
    <Dialog open={request !== null} onOpenChange={(o) => !o && confirmNonGitFolder(null)}>
      <DialogContent className="max-w-sm sm:max-w-sm" showCloseButton={false} data-non-git-folder-dialog>
        <DialogHeader>
          <DialogTitle className="text-sm">{t('Open as Folder')}</DialogTitle>
          <DialogDescription className="text-xs">
            {t("This folder isn't a Git repository. You'll have the editor, terminal, and search, but Git-based features won't be available.")}
            <span className="mt-2 block">{t('This path was checked on {host}.', { host: hostLabel })}</span>
          </DialogDescription>
        </DialogHeader>
        {request ? (
          <div className="rounded-md border border-border/70 bg-muted/35 px-3 py-2 text-xs">
            <div className="break-all text-muted-foreground">{request.path}</div>
          </div>
        ) : null}
        <DialogFooter>
          <Button variant="outline" onClick={() => confirmNonGitFolder(null)}>
            {t('Cancel')}
          </Button>
          <Button onClick={confirm} data-non-git-folder-confirm>
            {t('Open as Folder')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
