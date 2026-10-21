import { useEffect, useMemo, useState } from 'react'
import { CircleDashed, Mail, MailOpen, Moon, Pin, PinOff, Trash2, X } from 'lucide-react'
import { HARNESS_METHODS, WORKSPACE_STATUSES, type Workspace } from '@acp-harness/protocol'
import { harnessRequest } from '@/daemon-connection'
import { allWorkspaces, useStore } from '@/session-store'
import { clearSelection, setSelection, useSidebarStore } from '@/stores/sidebar-store'
import { WorkspaceStatusIcon } from '@/components/sidebar/WorkspaceStatusIcon'
import { markWorkspaceRead, sleepWorkspace, updateWorkspace } from '@/components/sidebar/WorkspaceMenu'
import { workspaceLabel } from '@/components/sidebar/workspace-visibility'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

// Actions for several multi-selected workspaces (Orca's multi-select context menu and the
// source-control bulk-action-bar).

export function BulkActionBar() {
  const selection = useSidebarStore((s) => s.selection)
  const hosts = useStore((s) => s.hosts)
  const workspaces = useMemo(() => allWorkspaces({ hosts }), [hosts])
  const [deleting, setDeleting] = useState<Workspace[] | null>(null)
  const selected = workspaces.filter((w) => selection.includes(w.id))

  useEffect(() => {
    // Selection of workspaces that went away (deleted elsewhere) is dropped.
    if (selected.length !== selection.length) setSelection(selected.map((w) => w.id))
  }, [selected.length, selection.length])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)) {
        clearSelection()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  if (selected.length < 2) {
    return deleting ? <BulkDeleteDialog workspaces={deleting} onClose={() => setDeleting(null)} /> : null
  }
  const allPinned = selected.every((w) => w.pinned)
  const each = (run: (w: Workspace) => unknown) => selected.forEach(run)

  const action = (label: string, icon: React.ReactNode, run: () => void, id: string) => (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button size="icon-xs" variant="ghost" aria-label={label} data-bulk-action={id} onClick={run}>
          {icon}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="top">{label}</TooltipContent>
    </Tooltip>
  )

  return (
    <>
      <div
        className="mx-2 mb-2 flex items-center gap-0.5 rounded-lg border border-worktree-sidebar-border bg-background px-1.5 py-1 shadow-sm"
        data-bulk-bar
      >
        <span className="min-w-0 flex-1 truncate pl-1 text-xs font-medium tabular-nums">{selected.length} selected</span>
        <DropdownMenu>
          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger asChild>
                <Button size="icon-xs" variant="ghost" aria-label="Set status" data-bulk-action="status">
                  <CircleDashed className="size-3.5" />
                </Button>
              </DropdownMenuTrigger>
            </TooltipTrigger>
            <TooltipContent side="top">Set status</TooltipContent>
          </Tooltip>
          <DropdownMenuContent side="top" align="start">
            {WORKSPACE_STATUSES.map((s) => (
              <DropdownMenuItem
                key={s.id}
                data-bulk-status={s.id}
                onSelect={() => each((w) => updateWorkspace(w.id, { status: s.id }))}
              >
                <WorkspaceStatusIcon status={s.id} />
                {s.label}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => each((w) => updateWorkspace(w.id, { status: null }))}>
              Clear status
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        {action(
          allPinned ? 'Unpin' : 'Pin',
          allPinned ? <PinOff className="size-3.5" /> : <Pin className="size-3.5" />,
          () => each((w) => updateWorkspace(w.id, { pinned: !allPinned })),
          'pin'
        )}
        {action('Mark Read', <MailOpen className="size-3.5" />, () => each((w) => markWorkspaceRead(w.id, true)), 'read')}
        {action('Mark Unread', <Mail className="size-3.5" />, () => each((w) => markWorkspaceRead(w.id, false)), 'unread')}
        {action('Sleep', <Moon className="size-3.5" />, () => each((w) => sleepWorkspace(w.id)), 'sleep')}
        {action(
          'Delete',
          <Trash2 className="size-3.5 text-destructive" />,
          () => setDeleting(selected.filter((w) => !w.isPrimary)),
          'delete'
        )}
        {action('Clear selection', <X className="size-3.5" />, clearSelection, 'clear')}
      </div>
      {deleting && <BulkDeleteDialog workspaces={deleting} onClose={() => setDeleting(null)} />}
    </>
  )
}

/** Deletes several workspaces in turn; failures (usually uncommitted changes) are listed for a forced retry. */
export function BulkDeleteDialog({
  workspaces,
  title = `Delete ${workspaces.length} Workspaces`,
  onClose
}: {
  workspaces: Workspace[]
  title?: string
  onClose: () => void
}) {
  const [deleteBranches, setDeleteBranches] = useState(true)
  const [failed, setFailed] = useState<{ workspace: Workspace; error: string }[]>([])
  const [busy, setBusy] = useState(false)
  const targets = failed.length > 0 ? failed.map((f) => f.workspace) : workspaces

  async function run(force: boolean) {
    setBusy(true)
    const errors: { workspace: Workspace; error: string }[] = []
    for (const workspace of targets) {
      try {
        await harnessRequest(HARNESS_METHODS.workspaceRemove, {
          workspaceId: workspace.id,
          deleteBranch: deleteBranches,
          force
        })
      } catch (e) {
        errors.push({ workspace, error: e instanceof Error ? e.message : String(e) })
      }
    }
    setBusy(false)
    setFailed(errors)
    if (errors.length === 0) {
      clearSelection()
      onClose()
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md" data-bulk-delete-dialog>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {workspaces.length === 0
              ? "A project's own checkout cannot be deleted."
              : 'Removes these worktrees from disk. Folder workspaces are only forgotten.'}
          </DialogDescription>
        </DialogHeader>
        <ul className="max-h-48 space-y-1 overflow-y-auto text-sm">
          {targets.map((w) => (
            <li key={w.id} className="min-w-0">
              <div className="truncate font-medium">{workspaceLabel(w)}</div>
              {w.branch && <div className="truncate font-mono text-xs text-muted-foreground">{w.branch}</div>}
              {failed.find((f) => f.workspace.id === w.id) && (
                <div className="text-xs break-words text-destructive">{failed.find((f) => f.workspace.id === w.id)?.error}</div>
              )}
            </li>
          ))}
        </ul>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={deleteBranches} onCheckedChange={(v) => setDeleteBranches(v === true)} />
          Also delete their branches if merged
        </label>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          {failed.length > 0 ? (
            <Button variant="destructive" disabled={busy} onClick={() => void run(true)}>
              Force Delete {failed.length}
            </Button>
          ) : (
            <Button variant="destructive" disabled={busy || targets.length === 0} onClick={() => void run(false)}>
              {busy ? 'Deleting…' : 'Delete'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
