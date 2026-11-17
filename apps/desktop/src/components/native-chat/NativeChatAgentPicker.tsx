import { ChevronDown } from 'lucide-react'
import { chatAgentLabel, type ChatAgentId, type ChatAgentInfo } from '@acp-harness/protocol'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { TuiAgentIcon } from '@/components/terminal/TuiAgentIcon'
import { useChatAgents } from '@/lib/chat-agents'
import type { HostId } from '@/session-store'
import { t } from '@/i18n/i18n'

// The agent behind an existing chat, changeable mid-conversation. The chat stays as it is; the
// daemon hands the new agent a selection of the conversation as text, which the menu says, as it
// is not the previous agent's context moving over. Laid out as the composer's other pickers.

type Choice = Pick<ChatAgentInfo, 'id' | 'label' | 'status' | 'detail'>

/** Claude first, then the host's other installed agents; the chat's own agent is always listed. */
function agentChoices(agents: ChatAgentInfo[], current: ChatAgentId): Choice[] {
  const known = (id: ChatAgentId): Choice => agents.find((a) => a.id === id) ?? { id, label: chatAgentLabel(id), status: 'ready', detail: null }
  const others = agents.filter((a) => a.id !== 'claude' && (a.status !== 'missing' || a.id === current))
  return [known('claude'), ...(current !== 'claude' && !others.some((a) => a.id === current) ? [known(current)] : []), ...others]
}

export function NativeChatAgentPicker({
  hostId,
  current,
  disabledReason,
  onSelect
}: {
  hostId: HostId
  current: ChatAgentId
  /** Why the agent cannot change right now (a turn runs, the host is away), or null. */
  disabledReason: string | null
  onSelect: (agent: ChatAgentId) => void
}) {
  const { agents } = useChatAgents(hostId)
  const choices = agentChoices(agents, current)
  const title = t('Agent')
  const label = chatAgentLabel(current)
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          {/* A disabled button gets no pointer events, so the hint hangs on a wrapper. */}
          <span className="inline-flex min-w-0 shrink">
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="xs"
                data-native-chat-agent-picker={current}
                aria-label={`${title} ${label}`}
                disabled={disabledReason !== null}
                className="max-w-32 min-w-0 shrink"
              >
                <span className="flex shrink-0 items-center">
                  <TuiAgentIcon agent={current} size={12} />
                </span>
                <span className="truncate">{label}</span>
                <ChevronDown className="size-3" />
              </Button>
            </DropdownMenuTrigger>
          </span>
        </TooltipTrigger>
        <TooltipContent side="top" sideOffset={4}>
          {disabledReason ?? title}
        </TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="start" side="top" collisionPadding={8} className="w-72 select-none">
        <DropdownMenuRadioGroup aria-label={title} value={current}>
          {choices.map((choice) => {
            const usable = choice.status === 'ready' || choice.id === current
            return (
              <DropdownMenuRadioItem
                key={choice.id}
                value={choice.id}
                disabled={!usable}
                data-agent-choice={choice.id}
                onSelect={() => usable && choice.id !== current && onSelect(choice.id)}
              >
                <div className="flex min-w-0 items-center gap-2 py-0.5">
                  <span className="flex shrink-0 items-center">
                    <TuiAgentIcon agent={choice.id} size={14} />
                  </span>
                  <div className="min-w-0">
                    <div>{choice.label}</div>
                    {!usable && choice.detail ? (
                      <div className="truncate text-xs font-normal text-muted-foreground" title={choice.detail}>
                        {choice.detail}
                      </div>
                    ) : null}
                  </div>
                </div>
              </DropdownMenuRadioItem>
            )
          })}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="leading-snug font-normal" data-agent-picker-note>
          {t("The chat stays. The new agent gets a selection of this conversation as text, not the previous agent's context.")}
        </DropdownMenuLabel>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
