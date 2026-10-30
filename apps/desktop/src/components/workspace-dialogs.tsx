import { useEffect, useState } from 'react'
import { TriangleAlert } from 'lucide-react'
import type { Workspace, WorkspaceInspection } from '@acp-harness/protocol'
import { HARNESS_METHODS } from '@acp-harness/protocol'
import { harnessRequest } from '@/daemon-connection'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { t } from '@/i18n/i18n'

// Shaped after Orca's DeleteWorktreeDialog (with its dirty-change hint) and WorktreeMetaDialog.
// The new-workspace composer lives in sidebar/NewWorkspaceDialog.

function lossText(modified: number, untracked: number): string {
  if (modified > 0 && untracked > 0) {
    return t('{modified} modified and {untracked} untracked files will be lost.', { modified, untracked })
  }
  if (modified > 0) {
    return modified === 1 ? t('{n} modified file will be lost.', { n: modified }) : t('{n} modified files will be lost.', { n: modified })
  }
  return untracked === 1 ? t('{n} untracked file will be lost.', { n: untracked }) : t('{n} untracked files will be lost.', { n: untracked })
}

export function DeleteWorkspaceDialog({
  workspace,
  onClose
}: {
  workspace: Workspace | null
  onClose: () => void
}) {
  const [deleteBranch, setDeleteBranch] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [inspection, setInspection] = useState<WorkspaceInspection | null>(null)
  const dirty = !!inspection && inspection.modifiedFiles + inspection.untrackedFiles > 0

  useEffect(() => {
    setError(null)
    setInspection(null)
    if (workspace?.branch) {
      void harnessRequest(HARNESS_METHODS.workspaceInspect, { workspaceId: workspace.id }).then(setInspection, () => undefined)
    }
  }, [workspace])

  async function remove(force: boolean) {
    if (!workspace) return
    setBusy(true)
    try {
      await harnessRequest(HARNESS_METHODS.workspaceRemove, {
        workspaceId: workspace.id,
        deleteBranch,
        force
      })
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={workspace !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('Delete Workspace')}</DialogTitle>
          <DialogDescription className="break-all">
            {workspace?.scratch
              ? t("Moves the quick chat's folder {path} to the trash and closes its chats.", { path: workspace.path })
              : t('Removes the worktree at {path}.', { path: workspace?.path })}
          </DialogDescription>
        </DialogHeader>
        {(dirty || !!inspection?.unpushedCommits) && (
          <div
            className="flex gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-2.5 text-xs text-foreground"
            data-delete-warning
          >
            <TriangleAlert className="mt-px size-3.5 shrink-0 text-destructive" />
            <div className="space-y-0.5">
              {dirty && (
                <p>{lossText(inspection!.modifiedFiles, inspection!.untrackedFiles)}</p>
              )}
              {!!inspection?.unpushedCommits && (
                <p>
                  {inspection.unpushedCommits === 1
                    ? t('{n} commit is not on upstream or the base branch; the branch keeps them unless it is deleted.', { n: 1 })
                    : t('{n} commits are not on upstream or the base branch; the branch keeps them unless it is deleted.', {
                        n: inspection.unpushedCommits
                      })}
                </p>
              )}
            </div>
          </div>
        )}
        {workspace?.branch && (
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={deleteBranch} onCheckedChange={(v) => setDeleteBranch(v === true)} />
            {(() => {
              const [before, after] = t('Also delete branch {branch} if merged').split('{branch}')
              return (
                <>
                  {before}
                  <code className="font-mono text-xs">{workspace.branch}</code>
                  {after}
                </>
              )
            })()}
          </label>
        )}
        {error && (
          <p className="text-sm break-words text-destructive">
            {error} {t('Force delete discards uncommitted changes.')}
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t('Cancel')}
          </Button>
          {error || dirty ? (
            <Button variant="destructive" disabled={busy} onClick={() => void remove(true)}>
              {t('Force Delete')}
            </Button>
          ) : (
            <Button variant="destructive" disabled={busy} onClick={() => void remove(false)}>
              {t('Delete Workspace')}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Orca's "Workspace details" (the Update item): display name and notes. */
export function UpdateWorkspaceDialog({
  workspace,
  onClose
}: {
  workspace: Workspace | null
  onClose: () => void
}) {
  const [displayName, setDisplayName] = useState('')
  const [comment, setComment] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setDisplayName(workspace?.displayName ?? workspace?.name ?? '')
    setComment(workspace?.comment ?? '')
    setError(null)
  }, [workspace])

  async function save() {
    if (!workspace) return
    try {
      await harnessRequest(HARNESS_METHODS.workspaceUpdate, {
        workspaceId: workspace.id,
        patch: {
          // Typing the original name back clears the override.
          displayName: displayName.trim() === workspace.name ? '' : displayName,
          comment
        }
      })
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <Dialog open={workspace !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('Workspace details')}</DialogTitle>
          <DialogDescription className="break-all">{workspace?.path}</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault()
            void save()
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="workspace-display-name" className="text-xs font-medium text-muted-foreground">
              {t('Display name')}
            </Label>
            <Input
              id="workspace-display-name"
              autoFocus
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="workspace-comment" className="text-xs font-medium text-muted-foreground">
              {t('Notes')}
            </Label>
            <textarea
              id="workspace-comment"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder={t('What is this workspace for?')}
              className="min-h-20 w-full resize-y rounded-md border border-input bg-background px-2.5 py-1.5 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring dark:bg-input/30"
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {t('Cancel')}
            </Button>
            <Button type="submit">{t('Save')}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
