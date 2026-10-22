import { ArrowDown, ArrowUp } from 'lucide-react'
import type { WorkspaceSummary } from '@acp-harness/protocol'
import type { Session } from '@/session-store'
import { AgentStateDot, type AgentDotState } from '@/components/AgentStateDot'
import { TuiAgentIcon } from '@/components/terminal/TuiAgentIcon'
import { sessionAgent } from '@/lib/chat-agents'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

// Small right-aligned card badges, in the source-control panel's +/- colours.

export const SESSION_DOT: Record<Session['status'], AgentDotState> = {
  'needs-you': 'waiting',
  working: 'working',
  error: 'failed',
  idle: 'done'
}

export function DiffStatsBadge({ summary }: { summary: WorkspaceSummary | undefined }) {
  if (!summary || summary.changedFiles === 0) return null
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex shrink-0 items-center gap-1 font-mono text-[10px] leading-none tabular-nums" data-diff-stats>
          {summary.additions + summary.deletions > 0 ? (
            <>
              <span style={{ color: 'var(--git-decoration-added)' }}>+{summary.additions}</span>
              <span style={{ color: 'var(--git-decoration-deleted)' }}>-{summary.deletions}</span>
            </>
          ) : (
            // Only new or binary files: no line counts to show.
            <span style={{ color: 'var(--git-decoration-untracked)' }}>{summary.changedFiles} new</span>
          )}
        </span>
      </TooltipTrigger>
      <TooltipContent side="right">
        {summary.changedFiles} uncommitted {summary.changedFiles === 1 ? 'file' : 'files'}
      </TooltipContent>
    </Tooltip>
  )
}

export function SyncBadge({ summary }: { summary: WorkspaceSummary | undefined }) {
  if (!summary || (!summary.ahead && !summary.behind)) return null
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className="inline-flex shrink-0 items-center gap-0.5 text-[10px] leading-none text-muted-foreground tabular-nums"
          data-sync-stats
        >
          {!!summary.ahead && (
            <span className="inline-flex items-center">
              <ArrowUp className="size-2.5" />
              {summary.ahead}
            </span>
          )}
          {!!summary.behind && (
            <span className="inline-flex items-center">
              <ArrowDown className="size-2.5" />
              {summary.behind}
            </span>
          )}
        </span>
      </TooltipTrigger>
      <TooltipContent side="right">
        {summary.ahead ?? 0} ahead, {summary.behind ?? 0} behind {summary.compareRef}
      </TooltipContent>
    </Tooltip>
  )
}

/** Compact cards fold the agent rows into one glyph with the most urgent state. */
export function AgentBadge({ sessions }: { sessions: Session[] }) {
  if (sessions.length === 0) return null
  const order: Session['status'][] = ['needs-you', 'working', 'error', 'idle']
  const top = order.find((status) => sessions.some((s) => s.status === status)) ?? 'idle'
  const lead = sessions.find((s) => s.status === top) ?? sessions[0]!
  return (
    <span className="inline-flex shrink-0 items-center gap-0.5 text-[10px] leading-none text-muted-foreground tabular-nums" data-agent-badge>
      <TuiAgentIcon agent={sessionAgent(lead)} size={10} />
      {sessions.length > 1 && sessions.length}
      <AgentStateDot state={SESSION_DOT[top]} size="sm" />
    </span>
  )
}
