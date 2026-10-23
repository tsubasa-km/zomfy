import { useState } from 'react'
import { Check, Pencil, Workflow as WorkflowIcon, X } from 'lucide-react'
import { HARNESS_METHODS, type Workflow } from '@acp-harness/protocol'
import { harnessRequest } from '@/daemon-connection'
import type { HostId } from '@/session-store'
import { openWorkflows } from '@/stores/workflows-store'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'

// Picks one of the project's workflows for the next message: sent with one picked, the message is
// the run's task and the harness runs the workflow instead of this chat taking a turn.

export interface WorkflowHome {
  hostId: HostId
  projectId: string | null
  projectName: string
}

export function NativeChatWorkflowPicker({
  home,
  picked,
  onPick
}: {
  home: WorkflowHome
  picked: Pick<Workflow, 'id' | 'name'> | null
  onPick: (workflow: Pick<Workflow, 'id' | 'name'> | null) => void
}) {
  const [workflows, setWorkflows] = useState<Workflow[] | null>(null)
  if (!home.projectId) return null
  const projectId = home.projectId

  return (
    <DropdownMenu
      onOpenChange={(open) => {
        if (open) {
          void harnessRequest(HARNESS_METHODS.workflowsList, { projectId }, home.hostId).then(setWorkflows, () => setWorkflows([]))
        }
      }}
    >
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={picked ? `Workflow: ${picked.name}` : 'Run a workflow'}
          data-native-chat-workflow={picked?.id ?? ''}
          className={cn(
            'flex h-7 max-w-48 items-center gap-1 rounded-md px-1.5 text-xs transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
            picked ? 'bg-accent text-accent-foreground' : 'text-chat-foreground-faint'
          )}
        >
          <WorkflowIcon className="size-3.5 shrink-0" />
          {picked ? <span className="truncate">{picked.name}</span> : null}
          {picked ? (
            <X
              className="size-3 shrink-0 opacity-70 hover:opacity-100"
              aria-label="Clear the workflow"
              onPointerDown={(e) => {
                e.preventDefault()
                e.stopPropagation()
                onPick(null)
              }}
            />
          ) : null}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuLabel className="text-xs text-muted-foreground">Run a workflow on this message</DropdownMenuLabel>
        {workflows === null && <div className="px-2 py-1.5 text-xs text-muted-foreground">Loading…</div>}
        {workflows?.length === 0 && <div className="px-2 py-1.5 text-xs text-muted-foreground">No workflows in this project yet.</div>}
        {workflows?.map((w) => (
          <DropdownMenuItem key={w.id} onSelect={() => onPick(picked?.id === w.id ? null : { id: w.id, name: w.name })}>
            <span className="min-w-0 flex-1 truncate">{w.name}</span>
            {picked?.id === w.id && <Check className="size-3.5" />}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => openWorkflows({ hostId: home.hostId, projectId, projectName: home.projectName })}>
          <Pencil className="size-3.5" />
          Edit workflows…
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
