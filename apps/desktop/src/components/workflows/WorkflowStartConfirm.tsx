import { useState } from 'react'
import { RefreshCw, TriangleAlert } from 'lucide-react'
import { HARNESS_METHODS, unboundedLoops, type Workflow } from '@acp-harness/protocol'
import { harnessRequest } from '@/daemon-connection'
import { allWorkspaces, type HostId } from '@/session-store'
import { createExternalStore } from '@/stores/external-store'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { t } from '@/i18n/i18n'

// Before a run of a workflow whose loops nothing caps, the person says it may go round as long as it
// takes. Every start asks, whether from the composer or a chat's run_workflow, unless the person
// ticked "don't ask again" for that workflow. A start also asks while the project's checkout has
// uncommitted changes, which the run's fresh worktree will not have.

interface Ask {
  workflow: Workflow
  loops: string[]
  /** Uncommitted files in the project's checkout, and its branch. */
  uncommitted: { branch: string | null; paths: string[] }
  task: string
  by: 'you' | 'lead'
  done: (start: boolean, quiet: boolean) => void
}

const store = createExternalStore<Ask | null>(null)
/** One question at a time; later starts wait their turn. */
let queue: Promise<unknown> = Promise.resolve()

/** True when the run may start: no unlimited loop, the workflow skips the question, or the person said yes. */
export async function confirmWorkflowStart(
  hostId: HostId,
  projectId: string,
  workflowId: string,
  task: string,
  by: 'you' | 'lead'
): Promise<boolean> {
  const workflow = (await harnessRequest(HARNESS_METHODS.workflowsList, { projectId }, hostId)).find((w) => w.id === workflowId)
  if (!workflow) return true
  const loops = workflow.skipLoopConfirm ? [] : unboundedLoops(workflow).map((c) => c.label)
  const uncommitted = await uncommittedIn(hostId, projectId)
  if (loops.length === 0 && uncommitted.paths.length === 0) return true
  const answer = queue.then(
    () =>
      new Promise<{ start: boolean; quiet: boolean }>((resolve) =>
        store.set({ workflow, loops, uncommitted, task, by, done: (start, quiet) => resolve({ start, quiet }) })
      )
  )
  queue = answer.catch(() => undefined)
  const { start, quiet } = await answer
  store.set(null)
  if (start && quiet) {
    await harnessRequest(HARNESS_METHODS.workflowSave, { workflow: { ...workflow, skipLoopConfirm: true } }, hostId).catch(() => undefined)
  }
  return start
}

async function uncommittedIn(hostId: HostId, projectId: string): Promise<{ branch: string | null; paths: string[] }> {
  const main = allWorkspaces().find((w) => w.hostId === hostId && w.projectId === projectId && w.isPrimary)
  if (!main) return { branch: null, paths: [] }
  const status = await harnessRequest(HARNESS_METHODS.gitStatus, { workspaceId: main.id }, hostId).catch(() => null)
  if (!status?.isRepo) return { branch: null, paths: [] }
  return { branch: status.branch, paths: [...new Set([...status.staged, ...status.unstaged].map((c) => c.path))] }
}

export function WorkflowStartConfirmDialog() {
  const ask = store.use((a) => a)
  const [quiet, setQuiet] = useState(false)
  if (!ask) return null
  const answer = (start: boolean) => {
    ask.done(start, start && quiet)
    setQuiet(false)
  }
  return (
    <Dialog open onOpenChange={(open) => !open && answer(false)}>
      <DialogContent className="sm:max-w-md" data-workflow-start-confirm>
        <DialogHeader>
          <DialogTitle>{t('Start “{name}”?', { name: ask.workflow.name })}</DialogTitle>
          <DialogDescription>
            {ask.by === 'lead' ? t('A chat wants to start it. ') : ''}
            {ask.loops.length > 0
              ? t(
                  'These loops have no round limit, so the run keeps going round until they finish. A loop that gets stuck is handed up to rethink, but nothing caps how long that takes.'
                )
              : t('The run works in a worktree of its own.')}
          </DialogDescription>
        </DialogHeader>
        {ask.uncommitted.paths.length > 0 && (
          <div className="space-y-1 rounded-md border border-status-warning-border px-3 py-2 text-xs" data-workflow-start-uncommitted>
            <p className="flex items-center gap-1.5 font-medium text-foreground">
              <TriangleAlert className="size-3.5 shrink-0 text-status-warning" />
              {ask.uncommitted.branch
                ? t('Uncommitted changes in {branch} stay behind', { branch: ask.uncommitted.branch })
                : t('Uncommitted changes in the project stay behind')}
            </p>
            <p className="text-muted-foreground">
              {t('The run starts from the last commit, so it will not see these. Commit them first if the run needs them.')}
            </p>
            <p className="truncate font-mono text-muted-foreground">
              {ask.uncommitted.paths.slice(0, 4).join(', ')}
              {ask.uncommitted.paths.length > 4 ? t(' and {n} more', { n: ask.uncommitted.paths.length - 4 }) : ''}
            </p>
          </div>
        )}
        <ul className="space-y-1 text-sm">
          {ask.loops.map((label) => (
            <li key={label} className="flex items-center gap-2">
              <RefreshCw className="size-3.5 shrink-0 text-primary" />
              <span className="truncate">{label}</span>
            </li>
          ))}
        </ul>
        {ask.task && <p className="line-clamp-3 rounded-md bg-muted px-2.5 py-1.5 text-xs text-muted-foreground">{ask.task}</p>}
        {ask.loops.length > 0 && (
          <div className="flex items-center gap-2">
            <Checkbox id="workflow-start-quiet" checked={quiet} onCheckedChange={(v) => setQuiet(v === true)} data-workflow-start-quiet />
            <Label htmlFor="workflow-start-quiet" className="text-sm font-normal">
              {t("Don't ask again for this workflow")}
            </Label>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => answer(false)}>
            {t('Cancel')}
          </Button>
          <Button onClick={() => answer(true)} data-workflow-start-go>
            {t('Start')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
