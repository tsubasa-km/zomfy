import { useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { HARNESS_METHODS, unboundedLoops, type Workflow } from '@acp-harness/protocol'
import { harnessRequest } from '@/daemon-connection'
import type { HostId } from '@/session-store'
import { createExternalStore } from '@/stores/external-store'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'

// Before a run of a workflow whose loops nothing caps, the person says it may go round as long as it
// takes. Every start asks, whether from the composer or the Lead's run_workflow, unless the person
// ticked "don't ask again" for that workflow.

interface Ask {
  workflow: Workflow
  loops: string[]
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
  if (!workflow || workflow.skipLoopConfirm) return true
  const loops = unboundedLoops(workflow).map((c) => c.label)
  if (loops.length === 0) return true
  const answer = queue.then(
    () =>
      new Promise<{ start: boolean; quiet: boolean }>((resolve) =>
        store.set({ workflow, loops, task, by, done: (start, quiet) => resolve({ start, quiet }) })
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
          <DialogTitle>Start “{ask.workflow.name}”?</DialogTitle>
          <DialogDescription>
            {ask.by === 'lead' ? 'The Lead wants to start it. ' : ''}
            These loops have no round limit, so the run keeps going round until they finish. A loop that gets stuck is handed up to
            rethink, but nothing caps how long that takes.
          </DialogDescription>
        </DialogHeader>
        <ul className="space-y-1 text-sm">
          {ask.loops.map((label) => (
            <li key={label} className="flex items-center gap-2">
              <RefreshCw className="size-3.5 shrink-0 text-primary" />
              <span className="truncate">{label}</span>
            </li>
          ))}
        </ul>
        {ask.task && <p className="line-clamp-3 rounded-md bg-muted px-2.5 py-1.5 text-xs text-muted-foreground">{ask.task}</p>}
        <div className="flex items-center gap-2">
          <Checkbox id="workflow-start-quiet" checked={quiet} onCheckedChange={(v) => setQuiet(v === true)} data-workflow-start-quiet />
          <Label htmlFor="workflow-start-quiet" className="text-sm font-normal">
            Don't ask again for this workflow
          </Label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => answer(false)}>
            Cancel
          </Button>
          <Button onClick={() => answer(true)} data-workflow-start-go>
            Start
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
