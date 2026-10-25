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

// Changes Claude proposes from the workflow's last runs; the person picks which to make, here or in
// a variant to compare against the original.

function ChangeDetail({ workflow, change }: { workflow: Workflow; change: WorkflowChange }) {
  const label = (id: string) => workflow.nodes.find((n) => n.id === id)?.label ?? '?'
  if (change.type === 'prompt') {
    const before = workflow.nodes.find((n) => n.id === change.nodeId)?.config.prompt?.trim()
    return (
      <div className="space-y-1 text-[11px]">
        <div className="text-muted-foreground">Instructions of “{label(change.nodeId)}”</div>
        {before && <p className="line-clamp-3 rounded bg-destructive/5 px-2 py-1 whitespace-pre-wrap text-muted-foreground line-through">{before}</p>}
        <p className="rounded bg-status-success/10 px-2 py-1 whitespace-pre-wrap">{change.prompt}</p>
      </div>
    )
  }
  if (change.type === 'maxRounds') {
    const before = workflow.nodes.find((n) => n.id === change.nodeId)?.config.maxRounds
    return (
      <p className="text-[11px] text-muted-foreground">
        Round limit of “{label(change.nodeId)}”: {before ?? 'none'} → {change.maxRounds ?? 'none'}
      </p>
    )
  }
  if (change.type === 'skills') {
    return (
      <p className="text-[11px] text-muted-foreground">
        “{label(change.nodeId)}” no longer sees the skill {change.removed} ({change.skills.length} left)
      </p>
    )
  }
  if (change.type === 'denyMcp') {
    return (
      <p className="text-[11px] text-muted-foreground">
        “{label(change.nodeId)}” goes without the MCP server {change.server}
      </p>
    )
  }
  const edge = workflow.edges.find((e) => e.id === change.edgeId)
  return (
    <p className="text-[11px] text-muted-foreground">
      Arrow “{edge ? label(edge.from) : '?'}” → “{edge ? label(edge.to) : '?'}” ({edge ? outcomeLabel(edge.outcome) : '?'}):{' '}
      {change.on ? 'continue in the same chat' : 'a fresh session with a summary'}
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
  onApply: (next: Workflow, asVariant: boolean) => void
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

  const apply = (asVariant: boolean) => {
    if (!result) return
    const next = result.suggestions.filter((s) => picked.includes(s.id)).reduce((w, s) => applyWorkflowChange(w, s.change), workflow)
    onApply(next, asVariant)
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl" data-workflow-suggest-dialog>
        <DialogHeader>
          <DialogTitle>Suggested changes</DialogTitle>
          <DialogDescription>
            From the last runs of “{workflow.name}”. Apply them as a variant and compare it with the original before keeping them.
          </DialogDescription>
        </DialogHeader>
        {!result && !error && (
          <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Reading the last runs…
          </div>
        )}
        {error && <p className="text-sm text-destructive">{error}</p>}
        {result && (
          <div className="space-y-4">
            {result.assessment && <p className="text-sm">{result.assessment}</p>}
            {result.suggestions.length === 0 ? (
              <p className="text-xs text-muted-foreground">No change suggested from {result.runIds.length} run(s).</p>
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
            Close
          </Button>
          {result && result.suggestions.length > 0 && (
            <>
              <Button variant="outline" disabled={picked.length === 0} onClick={() => apply(false)}>
                Apply here
              </Button>
              <Button disabled={picked.length === 0} onClick={() => apply(true)} data-workflow-suggest-variant>
                Apply as a variant
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
