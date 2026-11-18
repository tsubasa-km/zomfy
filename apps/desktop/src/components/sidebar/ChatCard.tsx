import type { ReactNode } from 'react'
import { Archive, ArchiveRestore, Folder, FolderGit2, GitBranch, MessagesSquare, Monitor, Pin, PinOff, SquareTerminal } from 'lucide-react'
import { chatAgentLabel, CHAT_AGENT_OPTION_IDS, type WorkspaceSummary } from '@acp-harness/protocol'
import type { Session } from '@/session-store'
import { AgentStateDot, agentStateLabel } from '@/components/AgentStateDot'
import { TuiAgentIcon } from '@/components/terminal/TuiAgentIcon'
import { ReviewBadge, SESSION_DOT } from '@/components/sidebar/WorkspaceCardBadges'
import { sessionAgent } from '@/lib/chat-agents'
import { activityOf, compactAge, useCoarseNow } from '@/lib/chat-list'
import { setChatArchived } from '@/chat-rename-archive'
import { setChatPinned } from '@/stores/sidebar-store'
import { cn } from '@/lib/utils'
import { t } from '@/i18n/i18n'

// A chat as the chat list draws it, with what T3 Code's thread rows show: its project and what it is
// doing on the first line, its title on the second, and where it works on the third (branch, running
// terminals, pull request, uncommitted lines, agent). The card beside a hovered row has the rest.

/** What a chat row shows beyond the chat itself. */
export interface ChatCardInfo {
  /** The project's name, or what stands in for it (a quick chat). */
  project: string
  /** Under its project's folder the row leaves the project line out. */
  foldered: boolean
  workspaceId: string
  /** The checked-out branch; null for a folder that is not a git checkout. */
  branch?: string | null
  /** A worktree made for the chat, as opposed to the project's own checkout. */
  worktree: boolean
  path?: string
  /** The host's short name, when the chat is not on the default host. */
  host?: string
  pinned: boolean
  unread: boolean
  summary?: WorkspaceSummary
  /** Terminals running in the chat's workspace. */
  terminals: number
}

/** The model the chat's next turn runs on, when it says. */
function modelOf(session: Session): string | null {
  const option = session.agentState?.options.find((o) => o.id === CHAT_AGENT_OPTION_IDS.model || o.category === 'model')
  if (option) return option.choices.find((c) => c.value === option.currentValue)?.name ?? option.currentValue
  return session.options?.model ?? null
}

function DiffStats({ summary }: { summary: WorkspaceSummary | undefined }) {
  if (!summary || summary.additions + summary.deletions === 0) return null
  return (
    <span className="inline-flex shrink-0 items-center gap-1 font-mono text-[10px] leading-none tabular-nums" data-chat-diff>
      <span style={{ color: 'var(--git-decoration-added)' }}>+{summary.additions}</span>
      <span style={{ color: 'var(--git-decoration-deleted)' }}>−{summary.deletions}</span>
    </span>
  )
}

/** What the chat is doing, in a word with its mark; a chat at rest shows how long ago it last did something. */
function ChatStatus({ session, status, unread }: { session: Session; status: Session['status']; unread: boolean }) {
  const now = useCoarseNow()
  const label =
    status === 'needs-you' ? t('Needs you') : status === 'error' ? t('Failed') : status === 'working' ? t('Working') : unread ? t('Done') : null
  if (!label) return <span className="tabular-nums">{compactAge(activityOf(session), now)}</span>
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 font-medium',
        status === 'needs-you' && 'text-agent-question-text',
        status === 'error' && 'text-destructive',
        status === 'idle' && 'text-foreground/80'
      )}
      data-chat-status={status}
    >
      <AgentStateDot state={SESSION_DOT[status]} size="sm" />
      {label}
    </span>
  )
}

function RowAction({ label, onClick, children, action }: { label: string; onClick: () => void; children: ReactNode; action: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      data-chat-row-action={action}
      className="flex size-4 items-center justify-center rounded-sm text-muted-foreground hover:bg-worktree-sidebar-accent hover:text-foreground"
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
    >
      {children}
    </button>
  )
}

/** The row's lines. `title` is the row's own title (or its rename field), `trailing` its fold badge. */
export function ChatCardBody({
  session,
  card,
  status,
  title,
  trailing,
  busy
}: {
  session: Session
  card: ChatCardInfo
  /** The most pressing state of the chat and the chats folded under it. */
  status: Session['status']
  title: ReactNode
  trailing?: ReactNode
  /** Renaming: the hover actions stay out of the way. */
  busy: boolean
}) {
  const agent = <TuiAgentIcon agent={sessionAgent(session)} size={12} />
  // What the chat is doing, which the pointer trades for the row's actions.
  const corner = (
    <>
      <span className={cn('ml-auto flex shrink-0 items-center gap-1.5 text-[11px] leading-none', !busy && 'group-hover/chat:hidden')} data-chat-status-text>
        <ChatStatus session={session} status={status} unread={card.unread} />
      </span>
      {!busy && (
        <span className="ml-auto hidden shrink-0 items-center gap-0.5 group-hover/chat:flex">
          {!session.archived && (
            <RowAction
              action={card.pinned ? 'unpin' : 'pin'}
              label={card.pinned ? t('Unpin') : t('Pin to the top')}
              onClick={() => setChatPinned(session.id, !card.pinned)}
            >
              {card.pinned ? <PinOff className="size-3" /> : <Pin className="size-3" />}
            </RowAction>
          )}
          <RowAction
            action={session.archived ? 'unarchive' : 'archive'}
            label={session.archived ? t('Unarchive') : t('Archive')}
            onClick={() => void setChatArchived(session.id, !session.archived)}
          >
            {session.archived ? <ArchiveRestore className="size-3" /> : <Archive className="size-3" />}
          </RowAction>
        </span>
      )}
    </>
  )
  const where = card.branch || card.terminals > 0 || (card.summary && card.summary.additions + card.summary.deletions > 0)
  return (
    <div className="flex min-w-0 flex-1 flex-col">
      {!card.foldered && (
        <div className="flex h-4 min-w-0 items-center gap-1 text-[11px] leading-none text-muted-foreground/80">
          <Folder className="size-3 shrink-0 opacity-70" />
          <span className="min-w-0 truncate" data-chat-project>
            {card.project}
            {card.host && ` · ${card.host}`}
          </span>
          {corner}
        </div>
      )}
      <div className="flex h-5 min-w-0 items-center gap-1.5">
        {title}
        {card.pinned && <Pin className="size-3 shrink-0 text-muted-foreground/70" aria-label={t('Pinned')} data-chat-pinned />}
        {trailing}
        {card.foldered && corner}
        {/* With no third line to sit on, the agent's mark closes the title's. */}
        {!where && <span className="flex shrink-0 opacity-70">{agent}</span>}
      </div>
      {where && (
        <div className="flex h-4 min-w-0 items-center gap-1.5 text-[11px] leading-none text-muted-foreground/80" data-chat-where>
          {card.branch ? (
            <span className="flex min-w-0 flex-1 items-center gap-1" title={card.worktree ? t('In a worktree of its own') : undefined}>
              <GitBranch className="size-3 shrink-0 opacity-70" />
              <span className="min-w-0 truncate font-mono text-[10px]">{card.branch}</span>
            </span>
          ) : (
            <span className="flex-1" />
          )}
          {card.terminals > 0 && (
            <span
              className="inline-flex shrink-0 items-center gap-0.5 tabular-nums"
              title={card.terminals === 1 ? t('{n} terminal running', { n: card.terminals }) : t('{n} terminals running', { n: card.terminals })}
              data-chat-terminals={card.terminals}
            >
              <SquareTerminal className="size-3" />
              {card.terminals > 1 && card.terminals}
            </span>
          )}
          <ReviewBadge workspaceId={card.workspaceId} showNumber />
          <DiffStats summary={card.summary} />
          <span className="flex shrink-0 opacity-70">{agent}</span>
        </div>
      )}
    </div>
  )
}

function DetailLine({ icon, children, title }: { icon: ReactNode; children: ReactNode; title?: string }) {
  return (
    <div className="flex min-w-0 items-center gap-2" title={title}>
      <span className="flex size-3.5 shrink-0 items-center justify-center text-muted-foreground">{icon}</span>
      <div className="min-w-0 truncate text-foreground/80">{children}</div>
    </div>
  )
}

/** The card beside a hovered row: the whole title, then where the chat works and what runs it. */
export function ChatHoverDetails({ session, card, childCount }: { session: Session; card: ChatCardInfo; childCount: number }) {
  const now = useCoarseNow()
  const model = modelOf(session)
  const agent = sessionAgent(session)
  const state = SESSION_DOT[session.status]
  return (
    <div className="flex flex-col gap-2" data-chat-hover-card>
      <div className="text-[13px] leading-snug font-medium break-words text-foreground">{session.title}</div>
      <div className="flex items-center gap-2 text-muted-foreground">
        <AgentStateDot state={state} size="sm" />
        <span>
          {session.status === 'idle' ? t('Idle') : agentStateLabel(state)}
          {' · '}
          {session.status === 'working' && session.turnStartedAt
            ? t('for {age}', { age: compactAge(session.turnStartedAt, now) })
            : t('started {date}', { date: new Date(session.createdAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) })}
        </span>
      </div>
      <div className="flex flex-col gap-1.5 border-t border-border/60 pt-2">
        <DetailLine icon={<FolderGit2 className="size-3.5" />} title={card.path}>
          {card.project}
        </DetailLine>
        {card.host && <DetailLine icon={<Monitor className="size-3.5" />}>{card.host}</DetailLine>}
        {card.branch && (
          <DetailLine icon={<GitBranch className="size-3.5" />}>
            <span className="font-mono text-[11px]">{card.branch}</span>
            {card.worktree && <span className="text-muted-foreground"> · {t('worktree')}</span>}
          </DetailLine>
        )}
        <DetailLine icon={<TuiAgentIcon agent={agent} size={13} />}>
          {chatAgentLabel(agent)}
          {model && <span className="text-muted-foreground"> · {model}</span>}
        </DetailLine>
        {card.terminals > 0 && (
          <DetailLine icon={<SquareTerminal className="size-3.5" />}>
            {card.terminals === 1 ? t('{n} terminal running', { n: card.terminals }) : t('{n} terminals running', { n: card.terminals })}
          </DetailLine>
        )}
        {childCount > 0 && (
          <DetailLine icon={<MessagesSquare className="size-3.5" />}>
            {childCount === 1 ? t('{n} thread under this one', { n: childCount }) : t('{n} threads under this one', { n: childCount })}
          </DetailLine>
        )}
        {card.summary && card.summary.changedFiles > 0 && (
          <DetailLine icon={<span className="font-mono text-[10px]">±</span>}>
            <span className="inline-flex items-center gap-1.5">
              {card.summary.changedFiles === 1
                ? t('{n} uncommitted file', { n: card.summary.changedFiles })
                : t('{n} uncommitted files', { n: card.summary.changedFiles })}
              <DiffStats summary={card.summary} />
            </span>
          </DetailLine>
        )}
      </div>
    </div>
  )
}
