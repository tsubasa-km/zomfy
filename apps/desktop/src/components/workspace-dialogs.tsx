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

// Shaped after Orca's DeleteWorktreeDialog (with its dirty-change hint) and WorktreeMetaDialog.
// The new-workspace composer lives in sidebar/NewWorkspaceDialog.

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
          <DialogTitle>Delete Workspace</DialogTitle>
          <DialogDescription className="break-all">
            {workspace?.scratch
              ? `Moves the quick chat's folder ${workspace.path} to the trash and closes its chats.`
              : `Removes the worktree at ${workspace?.path}.`}
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
                <p>
                  {inspection!.modifiedFiles > 0 && `${inspection!.modifiedFiles} modified`}
                  {inspection!.modifiedFiles > 0 && inspection!.untrackedFiles > 0 && ' and '}
                  {inspection!.untrackedFiles > 0 && `${inspection!.untrackedFiles} untracked`}
                  {' '}
                  {inspection!.modifiedFiles + inspection!.untrackedFiles === 1 ? 'file' : 'files'} will be lost.
                </p>
              )}
              {!!inspection?.unpushedCommits && (
                <p>
                  {inspection.unpushedCommits} {inspection.unpushedCommits === 1 ? 'commit is' : 'commits are'} not on
                  upstream or the base branch; the branch keeps them unless it is deleted.
                </p>
              )}
            </div>
          </div>
        )}
        {workspace?.branch && (
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={deleteBranch} onCheckedChange={(v) => setDeleteBranch(v === true)} />
            Also delete branch <code className="font-mono text-xs">{workspace.branch}</code> if merged
          </label>
        )}
        {error && (
          <p className="text-sm break-words text-destructive">
            {error} Force delete discards uncommitted changes.
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          {error || dirty ? (
            <Button variant="destructive" disabled={busy} onClick={() => void remove(true)}>
              Force Delete
            </Button>
          ) : (
            <Button variant="destructive" disabled={busy} onClick={() => void remove(false)}>
              Delete Workspace
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
          <DialogTitle>Workspace details</DialogTitle>
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
              Display name
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
              Notes
            </Label>
            <textarea
              id="workspace-comment"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="What is this workspace for?"
              className="min-h-20 w-full resize-y rounded-md border border-input bg-background px-2.5 py-1.5 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring dark:bg-input/30"
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit">Save</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
