import { useEffect, useState, type ReactNode } from 'react'
import { Archive, ArchiveRestore, FolderGit2, GitBranch, MessageSquare, MessagesSquare, Monitor, Pin, PinOff, SquareTerminal } from 'lucide-react'
import { chatAgentLabel, CHAT_AGENT_OPTION_IDS, type WorkspaceSummary } from '@zomfy/protocol'
import type { Session } from '@/session-store'
import { AgentStateDot } from '@/components/AgentStateDot'
import { TuiAgentIcon } from '@/components/terminal/TuiAgentIcon'
import { ReviewBadge } from '@/components/sidebar/WorkspaceCardBadges'
import { sessionAgent } from '@/lib/chat-agents'
import { activityOf, compactAge, elapsed, useCoarseNow } from '@/lib/chat-list'
import { backgroundSummary, backgroundWakeLabel, phaseOf, turnPhaseDot, turnPhaseLabel, type TurnPhase } from '@/lib/turn-phase'
import { setChatArchived } from '@/chat-rename-archive'
import { setChatPinned } from '@/stores/sidebar-store'
import { cn } from '@/lib/utils'
import { t } from '@/i18n/i18n'

// A chat as the chat list draws it, as T3 Code's thread rows: a chat that wants a look has its
// project (a coloured badge and its name) and what it is doing on the first line and its title on
// the second; a settled one is a single quiet line of badge, title and age. The card beside a
// hovered row has the rest: branch, terminals, pull request, uncommitted lines, agent.

/** What a chat row shows beyond the chat itself. */
export interface ChatCardInfo {
  /** The project's name, or what stands in for it (a quick chat). */
  project: string
  /** A quick thread, which has no project to name. */
  quick: boolean
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

// Literal class names, so Tailwind keeps them.
const BADGE_COLORS = [
  'bg-orange-500/15 text-orange-700 dark:text-orange-300',
  'bg-violet-500/15 text-violet-700 dark:text-violet-300',
  'bg-sky-500/15 text-sky-700 dark:text-sky-300',
  'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
  'bg-rose-500/15 text-rose-700 dark:text-rose-300',
  'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  'bg-teal-500/15 text-teal-700 dark:text-teal-300',
  'bg-fuchsia-500/15 text-fuchsia-700 dark:text-fuchsia-300'
]

/** Two letters for a project: its first two words' initials, else its first two letters. */
export function projectInitials(name: string): string {
  const words = name.split(/[\s\-_./]+/).filter(Boolean)
  const letters = words.length >= 2 ? [Array.from(words[0]!)[0], Array.from(words[1]!)[0]] : Array.from(words[0] ?? '').slice(0, 2)
  return letters.join('').toUpperCase()
}

/** The same project gets the same colour on every row. */
export function projectColor(name: string): string {
  let hash = 0
  for (const char of name) hash = (hash * 31 + char.codePointAt(0)!) | 0
  return BADGE_COLORS[Math.abs(hash) % BADGE_COLORS.length]!
}

/** The project's badge: its initials on its colour, or grey on a settled row. */
function ProjectBadge({ card, muted }: { card: ChatCardInfo; muted: boolean }) {
  return (
    <span
      aria-hidden
      data-chat-project-badge
      className={cn(
        'flex h-4 w-[18px] shrink-0 items-center justify-center rounded-[4px] text-[8.5px] leading-none font-bold tracking-tight',
        muted ? 'bg-muted text-muted-foreground/80' : projectColor(card.project)
      )}
    >
      {card.quick ? <MessageSquare className="size-2.5" /> : projectInitials(card.project)}
    </span>
  )
}

/** The time, every second, while a turn runs. */
function useSecondsNow(running: boolean): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!running) return
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [running])
  return now
}

/**
 * Whose turn the chat is, as its mark (docs/specs/turn-taking-states.md), with only a value beside
 * it: how long a turn has run, when background work wakes. A quiet chat shows how long ago it last
 * did something. The state's name is the mark's tooltip, never a word on the row.
 */
function ChatStatus({ session, phase }: { session: Session; phase: TurnPhase }) {
  const coarse = useCoarseNow()
  const running = phase === 'working' && session.status === 'working'
  const now = useSecondsNow(running)
  const dot = turnPhaseDot(phase, session.status)
  if (!dot) return <span className="tabular-nums">{compactAge(activityOf(session), coarse)}</span>
  const wake = phase === 'background' ? backgroundWakeLabel(session, coarse) : null
  const label = phase === 'background' ? backgroundSummary(session, coarse) || turnPhaseLabel(phase) : turnPhaseLabel(phase, session.status)
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 tabular-nums',
        phase === 'working' && 'text-sky-600 dark:text-sky-400',
        phase === 'background' && 'text-yellow-700 dark:text-yellow-400'
      )}
      title={label}
      aria-label={label}
      data-chat-status={phase}
    >
      <AgentStateDot state={dot} size={phase === 'needs-answer' ? 'md' : 'sm'} title={null} />
      {wake}
      {running && session.turnStartedAt != null && elapsed(session.turnStartedAt, now)}
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
  phase,
  title,
  trailing,
  busy,
  compact
}: {
  session: Session
  card: ChatCardInfo
  /** Whose turn the chat is, with the chats folded under it. */
  phase: TurnPhase
  title: ReactNode
  trailing?: ReactNode
  /** Renaming: the hover actions stay out of the way. */
  busy: boolean
  /** A quiet chat: one line of badge, title and age. */
  compact: boolean
}) {
  const agent = <TuiAgentIcon agent={sessionAgent(session)} size={12} />
  // What the chat is doing, which the pointer trades for the row's actions.
  const corner = (
    <>
      <span className={cn('ml-auto flex shrink-0 items-center gap-1.5 text-[11px] leading-none', !busy && 'group-hover/chat:hidden')} data-chat-status-text>
        <ChatStatus session={session} phase={phase} />
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
  const pin = card.pinned && <Pin className="size-3 shrink-0 text-muted-foreground/70" aria-label={t('Pinned')} data-chat-pinned />
  if (compact || card.foldered) {
    // One line; under its project's folder the badge has nothing to add.
    return (
      <div className="flex h-5 min-w-0 flex-1 items-center gap-2">
        {!card.foldered && <ProjectBadge card={card} muted={compact} />}
        {title}
        {pin}
        {trailing}
        {corner}
      </div>
    )
  }
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1">
      <div className="flex h-4 min-w-0 items-center gap-2 text-[11px] leading-none text-muted-foreground">
        <ProjectBadge card={card} muted={false} />
        <span className="min-w-0 truncate" data-chat-project>
          {card.project}
          {card.host && ` · ${card.host}`}
        </span>
        {corner}
      </div>
      <div className="flex h-5 min-w-0 items-center gap-1.5">
        {title}
        {pin}
        {trailing}
        {/* Which agent runs the chat is a quiet fact, not a signal: grey until the row is pointed at,
            so the agent's brand colour never competes with the state colours beside it. */}
        <span className="flex shrink-0 opacity-50 grayscale transition-[filter,opacity] group-hover/chat:opacity-100 group-hover/chat:grayscale-0">
          {agent}
        </span>
      </div>
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
  const phase = phaseOf(session, now)
  const state = turnPhaseDot(phase, session.status) ?? 'idle'
  const background = phase === 'background' ? backgroundSummary(session, now) : ''
  return (
    <div className="flex flex-col gap-2" data-chat-hover-card>
      <div className="text-[13px] leading-snug font-medium break-words text-foreground">{session.title}</div>
      <div className="flex items-center gap-2 text-muted-foreground">
        <AgentStateDot state={state} size="sm" title={turnPhaseLabel(phase, session.status)} />
        <span>
          {background && `${background} · `}
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
        {card.branch && (
          <div className="flex items-center gap-2 pl-[22px] empty:hidden" data-chat-hover-review>
            <ReviewBadge workspaceId={card.workspaceId} showNumber />
          </div>
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
