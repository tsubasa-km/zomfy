import { useState } from 'react'
import { ArrowLeft, CircleStop, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { HARNESS_METHODS, workflowScorecard, type Workflow, type WorkflowScorecard } from '@acp-harness/protocol'
import { harnessRequest } from '@/daemon-connection'
import { setProjectExperiments, type HostedWorkflowExperiment } from '@/stores/workflow-experiments-store'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { useWorkflowRuns, type HostedWorkflowRun } from '@/stores/workflow-runs-store'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { formatDuration, formatTokens } from './WorkflowRunScorecard'

// A comparison's results: one row per workflow with its runs' scorecards averaged, and every run
// below to open on its own.

const mean = (values: number[]) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : null)

interface Row {
  armId: string
  name: string
  runs: HostedWorkflowRun[]
  cards: WorkflowScorecard[]
  finished: number
  planned: number
}

function Cell({ value, title }: { value: string; title?: string }) {
  return (
    <td className="px-2 py-1.5 text-right tabular-nums" title={title}>
      {value}
    </td>
  )
}

export function WorkflowExperimentView({
  experiment,
  workflows,
  onOpenRun,
  onBack
}: {
  experiment: HostedWorkflowExperiment
  workflows: Workflow[]
  onOpenRun: (runId: string) => void
  onBack: () => void
}) {
  const [busy, setBusy] = useState(false)
  const all = useWorkflowRuns(experiment.hostId, experiment.projectId).filter((r) => r.experimentId === experiment.id)
  const rows: Row[] = experiment.arms.map((arm) => {
    const slots = experiment.runs.filter((s) => s.armId === arm.id)
    const runs = slots.flatMap((s) => all.filter((r) => r.id === s.runId)).sort((a, b) => a.createdAt - b.createdAt)
    // Arms saved before labels carried the workflow's id.
    const name = arm.label !== arm.workflowId ? arm.label : (workflows.find((w) => w.id === arm.workflowId)?.name ?? runs[0]?.workflow.name ?? 'Deleted workflow')
    return {
      armId: arm.id,
      name,
      runs,
      // Averages are over runs that got the job done: a run that failed early is not cheap, it is unfinished.
      cards: runs.filter((r) => r.status === 'done').map((r) => workflowScorecard(r)),
      finished: runs.filter((r) => r.status !== 'running' && r.status !== 'waiting').length,
      planned: slots.length
    }
  })
  const failedToStart = experiment.runs.filter((s) => s.error)

  const stop = async () => {
    setBusy(true)
    await harnessRequest(HARNESS_METHODS.workflowExperimentStop, { id: experiment.id }, experiment.hostId).catch((error: unknown) =>
      toast.error('Could not stop the comparison', { description: String(error) })
    )
    setBusy(false)
  }

  const remove = async (worktrees: boolean) => {
    setBusy(true)
    try {
      const list = await harnessRequest(HARNESS_METHODS.workflowExperimentRemove, { id: experiment.id, worktrees }, experiment.hostId)
      setProjectExperiments(experiment.hostId, experiment.projectId, list)
      onBack()
    } catch (error) {
      toast.error('Could not delete the comparison', { description: String(error) })
      setBusy(false)
    }
  }

  const avg = (row: Row, pick: (c: WorkflowScorecard) => number, format: (n: number) => string) => {
    const value = mean(row.cards.map(pick))
    return value === null ? '—' : format(value)
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto" data-workflow-experiment={experiment.status}>
      <div className="flex items-center gap-2 border-b border-border px-4 py-2">
        <Button variant="ghost" size="sm" className="-ml-2 h-7" onClick={onBack}>
          <ArrowLeft className="size-3.5" />
          Editor
        </Button>
        <div className="min-w-0 flex-1 truncate text-sm font-medium">Comparison · {experiment.trials} trial{experiment.trials > 1 ? 's' : ''} each</div>
        <span className="text-xs text-muted-foreground">{experiment.status}</span>
        {experiment.status === 'running' && (
          <Button variant="outline" size="sm" className="h-7" disabled={busy} onClick={() => void stop()}>
            <CircleStop className="size-3.5" />
            Stop
          </Button>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="h-7" disabled={busy} aria-label="Delete comparison" data-workflow-experiment-delete>
              <Trash2 className="size-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-72">
            <DropdownMenuItem onSelect={() => void remove(true)}>Delete it, and the worktrees and branches its runs made</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => void remove(false)}>Delete it, keep the worktrees</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <div className="space-y-4 p-4">
        <p className="line-clamp-3 text-xs whitespace-pre-wrap">{experiment.task}</p>
        <table className="w-full text-xs" data-workflow-experiment-table>
          <thead className="text-[11px] text-muted-foreground">
            <tr className="border-b border-border">
              <th className="px-2 py-1.5 text-left font-medium">Workflow</th>
              <th className="px-2 py-1.5 text-right font-medium" title="Runs that ended done, of those finished (planned). The other columns average the done runs.">
                Done
              </th>
              <th className="px-2 py-1.5 text-right font-medium">Time</th>
              <th className="px-2 py-1.5 text-right font-medium" title="Input and output tokens, where the agents report them">Tokens</th>
              <th className="px-2 py-1.5 text-right font-medium">Cost</th>
              <th className="px-2 py-1.5 text-right font-medium" title="Reviews that sent work back, plus failed checks">Rounds</th>
              <th className="px-2 py-1.5 text-right font-medium" title="Share of file reads that re-read what an earlier step had read">Re-read</th>
              <th className="px-2 py-1.5 text-right font-medium" title="Commands an earlier step had already run">Re-run</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const done = row.cards.length
              return (
                <tr key={row.armId} className="border-b border-border/60" data-workflow-experiment-row={row.name}>
                  <td className="max-w-48 truncate px-2 py-1.5 font-medium">{row.name}</td>
                  <Cell value={`${done}/${row.finished} (${row.planned})`} />
                  <Cell value={avg(row, (c) => c.durationMs, formatDuration)} />
                  <Cell value={avg(row, (c) => c.usage.inputTokens + c.usage.outputTokens, (n) => formatTokens(Math.round(n)))} />
                  <Cell
                    value={row.cards.some((c) => c.usage.costUsd !== undefined) ? avg(row, (c) => c.usage.costUsd ?? 0, (n) => `$${n.toFixed(2)}`) : '—'}
                    title="Claude steps only"
                  />
                  <Cell value={avg(row, (c) => c.sentBack + c.checksFailed, (n) => n.toFixed(1))} />
                  <Cell value={avg(row, (c) => (c.reads ? c.rereadAfterHandoff / c.reads : 0), (n) => `${Math.round(n * 100)}%`)} />
                  <Cell value={avg(row, (c) => c.rerunCommands, (n) => n.toFixed(1))} />
                </tr>
              )
            })}
          </tbody>
        </table>
        <p className="text-[11px] text-muted-foreground">
          Averages over the runs that ended done. With a handful of trials only large differences mean much; open the runs to see why they
          differ.
        </p>
        {all.some((r) => r.status === 'failed' && r.endReason) && (
          <ul className="space-y-0.5 text-xs text-muted-foreground" data-workflow-experiment-failures>
            {rows.flatMap((row) =>
              row.runs.flatMap((r, i) =>
                r.status === 'failed' && r.endReason
                  ? [
                      <li key={r.id}>
                        {row.name} #{i + 1}: {r.endReason}
                      </li>
                    ]
                  : []
              )
            )}
          </ul>
        )}
        {failedToStart.length > 0 && (
          <ul className="space-y-0.5 text-xs text-destructive">
            {failedToStart.map((s) => (
              <li key={`${s.armId}-${s.trial}`}>
                {rows.find((r) => r.armId === s.armId)?.name ?? s.armId} #{s.trial}: {s.error}
              </li>
            ))}
          </ul>
        )}
        <div className="space-y-3">
          {rows.map((row) => (
            <div key={row.armId} className="space-y-1">
              <div className="text-xs font-medium">{row.name}</div>
              <div className="flex flex-wrap gap-1.5">
                {row.runs.map((run, i) => (
                  <button
                    key={run.id}
                    type="button"
                    onClick={() => onOpenRun(run.id)}
                    className={cn(
                      'rounded border px-2 py-0.5 text-[11px] hover:bg-accent',
                      run.status === 'done' ? 'border-status-success/50' : run.status === 'failed' ? 'border-destructive/50' : 'border-border'
                    )}
                    data-workflow-experiment-run={run.status}
                    title={run.endReason}
                  >
                    #{i + 1} {run.status}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
