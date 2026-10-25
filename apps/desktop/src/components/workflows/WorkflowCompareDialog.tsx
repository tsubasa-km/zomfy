import { useState } from 'react'
import { toast } from 'sonner'
import {
  HARNESS_METHODS,
  workflowScorecard,
  type Workflow,
  type WorkflowContextRemoval,
  type WorkflowExperiment
} from '@acp-harness/protocol'
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
  const [autoApprove, setAutoApprove] = useState(true)
  const [busy, setBusy] = useState(false)
  const [removals, setRemovals] = useState<string[]>([])
  const history = useWorkflowRuns(hostId, projectId)
  // What each picked workflow's latest finished run had in context: what a "without" arm can take away.
  const candidates = picked.flatMap((workflowId) => {
    const last = history.find((r) => r.workflowId === workflowId && r.status !== 'running' && r.status !== 'waiting' && !r.without)
    if (!last) return []
    const keep: Record<string, string[]> = {}
    for (const step of last.steps) {
      const skills = (step.context?.items ?? []).filter((i) => i.kind === 'skill').map((i) => i.name)
      if (skills.length) keep[step.nodeId] = skills
    }
    return workflowScorecard(last)
      .context.filter((row) => row.kind === 'skill' || row.kind === 'mcp')
      .map((row) => {
        const without: WorkflowContextRemoval = row.kind === 'skill' ? { kind: 'skill', name: row.name, keep } : { kind: 'mcp', name: row.name }
        return { key: `${workflowId}:${row.kind}:${row.name}`, workflowId, row, without }
      })
  })
  const chosen = candidates.filter((c) => removals.includes(c.key))
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
            ...chosen.map((c) => ({
              workflowId: c.workflowId,
              label: `${name(c.workflowId)} − ${c.row.kind === 'mcp' ? 'MCP ' : ''}${c.row.name}`,
              without: c.without
            }))
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
          <DialogTitle>Compare flows</DialogTitle>
          <DialogDescription>
            The same task through each workflow, a few times each, every run in a worktree of its own. Their scorecards are set side by
            side.
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
              {workflows.map((w) => (
                <label key={w.id} className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={picked.includes(w.id)}
                    onCheckedChange={(on) => setPicked((all) => (on === true ? [...all, w.id] : all.filter((id) => id !== w.id)))}
                  />
                  <span className="truncate">{w.name}</span>
                </label>
              ))}
            </div>
            <p className="text-[11px] text-muted-foreground">Only saved workflows run. Make a variant with Duplicate, then change one thing in it.</p>
          </div>
          {candidates.length > 0 && (
            <div className="space-y-1.5" data-workflow-compare-without>
              <Label className="text-xs">Also try without…</Label>
              <div className="max-h-40 space-y-1 overflow-y-auto">
                {candidates.map((c) => (
                  <label key={c.key} className="flex items-center gap-2 text-xs">
                    <Checkbox
                      checked={removals.includes(c.key)}
                      onCheckedChange={(on) => setRemovals((all) => (on === true ? [...all, c.key] : all.filter((k) => k !== c.key)))}
                    />
                    <span className="min-w-0 flex-1 truncate">
                      {picked.length > 1 && <span className="text-muted-foreground">{name(c.workflowId)} · </span>}
                      {c.row.kind === 'mcp' ? 'MCP ' : 'Skill '}
                      {c.row.name}
                    </span>
                    <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">
                      {formatTokens(c.row.tokens)} · used {c.row.used ?? '—'}
                    </span>
                  </label>
                ))}
              </div>
              <p className="text-[11px] text-muted-foreground">
                Each adds an arm where every step goes without that item (from the workflow's last run). If it does as well with less,
                it is not earning its place.
              </p>
            </div>
          )}
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
                Otherwise each run waits for you at its first command. Every run works in a worktree of its own.
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
