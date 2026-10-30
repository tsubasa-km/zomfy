import { useState } from 'react'
import { GitMerge } from 'lucide-react'
import { toast } from 'sonner'
import { HARNESS_METHODS } from '@acp-harness/protocol'
import { harnessRequest } from '@/daemon-connection'
import { allWorkspaces, useStore } from '@/session-store'
import { upsertWorkflowRun, type HostedWorkflowRun } from '@/stores/workflow-runs-store'
import { Button } from '@/components/ui/button'
import { t } from '@/i18n/i18n'

/** A done run's next step: its branch merged into the main checkout, where the person works. */
export function WorkflowRunMerge({ run }: { run: HostedWorkflowRun }) {
  const [busy, setBusy] = useState(false)
  const branches = useStore((s) => {
    const workspaces = allWorkspaces(s)
    const from = workspaces.find((w) => w.id === run.workspaceId)
    const into = workspaces.find((w) => w.hostId === run.hostId && w.projectId === run.projectId && w.isPrimary)
    return from && into && from.id !== into.id && from.branch && into.branch ? `${from.branch}\n${into.branch}` : null
  })
  if (run.status !== 'done') return null
  if (run.mergedInto) {
    return (
      <p className="flex items-center gap-1.5 text-xs text-status-success" data-workflow-run-merged>
        <GitMerge className="size-3.5" />
        {t('Merged into {branch}', { branch: run.mergedInto })}
      </p>
    )
  }
  if (!branches) return null
  const [from, into] = branches.split('\n')
  const merge = async () => {
    setBusy(true)
    try {
      upsertWorkflowRun(run.hostId, await harnessRequest(HARNESS_METHODS.workflowRunMerge, { runId: run.id }, run.hostId))
      toast.success(t('Merged into {branch}', { branch: into }), { description: from })
    } catch (error) {
      toast.error(t('Not merged'), { description: error instanceof Error ? error.message : String(error) })
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border border-border px-2 py-1.5 text-xs" data-workflow-run-merge>
      <span className="min-w-0 flex-1 text-muted-foreground">
        {(() => {
          const [before, after] = t('The changes are on {branch}.').split('{branch}')
          return (
            <>
              {before}
              <span className="font-mono text-foreground">{from}</span>
              {after}
            </>
          )
        })()}
      </span>
      <Button size="sm" className="h-7" disabled={busy} onClick={() => void merge()}>
        <GitMerge className="size-3.5" />
        {t('Merge into {branch}', { branch: into })}
      </Button>
    </div>
  )
}
