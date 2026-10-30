import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import {
  HARNESS_METHODS,
  applyWorkflowChange,
  type Workflow,
  type WorkflowChange,
  type WorkflowSuggestions
} from '@acp-harness/protocol'
import { harnessRequest } from '@/daemon-connection'
import type { HostId } from '@/session-store'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { outcomeLabel } from './workflow-model'
import { t } from '@/i18n/i18n'

// Changes Claude proposes from the workflow's last runs; the person picks which to make, here or in
// a variant to compare against the original.

function ChangeDetail({ workflow, change }: { workflow: Workflow; change: WorkflowChange }) {
  const label = (id: string) => workflow.nodes.find((n) => n.id === id)?.label ?? '?'
  if (change.type === 'prompt') {
    const before = workflow.nodes.find((n) => n.id === change.nodeId)?.config.prompt?.trim()
    return (
      <div className="space-y-1 text-[11px]">
        <div className="text-muted-foreground">{t('Instructions of “{name}”', { name: label(change.nodeId) })}</div>
        {before && <p className="line-clamp-3 rounded bg-destructive/5 px-2 py-1 whitespace-pre-wrap text-muted-foreground line-through">{before}</p>}
        <p className="rounded bg-status-success/10 px-2 py-1 whitespace-pre-wrap">{change.prompt}</p>
      </div>
    )
  }
  if (change.type === 'maxRounds') {
    const before = workflow.nodes.find((n) => n.id === change.nodeId)?.config.maxRounds
    return (
      <p className="text-[11px] text-muted-foreground">
        {t('Round limit of “{name}”: {before} → {after}', { name: label(change.nodeId), before: before ?? t('none'), after: change.maxRounds ?? t('none') })}
      </p>
    )
  }
  const edge = workflow.edges.find((e) => e.id === change.edgeId)
  return (
    <p className="text-[11px] text-muted-foreground">
      {t('Arrow “{from}” → “{to}” ({outcome}):', {
        from: edge ? label(edge.from) : '?',
        to: edge ? label(edge.to) : '?',
        outcome: edge ? outcomeLabel(edge.outcome) : '?'
      })}{' '}
      {change.on ? t('continue in the same chat') : t('a fresh session with a summary')}
    </p>
  )
}

export function WorkflowSuggestDialog({
  hostId,
  workflow,
  onApply,
  onClose
}: {
  hostId: HostId
  /** The saved workflow the runs were of. */
  workflow: Workflow
  /** here: into the open workflow; variant: as a new unsaved one; compare: saved as a variant and compared with this one. */
  onApply: (next: Workflow, how: 'here' | 'variant' | 'compare') => void
  onClose: () => void
}) {
  const [result, setResult] = useState<WorkflowSuggestions | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [picked, setPicked] = useState<string[]>([])

  useEffect(() => {
    let live = true
    harnessRequest(HARNESS_METHODS.workflowSuggest, { projectId: workflow.projectId, workflowId: workflow.id }, hostId)
      .then((r) => {
        if (!live) return
        setResult(r)
        setPicked(r.suggestions.map((s) => s.id))
      })
      .catch((e: unknown) => live && setError(e instanceof Error ? e.message : String(e)))
    return () => {
      live = false
    }
  }, [hostId, workflow.id, workflow.projectId])

  const apply = (how: 'here' | 'variant' | 'compare') => {
    if (!result) return
    const next = result.suggestions.filter((s) => picked.includes(s.id)).reduce((w, s) => applyWorkflowChange(w, s.change), workflow)
    onApply(next, how)
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl" data-workflow-suggest-dialog>
        <DialogHeader>
          <DialogTitle>{t('Suggested changes')}</DialogTitle>
          <DialogDescription>
            {t('From the last runs of “{name}”. “Compare as a variant” saves them as a copy and opens a comparison with the original.', { name: workflow.name })}
          </DialogDescription>
        </DialogHeader>
        {!result && !error && (
          <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            {t('Reading the last runs…')}
          </div>
        )}
        {error && <p className="text-sm text-destructive">{error}</p>}
        {result && (
          <div className="space-y-4">
            {result.assessment && <p className="text-sm">{result.assessment}</p>}
            {result.suggestions.length === 0 ? (
              <p className="text-xs text-muted-foreground">{t('No change suggested from {n} run(s).', { n: result.runIds.length })}</p>
            ) : (
              <ul className="space-y-3">
                {result.suggestions.map((s) => (
                  <li key={s.id} className="flex gap-2" data-workflow-suggestion={s.change.type}>
                    <Checkbox
                      className="mt-0.5"
                      checked={picked.includes(s.id)}
                      onCheckedChange={(on) => setPicked((all) => (on === true ? [...all, s.id] : all.filter((id) => id !== s.id)))}
                    />
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="text-sm font-medium">{s.title}</div>
                      {s.reason && <p className="text-xs text-muted-foreground">{s.reason}</p>}
                      <ChangeDetail workflow={workflow} change={s.change} />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t('Close')}
          </Button>
          {result && result.suggestions.length > 0 && (
            <>
              <Button variant="outline" disabled={picked.length === 0} onClick={() => apply('here')}>
                {t('Apply here')}
              </Button>
              <Button variant="outline" disabled={picked.length === 0} onClick={() => apply('variant')} data-workflow-suggest-variant>
                {t('Apply as a variant')}
              </Button>
              <Button disabled={picked.length === 0} onClick={() => apply('compare')} data-workflow-suggest-compare>
                {t('Compare as a variant')}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
