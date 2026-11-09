import { toast } from 'sonner'
import { HARNESS_METHODS, type WorkflowRun } from '@acp-harness/protocol'
import { harnessRequest } from '@/daemon-connection'
import type { HostId } from '@/session-store'
import { WINDOW_ROLE } from '@/lib/window-role'
import { upsertWorkflowRun } from '@/stores/workflow-runs-store'
import { t } from '@/i18n/i18n'

// A workflow run that was interrupted (a step failed, the app or its daemon closed under it) is
// offered back: a toast with Resume, once as it happens and again when a host connects, until the
// person resumes it or says not now. Only the main window asks.

const DISMISSED_KEY = 'acp-harness.dismissed-run-toasts.v1'
/** One toast per run per window. */
const shown = new Set<string>()

function dismissed(): Set<string> {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(DISMISSED_KEY) ?? '[]')
    return new Set(Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : [])
  } catch {
    return new Set()
  }
}

function dismiss(runId: string): void {
  try {
    // The newest few hundred are plenty: older runs are long gone from anyone's mind.
    localStorage.setItem(DISMISSED_KEY, JSON.stringify([...dismissed(), runId].slice(-300)))
  } catch {
    // Storage can be unavailable; the toast may then come back next time.
  }
}

/** Picks the run up again where it ended; says so if the host will not. */
export async function resumeWorkflowRun(hostId: HostId, runId: string): Promise<boolean> {
  try {
    upsertWorkflowRun(hostId, await harnessRequest(HARNESS_METHODS.workflowRunResume, { runId }, hostId))
    toast.dismiss(`run-interrupted-${runId}`)
    return true
  } catch (error) {
    toast.error(t('The run did not resume'), { description: error instanceof Error ? error.message : String(error) })
    return false
  }
}

function offer(hostId: HostId, run: WorkflowRun): void {
  if (WINDOW_ROLE !== 'main' || shown.has(run.id) || dismissed().has(run.id)) return
  shown.add(run.id)
  const id = `run-interrupted-${run.id}`
  toast.warning(t('Workflow "{name}" was interrupted', { name: run.workflow.name }), {
    id,
    duration: Number.POSITIVE_INFINITY,
    description: run.endReason ?? t('The app or its host closed while it ran.'),
    action: { label: t('Resume'), onClick: () => void resumeWorkflowRun(hostId, run.id) },
    cancel: { label: t('Not now'), onClick: () => dismiss(run.id) }
  })
}

/** A run a host reported changing: an interruption is offered back at once. */
export function noteRunChange(hostId: HostId, run: WorkflowRun): void {
  upsertWorkflowRun(hostId, run)
  if (run.interrupted) offer(hostId, run)
  else toast.dismiss(`run-interrupted-${run.id}`)
}

/** On connecting to a host: the runs it holds that were interrupted while no window watched. */
export async function offerInterruptedRuns(hostId: HostId): Promise<void> {
  if (WINDOW_ROLE !== 'main') return
  // An older daemon does not know the method; it simply offers nothing.
  const runs = await harnessRequest(HARNESS_METHODS.workflowRunsInterrupted, {}, hostId).catch(() => [])
  for (const run of runs.slice(0, 5)) {
    upsertWorkflowRun(hostId, run)
    offer(hostId, run)
  }
}
