import { useEffect } from 'react'
import { ExternalLink } from 'lucide-react'
import { allProjects, allWorkspaces, useStore } from '@/session-store'
import { loadWorkflowRuns, useWorkflowRuns, type HostedWorkflowRun } from '@/stores/workflow-runs-store'
import { openWorkflows } from '@/stores/workflows-store'
import { RUN_STATUS_CLASSES, RUN_STATUS_LABELS } from '@/components/workflows/workflow-run-status'
import { relativeTime } from './checks/review-presentation'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { t } from '@/i18n/i18n'

// The Workflows tab: this project's workflow runs, the ones going on first, each opening its run view.

/** Older ended runs are under Workflows → History. */
const RECENT_LIMIT = 20

export function WorkflowsPanel({ workspaceId }: { workspaceId: string }) {
  // Primitives only: allWorkspaces and allProjects build new objects on every call.
  const hostId = useStore((s) => allWorkspaces(s).find((w) => w.id === workspaceId)?.hostId ?? '')
  const projectId = useStore((s) => allWorkspaces(s).find((w) => w.id === workspaceId)?.projectId ?? null)
  const projectName = useStore((s) => allProjects(s.hosts).find((p) => p.id === projectId)?.name ?? '')
  // A comparison's runs are read together in its own view.
  const runs = useWorkflowRuns(hostId, projectId ?? '').filter((r) => !r.experimentId)

  useEffect(() => {
    if (hostId && projectId) void loadWorkflowRuns(hostId, projectId).catch(() => undefined)
  }, [hostId, projectId])

  if (!projectId) {
    return <p className="p-4 text-xs text-muted-foreground">{t('A quick chat belongs to no project, so it has no workflows.')}</p>
  }

  const open = (runId?: string) => openWorkflows({ hostId, projectId, projectName, ...(runId ? { runId } : {}) })
  const active = runs.filter((r) => r.status === 'running' || r.status === 'waiting')
  // Waiting first: those stand still until the person answers.
  active.sort((a, b) => Number(b.status === 'waiting') - Number(a.status === 'waiting'))
  const ended = runs.filter((r) => r.status !== 'running' && r.status !== 'waiting').slice(0, RECENT_LIMIT)

  return (
    // Room at the bottom for the window's floating layout button.
    <div className="min-h-0 flex-1 overflow-y-auto pb-14 text-xs" data-workflows-panel>
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground">{projectName}</span>
        <Button variant="ghost" size="sm" className="h-6 gap-1 px-1.5 text-[11px]" onClick={() => open()}>
          <ExternalLink className="size-3.5" />
          {t('Open Workflows')}
        </Button>
      </div>
      {runs.length === 0 ? (
        <p className="p-4 text-muted-foreground">{t('No runs yet. Start a workflow from a chat (the workflow button under the message box).')}</p>
      ) : (
        <>
          {active.length > 0 && <RunList title={t('In progress')} runs={active} onOpen={open} />}
          {ended.length > 0 && <RunList title={t('Recent')} runs={ended} onOpen={open} />}
        </>
      )}
    </div>
  )
}

function RunList({ title, runs, onOpen }: { title: string; runs: HostedWorkflowRun[]; onOpen: (runId: string) => void }) {
  return (
    <section className="border-b border-border py-1">
      <h3 className="px-3 pt-2 pb-1 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">{title}</h3>
      <ul>
        {runs.map((run) => (
          <li key={run.id}>
            <RunRow run={run} onOpen={() => onOpen(run.id)} />
          </li>
        ))}
      </ul>
    </section>
  )
}

function RunRow({ run, onOpen }: { run: HostedWorkflowRun; onOpen: () => void }) {
  const live = run.status === 'running' || run.status === 'waiting'
  const step = live ? run.workflow.nodes.find((n) => n.id === run.currentNodeId)?.label : undefined
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full flex-col gap-0.5 px-3 py-1.5 text-left hover:bg-accent/60"
      data-workflows-panel-run={run.status}
    >
      <div className="flex w-full items-center gap-2">
        <span className="min-w-0 flex-1 truncate font-medium">{run.workflow.name}</span>
        <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">
          {relativeTime(new Date(run.endedAt ?? run.createdAt).toISOString())}
        </span>
      </div>
      <div className="w-full truncate text-muted-foreground">{run.task}</div>
      <div className="flex w-full items-center gap-1.5 text-[11px]">
        <span className={cn('shrink-0 font-medium', RUN_STATUS_CLASSES[run.status])}>{RUN_STATUS_LABELS[run.status]}</span>
        {step && <span className="min-w-0 truncate text-muted-foreground">· {step}</span>}
      </div>
      {run.status === 'waiting' && run.waiting?.question && (
        <div className="line-clamp-2 w-full text-[11px] text-agent-question-text">{run.waiting.question}</div>
      )}
    </button>
  )
}
