import { useMemo, useState } from 'react'
import { Plus, Send } from 'lucide-react'
import { createSession, sendPrompt } from '@/daemon-connection'
import { selectSession, useStore } from '@/session-store'
import { submitPrompt } from '@/chat-actions'
import { ClaudeIcon } from '@/components/agent-icons'
import { AgentStateDot } from '@/components/AgentStateDot'
import { SESSION_DOT } from '@/components/sidebar/WorkspaceCardBadges'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

// Orca's NotesSendMenu: hands a prompt (review notes, PR comments) to one of the workspace's agents
// or a new one. A busy agent queues it behind its running turn.

/** Sends `prompt` to an existing session, or a new Claude session when `sessionId` is null. */
export async function sendToAgent(workspaceId: string, sessionId: string | null, prompt: string): Promise<void> {
  if (sessionId) {
    submitPrompt(sessionId, prompt, [])
    selectSession(sessionId)
    return
  }
  const created = await createSession(workspaceId)
  selectSession(created)
  await sendPrompt(created, prompt)
}

export function SendToAgentMenu({
  workspaceId,
  buildPrompt,
  count,
  disabledTooltip = 'All notes sent',
  tooltip = 'Send notes to an agent',
  label,
  onSent,
  className
}: {
  workspaceId: string
  /** Called on select so the prompt reflects the latest state; null means nothing to send. */
  buildPrompt: () => string | null
  count: number
  disabledTooltip?: string
  tooltip?: string
  /** Text next to the icon; icon-only when omitted. */
  label?: string
  onSent?: () => void
  className?: string
}) {
  const all = useStore((s) => s.sessions)
  const sessions = useMemo(() => all.filter((x) => x.workspaceId === workspaceId), [all, workspaceId])
  const [error, setError] = useState<string | null>(null)
  const disabled = count === 0

  function deliver(sessionId: string | null) {
    const prompt = buildPrompt()
    if (!prompt) return
    setError(null)
    void sendToAgent(workspaceId, sessionId, prompt).then(onSent, (e) => setError(e instanceof Error ? e.message : String(e)))
  }

  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild disabled={disabled}>
            <button
              type="button"
              aria-label={disabled ? disabledTooltip : tooltip}
              data-send-to-agent
              className={cn(
                'inline-flex h-6 min-w-6 items-center justify-center gap-1 rounded px-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-40',
                label && 'px-1.5 text-[11px]',
                className
              )}
            >
              <Send className="size-3.5" />
              {label}
            </button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom" sideOffset={6}>
          {error ?? (disabled ? disabledTooltip : tooltip)}
        </TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel className="text-xs text-muted-foreground">Send {count === 1 ? '1 item' : `${count} items`} to</DropdownMenuLabel>
        {sessions.map((s) => (
          <DropdownMenuItem key={s.id} onSelect={() => deliver(s.id)} data-send-target={s.id}>
            <ClaudeIcon size={14} />
            <span className="min-w-0 flex-1 truncate">{s.title}</span>
            <AgentStateDot state={SESSION_DOT[s.status]} size="sm" />
          </DropdownMenuItem>
        ))}
        {sessions.length > 0 && <DropdownMenuSeparator />}
        <DropdownMenuItem onSelect={() => deliver(null)} data-send-target="new">
          <Plus className="size-4" />
          New Claude session
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
