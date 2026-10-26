import { useEffect, useState } from 'react'
import { CircleStop, ExternalLink, Send, Workflow as WorkflowIcon } from 'lucide-react'
import { toast } from 'sonner'
import { HARNESS_METHODS, type WorkflowRun } from '@acp-harness/protocol'
import { harnessRequest } from '@/daemon-connection'
import type { HostId } from '@/session-store'
import { loadWorkflowRuns, useWorkflowRun } from '@/stores/workflow-runs-store'
import { openWorkflows } from '@/stores/workflows-store'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { outcomeLabel } from '@/components/workflows/workflow-model'
import { WorkflowRunMerge } from '@/components/workflows/WorkflowRunMerge'

// A workflow run started from this chat, live: where it is, each step's outcome, and the person's
// part (an answer, Stop) right here; the full graph opens in the Workflows page.

const STATUS: Record<WorkflowRun['status'], { label: string; tone: string }> = {
  running: { label: 'Running', tone: 'text-primary' },
  waiting: { label: 'Waiting for you', tone: 'text-agent-question-text' },
  done: { label: 'Done', tone: 'text-status-success' },
  failed: { label: 'Failed', tone: 'text-destructive' },
  stopped: { label: 'Stopped', tone: 'text-chat-foreground-faint' }
}

export function NativeChatWorkflowRunCard({
  runId,
  hostId,
  projectId,
  projectName
}: {
  runId: string
  hostId: HostId
  projectId: string | null
  projectName: string
}) {
  const run = useWorkflowRun(runId)
  const [answer, setAnswer] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!run && projectId) void loadWorkflowRuns(hostId, projectId).catch(() => undefined)
  }, [run, hostId, projectId])

  if (!run) {
    return <div className="rounded-lg border border-border px-3 py-2 text-xs text-chat-foreground-faint">Loading the workflow run…</div>
  }
  const current = run.workflow.nodes.find((n) => n.id === run.currentNodeId)
  const live = run.status === 'running' || run.status === 'waiting'

  const act = async (stop: boolean) => {
    setBusy(true)
    try {
      if (stop) await harnessRequest(HARNESS_METHODS.workflowRunStop, { runId: run.id }, run.hostId)
      else {
        await harnessRequest(HARNESS_METHODS.workflowRunAnswer, { runId: run.id, text: answer }, run.hostId)
        setAnswer('')
      }
    } catch (error) {
      toast.error('The run did not take that', { description: String(error) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-2 rounded-lg border border-border bg-chat-composer-surface p-3 text-sm" data-workflow-run-card={run.status}>
      <div className="flex items-center gap-2">
        <WorkflowIcon className="size-4 shrink-0 text-chat-foreground-faint" />
        <span className="min-w-0 flex-1 truncate font-medium">{run.workflow.name}</span>
        <span className={cn('text-xs font-medium', STATUS[run.status].tone)}>{STATUS[run.status].label}</span>
      </div>
      <p className="line-clamp-2 text-xs text-chat-foreground-faint">{run.task}</p>
      <ol className="flex flex-wrap items-center gap-1 text-[11px]">
        {run.steps.map((step) => (
          <li
            key={step.id}
            className={cn(
              'rounded border px-1.5 py-0.5',
              step.error ? 'border-destructive/50 text-destructive' : 'border-border text-chat-foreground-faint',
              step.endedAt === null && 'border-primary text-primary'
            )}
            title={step.summary || undefined}
          >
            {step.label}
            {step.outcome ? ` · ${outcomeLabel(step.outcome)}` : step.endedAt === null ? ' · …' : ''}
          </li>
        ))}
        {live && current && !run.steps.some((s) => s.endedAt === null) && run.status === 'running' && (
          <li className="rounded border border-primary px-1.5 py-0.5 text-primary">{current.label} · …</li>
        )}
      </ol>
      <WorkflowRunMerge run={run} />
      {run.status === 'waiting' && run.waiting && (
        <div className="space-y-1.5 rounded-md border border-agent-question/40 p-2">
          <p className="text-xs whitespace-pre-wrap">{run.waiting.question}</p>
          <Textarea
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            placeholder={run.waiting.reason === 'limit' ? 'A note for the next round, or "stop"' : 'Your answer'}
            className="min-h-16 text-xs"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && answer.trim()) void act(false)
            }}
          />
          <Button size="sm" className="h-7" disabled={busy || !answer.trim()} onClick={() => void act(false)}>
            <Send className="size-3.5" />
            Answer
          </Button>
        </div>
      )}
      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs"
          disabled={!projectId}
          onClick={() => projectId && openWorkflows({ hostId: run.hostId, projectId, projectName, runId: run.id })}
        >
          <ExternalLink className="size-3.5" />
          Open the run
        </Button>
        {live && (
          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" disabled={busy} onClick={() => void act(true)}>
            <CircleStop className="size-3.5" />
            Stop
          </Button>
        )}
      </div>
    </div>
  )
}
