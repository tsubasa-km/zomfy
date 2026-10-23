import { useEffect, useState } from 'react'
import { Check } from 'lucide-react'
import type { WorkflowNodeKind, WorkflowOutcome } from '@acp-harness/protocol'
import { cn } from '@/lib/utils'
import { NODE_KINDS, outcomeLabel } from './workflow-model'
import { STEP_ACCENTS, STEP_ICONS } from './workflow-nodes'

// Shown where a dragged edge was let go: which outcome takes the run along it, and, when it was let
// go on empty canvas, which step to add there.

export interface PendingConnection {
  from: string
  /** null: dropped on empty canvas, so the menu also adds the step. */
  to: string | null
  /** Where the pointer was let go, relative to the canvas. */
  x: number
  y: number
}

export function WorkflowConnectMenu({
  pending,
  fromLabel,
  outcomes,
  used,
  suggested,
  onPick,
  onClose
}: {
  pending: PendingConnection
  fromLabel: string
  outcomes: WorkflowOutcome[]
  /** Outcomes the step already has an edge for. */
  used: Set<WorkflowOutcome>
  suggested: WorkflowOutcome
  onPick: (outcome: WorkflowOutcome, kind: WorkflowNodeKind | null) => void
  onClose: () => void
}) {
  const [outcome, setOutcome] = useState(suggested)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <>
      <div className="absolute inset-0 z-40" onPointerDown={onClose} aria-hidden />
      <div
        role="dialog"
        aria-label="Connect"
        data-workflow-connect-menu
        className="absolute z-50 w-60 rounded-lg border border-border bg-popover p-2 text-popover-foreground shadow-md"
        style={{ left: pending.x + 8, top: pending.y + 8 }}
      >
        <div className="px-1 pb-1.5 text-[11px] text-muted-foreground">
          When <span className="font-medium text-foreground">{fromLabel}</span> ends in
        </div>
        <div className="flex flex-col gap-0.5" role="listbox" aria-label="Outcome">
          {outcomes.map((o) => (
            <button
              key={o}
              type="button"
              role="option"
              aria-selected={outcome === o}
              data-workflow-outcome-option={o}
              className={cn(
                'flex items-center gap-2 rounded px-2 py-1 text-left text-xs hover:bg-accent',
                outcome === o && pending.to === null && 'bg-accent'
              )}
              onClick={() => (pending.to ? onPick(o, null) : setOutcome(o))}
            >
              <span className="flex-1">{outcomeLabel(o)}</span>
              {used.has(o) && <span className="text-[10px] text-muted-foreground">already used</span>}
              {outcome === o && pending.to === null && <Check className="size-3.5" />}
            </button>
          ))}
        </div>
        {pending.to === null && (
          <>
            <div className="mt-2 border-t border-border px-1 pt-2 pb-1 text-[11px] text-muted-foreground">Add a step here</div>
            <div className="grid grid-cols-2 gap-1">
              {NODE_KINDS.map((k) => {
                const Icon = STEP_ICONS[k.kind]
                return (
                  <button
                    key={k.kind}
                    type="button"
                    title={k.hint}
                    data-workflow-add-kind={k.kind}
                    className="flex items-center gap-1.5 rounded border border-border px-2 py-1 text-left text-xs hover:bg-accent"
                    onClick={() => onPick(outcome, k.kind)}
                  >
                    <Icon className={cn('size-3.5 shrink-0', STEP_ACCENTS[k.kind])} />
                    {k.label}
                  </button>
                )
              })}
            </div>
          </>
        )}
      </div>
    </>
  )
}
