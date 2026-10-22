import { useState } from 'react'
import { ChevronDown, ChevronRight, ImageIcon, Play, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { clearQueue, removeQueued, resumeQueue, steerQueued } from '@/chat-actions'
import { useChatSession } from '@/stores/chat-store'

// Ported from Orca's NativeChatQueuedMessageList: follow-ups typed while a turn runs stack
// between the transcript and the composer, never in the transcript, until they are sent.

function IconAction({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button type="button" variant="ghost" size="icon-xs" aria-label={label} onClick={onClick}>
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="top" sideOffset={4}>
        {label}
      </TooltipContent>
    </Tooltip>
  )
}

export function NativeChatQueuedMessageList({ sessionId, working }: { sessionId: string; working: boolean }) {
  const { queue, queuePaused } = useChatSession(sessionId)
  const [expanded, setExpanded] = useState(true)
  if (queue.length === 0) return <div aria-live="polite" />
  return (
    <div aria-live="polite">
      <div className="mx-auto w-full max-w-(--chat-content-max-width) px-4 py-1" data-native-chat-queue>
        <div className="divide-y divide-border rounded-md border border-border bg-card text-card-foreground">
          <div
            className={cn(
              'flex items-center gap-1 rounded-t-md py-1 pr-1 pl-2.5 text-xs text-muted-foreground select-none',
              queuePaused && 'bg-muted',
              !expanded && 'rounded-b-md'
            )}
          >
            <p className={cn('truncate', queuePaused && 'font-medium text-foreground')}>{queuePaused ? 'Paused' : 'Queued'}</p>
            <span aria-hidden>·</span>
            <span className="min-w-0 flex-1 tabular-nums">{queue.length}</span>
            {queuePaused ? (
              <>
                <Button type="button" variant="ghost" size="xs" onClick={() => clearQueue(sessionId)}>
                  Clear all
                </Button>
                <Button type="button" variant="ghost" size="xs" onClick={() => resumeQueue(sessionId)}>
                  Resume
                </Button>
              </>
            ) : null}
            <IconAction label={expanded ? 'Collapse' : 'Expand'} onClick={() => setExpanded(!expanded)}>
              {expanded ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
            </IconAction>
          </div>
          <ul hidden={!expanded} aria-label="Queued messages" className="scrollbar-sleek max-h-40 divide-y divide-border overflow-y-auto">
            {queue.map((message) => (
              <li key={message.id} className="flex items-start gap-2 py-1.5 pr-1 pl-2.5" data-queued-message={message.id}>
                <p className="line-clamp-3 min-w-0 flex-1 text-sm break-words whitespace-pre-wrap text-foreground">
                  {message.images.length > 0 ? (
                    <span className="mr-1.5 inline-flex items-center gap-0.5 align-middle text-xs text-muted-foreground">
                      <ImageIcon className="size-3" aria-hidden />
                      {message.images.length}
                    </span>
                  ) : null}
                  {message.text}
                </p>
                <div className="flex shrink-0 items-center">
                  <IconAction
                    label={working ? 'Send now (interrupts the agent)' : 'Send now'}
                    onClick={() => steerQueued(sessionId, message.id)}
                  >
                    <Play className="size-3.5" />
                  </IconAction>
                  <IconAction label="Delete" onClick={() => removeQueued(sessionId, message.id)}>
                    <Trash2 className="size-3.5" />
                  </IconAction>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  )
}
