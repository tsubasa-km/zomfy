import { chatAgentLabel, isChatAgentId, type ChatAgentId } from '@acp-harness/protocol'
import { useChatAgents } from '@/lib/chat-agents'
import type { HostId } from '@/session-store'
import { TuiAgentIcon } from '@/components/terminal/TuiAgentIcon'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

// Which agent runs a step's sessions: Claude, or another agent this host can run over ACP (as a chat can).

export function WorkflowStepAgentField({
  hostId,
  agent,
  onChange
}: {
  hostId: HostId
  agent: ChatAgentId | undefined
  onChange: (agent: ChatAgentId | undefined) => void
}) {
  const { agents } = useChatAgents(hostId)
  const ready = agents.filter((a) => a.id !== 'claude' && a.status === 'ready').map((a) => a.id)
  const current = agent ?? 'claude'
  // A saved choice this host cannot run still shows, so the step does not silently change agent.
  const choices: ChatAgentId[] = ['claude', ...ready, ...(current !== 'claude' && !ready.includes(current) ? [current] : [])]
  return (
    <div className="space-y-1.5" data-workflow-step-agent={current}>
      <Label className="text-xs">Runs on</Label>
      <Select value={current} onValueChange={(v) => isChatAgentId(v) && onChange(v === 'claude' ? undefined : v)}>
        <SelectTrigger size="sm" className="h-8 w-full text-xs" aria-label="Runs on">
          <SelectValue />
        </SelectTrigger>
        <SelectContent position="popper">
          {choices.map((id) => (
            <SelectItem key={id} value={id}>
              <TuiAgentIcon agent={id} size={14} />
              {chatAgentLabel(id)}
              {id !== 'claude' && !ready.includes(id) ? ' (not set up on this host)' : ''}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p className="text-[11px] text-muted-foreground">
        {current === 'claude'
          ? 'Other agents set up on this host (Settings › Agents) can run the step too.'
          : 'The step ends its reply with a JSON verdict. MCP servers and the browser below reach it too; tool rules, read-only and skills apply to Claude only.'}
      </p>
    </div>
  )
}
