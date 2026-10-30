import { useEffect, useMemo, useState } from 'react'
import { HARNESS_METHODS, type Workspace } from '@acp-harness/protocol'
import { harnessRequest } from '@/daemon-connection'
import { useStore, type HostedProject } from '@/session-store'
import { setSummaries, useSidebarStore } from '@/stores/sidebar-store'
import { projectLabel, workspaceLabel } from '@/components/sidebar/workspace-visibility'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { t } from '@/i18n/i18n'

// Orca's merged-worktree cleanup: worktrees whose commits are all in the base branch and that have no
// uncommitted changes, offered for deletion together with their branches.

export function CleanupMergedDialog({ project, onClose }: { project: HostedProject | null; onClose: () => void }) {
  const hosts = useStore((s) => s.hosts)
  const summaries = useSidebarStore((s) => s.summaries)
  const [checked, setChecked] = useState<string[]>([])
  const [failed, setFailed] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)

  const candidates = useMemo<Workspace[]>(
    () =>
      project
        ? (hosts[project.hostId]?.harness?.workspaces ?? []).filter(
            (w) => w.projectId === project.id && !w.isPrimary && summaries[w.id]?.merged
          )
        : [],
    [hosts, project, summaries]
  )

  useEffect(() => {
    setFailed({})
    if (!project) return
    // Fresh numbers before offering anything for deletion.
    const ids = hosts[project.hostId]?.harness?.workspaces.map((w) => w.id) ?? []
    void harnessRequest(HARNESS_METHODS.workspaceSummaries, {}, project.hostId).then((list) => {
      setSummaries(ids, list)
      setChecked(list.filter((s) => s.merged).map((s) => s.workspaceId))
    })
    // Refreshed once per opening, not on every summary change.
  }, [project])

  async function cleanUp() {
    setBusy(true)
    const errors: Record<string, string> = {}
    for (const w of candidates.filter((c) => checked.includes(c.id))) {
      try {
        await harnessRequest(HARNESS_METHODS.workspaceRemove, { workspaceId: w.id, deleteBranch: true }, project!.hostId)
      } catch (e) {
        errors[w.id] = e instanceof Error ? e.message : String(e)
      }
    }
    setBusy(false)
    setFailed(errors)
    if (Object.keys(errors).length === 0) onClose()
  }

  return (
    <Dialog open={project !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md" data-cleanup-dialog>
        <DialogHeader>
          <DialogTitle>{t('Clean Up Merged Workspaces')}</DialogTitle>
          <DialogDescription>
            {t(
              'Workspaces in {project} with no commits beyond the base branch and no uncommitted changes. Their worktrees and branches are deleted.',
              { project: project ? projectLabel(project) : '' }
            )}
          </DialogDescription>
        </DialogHeader>
        {candidates.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('Nothing to clean up.')}</p>
        ) : (
          <ul className="max-h-60 space-y-1.5 overflow-y-auto">
            {candidates.map((w) => (
              <li key={w.id}>
                <label className="flex items-start gap-2 text-sm">
                  <Checkbox
                    className="mt-0.5"
                    checked={checked.includes(w.id)}
                    data-cleanup-candidate={w.id}
                    onCheckedChange={(v) => setChecked(v === true ? [...checked, w.id] : checked.filter((id) => id !== w.id))}
                  />
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{workspaceLabel(w)}</span>
                    <span className="block truncate font-mono text-xs text-muted-foreground">{w.branch}</span>
                    {failed[w.id] && <span className="block text-xs break-words text-destructive">{failed[w.id]}</span>}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t('Cancel')}
          </Button>
          <Button
            variant="destructive"
            disabled={busy || candidates.every((c) => !checked.includes(c.id))}
            onClick={() => void cleanUp()}
          >
            {busy ? t('Deleting…') : t('Delete {n}', { n: candidates.filter((c) => checked.includes(c.id)).length })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
