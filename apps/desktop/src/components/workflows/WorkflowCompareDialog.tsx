import { useState } from 'react'
import { toast } from 'sonner'
import { HARNESS_METHODS, workflowScorecard, type Workflow, type WorkflowExperiment } from '@acp-harness/protocol'
import { useWorkflowRuns } from '@/stores/workflow-runs-store'
import { formatTokens } from './WorkflowRunScorecard'
import { harnessRequest } from '@/daemon-connection'
import type { HostId } from '@/session-store'
import { upsertWorkflowExperiment } from '@/stores/workflow-experiments-store'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'

// Starts a comparison: one task through the chosen saved workflows, a few trials each.

export function WorkflowCompareDialog({
  hostId,
  projectId,
  workflows,
  initial,
  onClose,
  onStarted
}: {
  hostId: HostId
  projectId: string
  /** Saved workflows; only those can run. */
  workflows: Workflow[]
  /** Picked to begin with (the one in the editor). */
  initial: string[]
  onClose: () => void
  onStarted: (experiment: WorkflowExperiment) => void
}) {
  const [task, setTask] = useState('')
  const [picked, setPicked] = useState<string[]>(initial.filter((id) => workflows.some((w) => w.id === id)))
  const [trials, setTrials] = useState(2)
  const [parallel, setParallel] = useState(1)
  const [autoApprove, setAutoApprove] = useState(false)
  const [busy, setBusy] = useState(false)
  const [withoutSkills, setWithoutSkills] = useState<string[]>([])
  const history = useWorkflowRuns(hostId, projectId)
  // The skills each picked workflow's last run carried in every Claude turn: what a "without skills" arm saves.
  const skillTokens = (workflowId: string) => {
    const last = history.find((r) => r.workflowId === workflowId && r.status === 'done' && !r.without)
    const skills = last ? workflowScorecard(last).context.filter((row) => row.kind === 'skill') : []
    return skills.length ? { tokens: skills.reduce((n, r) => n + r.tokens, 0), used: skills.reduce((n, r) => n + (r.used ?? 0), 0) } : null
  }
  const chosen = picked.filter((id) => withoutSkills.includes(id))
  const runs = (picked.length + chosen.length) * trials
  const name = (id: string) => workflows.find((w) => w.id === id)?.name ?? id

  const start = async () => {
    setBusy(true)
    try {
      const experiment = await harnessRequest(
        HARNESS_METHODS.workflowExperimentStart,
        {
          projectId,
          task,
          arms: [
            ...picked.map((workflowId) => ({ workflowId, label: name(workflowId) })),
            ...chosen.map((workflowId) => ({ workflowId, label: `${name(workflowId)} without skills`, without: 'skills' as const }))
          ],
          trials,
          parallel,
          autoApprove
        },
        hostId
      )
      upsertWorkflowExperiment(hostId, experiment)
      onStarted(experiment)
    } catch (error) {
      toast.error('Could not start the comparison', { description: String(error) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg" data-workflow-compare-dialog>
        <DialogHeader>
          <DialogTitle>Compare workflows</DialogTitle>
          <DialogDescription>
            The same task through each workflow, a few times each, side by side. In a git project each run gets a worktree of its own.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-xs">Task</Label>
            <Textarea value={task} onChange={(e) => setTask(e.target.value)} className="min-h-24 text-xs" placeholder="What every run is asked to do" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Workflows</Label>
            <div className="space-y-1">
              {workflows.map((w) => {
                const skills = picked.includes(w.id) ? skillTokens(w.id) : null
                return (
                  <div key={w.id} className="space-y-0.5">
                    <label className="flex items-center gap-2 text-sm">
                      <Checkbox
                        checked={picked.includes(w.id)}
                        onCheckedChange={(on) => setPicked((all) => (on === true ? [...all, w.id] : all.filter((id) => id !== w.id)))}
                      />
                      <span className="truncate">{w.name}</span>
                    </label>
                    {skills && (
                      <label className="flex items-center gap-2 pl-6 text-xs text-muted-foreground" data-workflow-compare-without>
                        <Checkbox
                          checked={withoutSkills.includes(w.id)}
                          onCheckedChange={(on) => setWithoutSkills((all) => (on === true ? [...all, w.id] : all.filter((id) => id !== w.id)))}
                        />
                        Also without skills ({formatTokens(skills.tokens)} tokens a turn, used {skills.used}× in its last run)
                      </label>
                    )}
                  </div>
                )
              })}
            </div>
            <p className="text-[11px] text-muted-foreground">
              Only saved workflows run. Make a variant with “Duplicate as a variant”, or apply a suggestion as one, and change one thing.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Trials each</Label>
              <Input type="number" min={1} max={10} value={trials} onChange={(e) => setTrials(Math.min(10, Math.max(1, Number(e.target.value) || 1)))} className="h-8" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Runs at once</Label>
              <Input type="number" min={1} max={4} value={parallel} onChange={(e) => setParallel(Math.min(4, Math.max(1, Number(e.target.value) || 1)))} className="h-8" />
            </div>
          </div>
          <label className="flex items-start gap-2">
            <Checkbox className="mt-0.5" checked={autoApprove} onCheckedChange={(on) => setAutoApprove(on === true)} data-workflow-compare-auto />
            <span className="space-y-0.5">
              <span className="block text-sm">Approve the steps' commands and edits automatically</span>
              <span className="block text-[11px] text-muted-foreground">
                Otherwise each run waits for you at its first command. Refused for workflows that work in the main checkout or the Lead's
                chat. A run that would wait for your answer ends instead.
              </span>
            </span>
          </label>
          <p className="text-[11px] text-muted-foreground">
            {runs} run{runs === 1 ? '' : 's'}. One trial says little: differences of a few points need many runs to tell from luck.
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => void start()} disabled={busy || !task.trim() || picked.length === 0} data-workflow-compare-start>
            Start {runs} run{runs === 1 ? '' : 's'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
