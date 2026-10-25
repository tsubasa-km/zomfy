import { HardDrive, Pencil, Plus } from 'lucide-react'
import { chatAgentLabel, type WorkflowAgentProfile } from '@acp-harness/protocol'
import { TuiAgentIcon } from '@/components/terminal/TuiAgentIcon'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'

// Every agent defined on the host, used by a step or not, to open for editing (or deleting) or to add.

export function WorkflowAgentsDialog({
  agents,
  onEdit,
  onNew,
  onClose
}: {
  agents: WorkflowAgentProfile[]
  onEdit: (agent: WorkflowAgentProfile) => void
  onNew: () => void
  onClose: () => void
}) {
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md" data-workflow-agents-dialog>
        <DialogHeader>
          <DialogTitle>Agents</DialogTitle>
          <DialogDescription>Defined once on this host for every workflow. Steps that use one follow its changes.</DialogDescription>
        </DialogHeader>
        {agents.length === 0 ? (
          <p className="text-sm text-muted-foreground">None yet.</p>
        ) : (
          <ul className="max-h-80 space-y-1 overflow-y-auto">
            {agents.map((a) => (
              <li key={a.id} className="flex items-center gap-2 rounded px-1.5 py-1 hover:bg-accent">
                <TuiAgentIcon agent={a.agent ?? 'claude'} size={14} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm">{a.name}</div>
                  <div className="truncate text-[11px] text-muted-foreground">
                    {a.kind === 'review' ? 'Reviews' : 'Does the work'} · {chatAgentLabel(a.agent ?? 'claude')}
                    {a.model ? ` · ${a.model}` : ''}
                  </div>
                </div>
                {a.local && <HardDrive className="size-3.5 shrink-0 text-muted-foreground" aria-label="Local model" />}
                <Button variant="ghost" size="icon" className="size-7" aria-label={`Edit ${a.name}`} onClick={() => onEdit(a)}>
                  <Pencil className="size-3.5" />
                </Button>
              </li>
            ))}
          </ul>
        )}
        <Button variant="outline" size="sm" className="w-fit" onClick={onNew}>
          <Plus className="size-3.5" />
          New agent
        </Button>
      </DialogContent>
    </Dialog>
  )
}
