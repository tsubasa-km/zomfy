import { useEffect, useMemo, useState } from 'react'
import { HARNESS_METHODS, type CleanupCandidate, type CleanupList, type Workspace } from '@zomfy/protocol'
import { harnessRequest } from '@/daemon-connection'
import { useStore, type HostedProject } from '@/session-store'
import { setSizes } from '@/stores/sidebar-store'
import { projectLabel, workspaceLabel } from '@/components/sidebar/workspace-visibility'
import { formatBytes, sizeLabel } from '@/components/sidebar/workspace-size'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { t } from '@/i18n/i18n'

// Clean up workspaces (spec worktree-skills-and-storage B4): every worktree of the project with its
// state, last activity and size, largest first. Merged ones are checked for deletion; any can have
// its dependencies and build output deleted (Free space). Folders left behind by failed deletes are
// offered too. Nothing with uncommitted, untracked or unpushed work can be deleted from here.

const DAY = 24 * 60 * 60 * 1000

export function CleanupMergedDialog({ project, onClose }: { project: HostedProject | null; onClose: () => void }) {
  const hosts = useStore((s) => s.hosts)
  const [list, setList] = useState<CleanupList | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [checked, setChecked] = useState<string[]>([])
  const [checkedLeftovers, setCheckedLeftovers] = useState<string[]>([])
  const [failed, setFailed] = useState<Record<string, string>>({})
  const [freed, setFreed] = useState<Record<string, number>>({})
  const [busy, setBusy] = useState<string | null>(null)

  const byId = useMemo(() => {
    const map = new Map<string, Workspace>()
    for (const w of project ? (hosts[project.hostId]?.harness?.workspaces ?? []) : []) map.set(w.id, w)
    return map
  }, [hosts, project])

  async function load(selectMerged: boolean) {
    if (!project) return
    try {
      const next = await harnessRequest(HARNESS_METHODS.cleanupList, { projectId: project.id }, project.hostId)
      setList(next)
      setSizes(next.candidates.flatMap((c) => (c.size ? [c.size] : [])))
      if (selectMerged) setChecked(next.candidates.filter(deletable).filter((c) => c.merged).map((c) => c.workspaceId))
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e))
    }
  }

  useEffect(() => {
    setList(null)
    setLoadError(null)
    setFailed({})
    setFreed({})
    setChecked([])
    setCheckedLeftovers([])
    if (project) void load(true)
    // Loaded once per opening.
  }, [project])

  async function deleteChecked() {
    if (!project || !list) return
    setBusy('delete')
    const errors: Record<string, string> = {}
    for (const c of list.candidates.filter((c) => checked.includes(c.workspaceId) && deletable(c))) {
      try {
        await harnessRequest(HARNESS_METHODS.workspaceRemove, { workspaceId: c.workspaceId, deleteBranch: c.merged }, project.hostId)
      } catch (e) {
        errors[c.workspaceId] = e instanceof Error ? e.message : String(e)
      }
    }
    for (const path of checkedLeftovers) {
      try {
        await harnessRequest(HARNESS_METHODS.leftoverRemove, { projectId: project.id, path }, project.hostId)
      } catch (e) {
        errors[path] = e instanceof Error ? e.message : String(e)
      }
    }
    setBusy(null)
    setFailed(errors)
    setChecked([])
    setCheckedLeftovers([])
    if (Object.keys(errors).length === 0) onClose()
    else void load(false)
  }

  async function freeSpace(workspaceId: string) {
    if (!project) return
    setBusy(workspaceId)
    try {
      const { freedBytes } = await harnessRequest(HARNESS_METHODS.workspaceFreeSpace, { workspaceId }, project.hostId)
      setFreed((f) => ({ ...f, [workspaceId]: freedBytes }))
      setFailed(({ [workspaceId]: _gone, ...rest }) => rest)
      await load(false)
    } catch (e) {
      setFailed((f) => ({ ...f, [workspaceId]: e instanceof Error ? e.message : String(e) }))
    } finally {
      setBusy(null)
    }
  }

  const candidates = list?.candidates ?? []
  const leftovers = list?.leftovers ?? []
  const count = candidates.filter((c) => checked.includes(c.workspaceId) && deletable(c)).length + checkedLeftovers.length
  const total = candidates.reduce((sum, c) => sum + (c.size?.total.ownBytes ?? 0), 0)

  return (
    <Dialog open={project !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex max-h-[calc(100vh-2rem)] flex-col sm:max-w-2xl" data-cleanup-dialog>
        <DialogHeader>
          <DialogTitle>{t('Clean up workspaces')}</DialogTitle>
          <DialogDescription>
            {list?.mergeTarget
              ? t('Worktrees of {project}, largest first. Merged means every commit is in {branch} and nothing is uncommitted.', {
                  project: project ? projectLabel(project) : '',
                  branch: list.mergeTarget
                })
              : t('Worktrees of {project}, largest first.', { project: project ? projectLabel(project) : '' })}
            {total > 0 && ` ${t('Together they hold {size} of their own.', { size: formatBytes(total) })}`}
          </DialogDescription>
        </DialogHeader>
        {list?.cacheElsewhere && (
          <p className="rounded-md border border-status-warning-border bg-status-warning-background px-2.5 py-1.5 text-xs" data-cleanup-cache-warning>
            {t("bun's cache ({cache}) is on another drive than the worktrees ({worktrees}), so every worktree gets its own copy of each package instead of a hardlink.", list.cacheElsewhere)}
          </p>
        )}
        {loadError && <p className="text-sm break-words text-destructive">{loadError}</p>}
        {!list && !loadError && <p className="text-sm text-muted-foreground">{t('Measuring…')}</p>}
        {list && candidates.length === 0 && leftovers.length === 0 && <p className="text-sm text-muted-foreground">{t('Nothing to clean up.')}</p>}
        <ul className="min-h-0 space-y-1 overflow-y-auto">
          {candidates.map((c) => {
            const workspace = byId.get(c.workspaceId)
            if (!workspace) return null
            const canDelete = deletable(c)
            return (
              <li key={c.workspaceId} className="flex items-start gap-2 rounded-md px-1 py-1 text-sm hover:bg-muted/40" data-cleanup-row={c.workspaceId}>
                <Checkbox
                  className="mt-0.5"
                  disabled={!canDelete}
                  checked={canDelete && checked.includes(c.workspaceId)}
                  data-cleanup-candidate={c.workspaceId}
                  aria-label={t('Delete {name}', { name: workspaceLabel(workspace) })}
                  onCheckedChange={(v) => setChecked(v === true ? [...checked, c.workspaceId] : checked.filter((id) => id !== c.workspaceId))}
                />
                <span className="min-w-0 flex-1">
                  <span className="flex min-w-0 items-baseline gap-2">
                    <span className="truncate font-medium">{workspaceLabel(workspace)}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">{stateLabel(c)}</span>
                  </span>
                  <span className="block truncate font-mono text-xs text-muted-foreground">{workspace.branch}</span>
                  <span className="block text-xs text-muted-foreground">
                    {[activityLabel(c.lastActivityAt), c.size ? sizeLabel(c.size.total) : t('Not measured yet')].join(' · ')}
                  </span>
                  {freed[c.workspaceId] !== undefined && (
                    <span className="block text-xs text-muted-foreground">{t('Freed {size}', { size: formatBytes(freed[c.workspaceId]!) })}</span>
                  )}
                  {failed[c.workspaceId] && <span className="block text-xs break-words text-destructive">{failed[c.workspaceId]}</span>}
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  className="shrink-0"
                  disabled={busy !== null || c.busy !== null || !c.size || c.size.dependencies.bytes + c.size.build.bytes === 0}
                  title={t('Delete its dependencies and build output; its files and git state stay.')}
                  data-cleanup-free={c.workspaceId}
                  onClick={() => void freeSpace(c.workspaceId)}
                >
                  {busy === c.workspaceId ? t('Freeing…') : t('Free Up Space')}
                </Button>
              </li>
            )
          })}
          {leftovers.map((l) => (
            <li key={l.path} className="flex items-start gap-2 rounded-md px-1 py-1 text-sm hover:bg-muted/40" data-cleanup-leftover={l.path}>
              <Checkbox
                className="mt-0.5"
                checked={checkedLeftovers.includes(l.path)}
                aria-label={t('Delete {name}', { name: l.path })}
                onCheckedChange={(v) => setCheckedLeftovers(v === true ? [...checkedLeftovers, l.path] : checkedLeftovers.filter((p) => p !== l.path))}
              />
              <span className="min-w-0 flex-1">
                <span className="flex min-w-0 items-baseline gap-2">
                  <span className="truncate font-medium">{l.path.split(/[\\/]/).at(-1)}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">{t('Leftover folder')}</span>
                </span>
                <span className="block truncate font-mono text-xs text-muted-foreground">{l.path}</span>
                {l.size && <span className="block text-xs text-muted-foreground">{sizeLabel(l.size)}</span>}
                {failed[l.path] && <span className="block text-xs break-words text-destructive">{failed[l.path]}</span>}
              </span>
            </li>
          ))}
        </ul>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t('Close')}
          </Button>
          <Button variant="destructive" disabled={busy !== null || count === 0} onClick={() => void deleteChecked()}>
            {busy === 'delete' ? t('Deleting…') : t('Delete {n}', { n: count })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Kept always: a worktree in use, or with work that would be lost. */
function deletable(c: CleanupCandidate): boolean {
  return c.busy === null && c.modifiedFiles === 0 && c.untrackedFiles === 0 && (c.unpushedCommits === 0 || c.merged)
}

function stateLabel(c: CleanupCandidate): string {
  if (c.busy === 'turn') return t('A chat is working here')
  if (c.busy === 'terminal') return t('A terminal is running here')
  if (c.modifiedFiles || c.untrackedFiles) return t('Has changes')
  if (c.merged) return t('Merged')
  if (c.unpushedCommits) return t('{n} commits not pushed', { n: c.unpushedCommits })
  return t('Not merged yet')
}

function activityLabel(at: number): string {
  const days = Math.floor((Date.now() - at) / DAY)
  if (days < 1) return t('Active today')
  return t('Idle for {n} days', { n: days })
}
