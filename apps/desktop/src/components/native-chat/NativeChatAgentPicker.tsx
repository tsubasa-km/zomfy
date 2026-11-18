import { useRef, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { chatAgentLabel, type ChatAgentId, type ChatAgentInfo } from '@acp-harness/protocol'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { TuiAgentIcon } from '@/components/terminal/TuiAgentIcon'
import { useChatAgents } from '@/lib/chat-agents'
import { cn } from '@/lib/utils'
import type { HostId } from '@/session-store'
import { t } from '@/i18n/i18n'

// The composer's agent-and-model menu, read as T3 Code's provider and model picker: one chip
// showing the agent's mark, its model and the effort, opening the host's agents beside the picked
// agent's models. In an open chat a pick replaces the agent behind it (the chat stays; the daemon
// hands the new agent a selection of the conversation as text, which `note` says); in the "New
// chat" tab it sets the agent the thread starts with.

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
  model,
  detail,
  spoken,
  disabledReason,
  note,
  onSelect,
  closeOnSelect,
  children
}: {
  hostId: HostId
  current: ChatAgentId
  /** The picked model's name; null shows the agent's own name, when no model is known yet. */
  model: string | null
  /** A short second word on the chip: the effort, or that the agent is starting. */
  detail?: string | null
  /** The model and effort as a screen reader hears them. */
  spoken?: string
  /** Why the agent cannot change right now (a turn runs, the host is away), or null. */
  disabledReason?: string | null
  /** Said under the list: what a pick does to the chat. */
  note?: string
  /** Absent where the agent is fixed: the menu then holds its models alone. */
  onSelect?: (agent: ChatAgentId) => void
  /** An open chat's agent changes in the background: the menu shuts instead of showing the old one's models. */
  closeOnSelect?: boolean
  /** The picked agent's models; `close` shuts the menu. */
  children: (close: () => void) => React.ReactNode
}) {
  const [open, setOpen] = useState(false)
  const body = useRef<HTMLDivElement>(null)
  const { agents } = useChatAgents(hostId)
  const choices = onSelect ? agentChoices(agents, current) : []
  // One agent to pick from is no choice: the menu is then the model list.
  const rail = choices.length > 1
  const title = t('Agent')
  const label = chatAgentLabel(current)
  const close = () => setOpen(false)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="xs"
              data-native-chat-agent-picker={current}
              data-native-chat-model-picker
              aria-label={[`${title} ${label}`, spoken].filter(Boolean).join(', ')}
              className="max-w-64 min-w-0 shrink"
              onKeyDown={(event) => {
                // A popover trigger opens on Enter and Space only; a menu also takes ArrowDown.
                if (event.key === 'ArrowDown') {
                  event.preventDefault()
                  setOpen(true)
                }
              }}
            >
              <span className="flex shrink-0 items-center">
                <TuiAgentIcon agent={current} size={12} />
              </span>
              <span className="truncate text-chat-foreground">{model ?? label}</span>
              {detail ? <span className="shrink-0">{detail}</span> : null}
              <ChevronDown className="size-3" />
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent side="top" sideOffset={4}>
          {[label, model, detail].filter(Boolean).join(' · ')}
        </TooltipContent>
      </Tooltip>
      <PopoverContent
        align="end"
        side="top"
        collisionPadding={8}
        className={cn('flex max-w-(--radix-popover-content-available-width) flex-col p-0 select-none', rail ? 'w-[34rem]' : 'w-96')}
        onOpenAutoFocus={(event) => {
          // Typing filters the models at once; the agents are a Tab back.
          const search = body.current?.querySelector('input')
          if (!search) return
          event.preventDefault()
          search.focus()
        }}
      >
        <div className="flex min-h-0">
          {rail ? (
            <div
              role="radiogroup"
              aria-label={title}
              className="flex w-40 shrink-0 flex-col gap-0.5 border-r border-border p-1"
            >
              {choices.map((choice) => {
                const picked = choice.id === current
                const usable = choice.status === 'ready' || picked
                return (
                  <button
                    key={choice.id}
                    type="button"
                    role="radio"
                    aria-checked={picked}
                    disabled={!usable || (!picked && Boolean(disabledReason))}
                    data-agent-choice={choice.id}
                    title={!usable && choice.detail ? choice.detail : undefined}
                    onClick={() => {
                      if (picked) return
                      onSelect?.(choice.id)
                      if (closeOnSelect) close()
                    }}
                    className="flex min-w-0 shrink-0 items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm outline-none hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 aria-checked:bg-accent aria-checked:text-accent-foreground"
                  >
                    <span className="flex shrink-0 items-center">
                      <TuiAgentIcon agent={choice.id} size={14} />
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate">{choice.label}</span>
                      {!usable && choice.detail ? (
                        <span className="block truncate text-xs font-normal text-muted-foreground">{choice.detail}</span>
                      ) : null}
                    </span>
                  </button>
                )
              })}
            </div>
          ) : null}
          <div ref={body} className="flex min-w-0 flex-1 flex-col" data-agent-picker-models>
            {children(close)}
          </div>
        </div>
        {rail && (disabledReason || note) ? (
          <p className="border-t border-border px-3 py-2 text-xs leading-snug text-muted-foreground" data-agent-picker-note>
            {disabledReason ?? note}
          </p>
        ) : null}
      </PopoverContent>
    </Popover>
  )
}
