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
