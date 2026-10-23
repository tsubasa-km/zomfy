import { HardDrive, Pencil, Plus } from 'lucide-react'
import { chatAgentLabel, type WorkflowAgentProfile, type WorkflowNode } from '@acp-harness/protocol'
import { TuiAgentIcon } from '@/components/terminal/TuiAgentIcon'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

// Which defined agent runs a step, or none (the step's own settings). A step using an agent shows
// what the agent brings; its settings are edited on the agent, for every step that uses it.

const OWN = 'own'
const NEW = 'new'

export function WorkflowStepProfileField({
  node,
  agents,
  onPick,
  onEdit,
  onNew
}: {
  node: WorkflowNode
  agents: WorkflowAgentProfile[]
  onPick: (profile: WorkflowAgentProfile | null) => void
  onEdit: (profile: WorkflowAgentProfile) => void
  onNew: () => void
}) {
  const fitting = agents.filter((a) => a.kind === node.kind)
  const current = agents.find((a) => a.id === node.config.profileId)
  const missing = !!node.config.profileId && !current
  return (
    <div className="space-y-1.5" data-workflow-step-profile={current?.id ?? (missing ? 'missing' : OWN)}>
      <Label className="text-xs">Agent</Label>
      <Select
        value={current?.id ?? (missing ? 'missing' : OWN)}
        onValueChange={(v) => {
          if (v === NEW) onNew()
          else onPick(v === OWN ? null : (agents.find((a) => a.id === v) ?? null))
        }}
      >
        <SelectTrigger size="sm" className="h-8 w-full text-xs" aria-label="Agent">
          <SelectValue />
        </SelectTrigger>
        <SelectContent position="popper">
          <SelectItem value={OWN}>This step's own settings</SelectItem>
          {missing && (
            <SelectItem value="missing" disabled>
              (deleted agent)
            </SelectItem>
          )}
          {fitting.map((a) => (
            <SelectItem key={a.id} value={a.id}>
              <TuiAgentIcon agent={a.agent ?? 'claude'} size={14} />
              {a.name}
              {a.local ? ' · local' : ''}
            </SelectItem>
          ))}
          <SelectItem value={NEW}>
            <Plus className="size-3.5" />
            New agent…
          </SelectItem>
        </SelectContent>
      </Select>
      {current && (
        <div className="space-y-1 rounded-md border border-border bg-muted/40 px-2.5 py-2 text-xs" data-workflow-profile-summary>
          <div className="flex items-center gap-1.5">
            <TuiAgentIcon agent={current.agent ?? 'claude'} size={14} />
            <span className="min-w-0 flex-1 truncate font-medium">{current.name}</span>
            {current.local && (
              <span className="flex items-center gap-0.5 text-[11px] text-muted-foreground">
                <HardDrive className="size-3" />
                Local model
              </span>
            )}
          </div>
          <p className="text-[11px] text-muted-foreground">
            Runs on {chatAgentLabel(current.agent ?? 'claude')}
            {current.role?.trim() ? ` as ${current.role.trim()}` : ''}
            {current.tools?.readOnly ? ' · read only' : ''}
          </p>
          {current.prompt?.trim() && <p className="line-clamp-2 text-[11px] text-muted-foreground">{current.prompt.trim()}</p>}
          <Button variant="outline" size="sm" className="h-7" onClick={() => onEdit(current)}>
            <Pencil className="size-3" />
            Edit agent
          </Button>
        </div>
      )}
    </div>
  )
}
