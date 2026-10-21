import { useEffect, useState } from 'react'
import type { BranchList, Project, Workspace } from '@acp-harness/protocol'
import { HARNESS_METHODS } from '@acp-harness/protocol'
import { createSession, harnessRequest } from '@/daemon-connection'
import { selectWorkspace } from '@/session-store'
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'

// Shaped after Orca's NewWorkspaceComposerModal / DeleteWorktreeDialog: name, base branch,
// optional agent; delete offers the branch alongside the worktree.

const DEFAULT_BASE = '__default__'

export function NewWorkspaceDialog({
  project,
  onClose
}: {
  project: Project | null
  onClose: () => void
}) {
  const [name, setName] = useState('')
  const [baseRef, setBaseRef] = useState(DEFAULT_BASE)
  const [launchClaude, setLaunchClaude] = useState(true)
  const [branches, setBranches] = useState<BranchList | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const isFolder = project?.kind === 'folder'

  useEffect(() => {
    setName('')
    setBaseRef(DEFAULT_BASE)
    setError(null)
    setBranches(null)
    if (project?.kind === 'git') {
      void harnessRequest(HARNESS_METHODS.branchesList, { projectId: project.id }).then(setBranches)
    }
  }, [project])

  async function create() {
    if (!project) return
    setBusy(true)
    setError(null)
    try {
      const workspace = await harnessRequest(HARNESS_METHODS.workspaceCreate, {
        projectId: project.id,
        name: name.trim() || 'workspace',
        ...(baseRef === DEFAULT_BASE ? {} : { baseRef })
      })
      selectWorkspace(workspace.id)
      if (launchClaude) await createSession(workspace.id)
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={project !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex max-h-[calc(100vh-2rem)] flex-col sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{isFolder ? 'Create Folder Workspace' : 'Create Workspace'}</DialogTitle>
          <DialogDescription>
            {isFolder
              ? `A new workspace in ${project?.name}. Folder workspaces share the folder.`
              : `A new git worktree and branch in ${project?.name}.`}
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4 pt-3"
          onSubmit={(e) => {
            e.preventDefault()
            void create()
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="workspace-name" className="text-xs font-medium text-muted-foreground">
              Name
            </Label>
            <Input
              id="workspace-name"
              autoFocus
              placeholder="fix-login-bug"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          {!isFolder && (
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground">Base branch</Label>
              <Select value={baseRef} onValueChange={setBaseRef}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={DEFAULT_BASE}>Default (origin/HEAD, main or master)</SelectItem>
                  {branches?.branches.map((branch) => (
                    <SelectItem key={branch} value={branch}>
                      {branch}
                      {branch === branches.current ? ' (current)' : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={launchClaude} onCheckedChange={(v) => setLaunchClaude(v === true)} />
            Start a Claude session in it
          </label>
          {error && <p className="text-sm break-words text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? 'Creating…' : 'Create'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
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

  useEffect(() => setError(null), [workspace])

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
            Removes the worktree at {workspace?.path}.
          </DialogDescription>
        </DialogHeader>
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
          {error ? (
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
