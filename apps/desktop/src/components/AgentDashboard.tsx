import { useEffect, useState } from 'react'
import { ExternalLink, XIcon } from 'lucide-react'
import {
  allWorkspaces,
  selectSession,
  setDashboardOpen,
  useStore,
  type Session,
  type StoreState
} from '@/session-store'
import { AgentStateDot, type AgentDotState } from '@/components/AgentStateDot'
import { AgentQuestionIcon } from '@/components/AgentQuestionIcon'
import { TuiAgentIcon } from '@/components/terminal/TuiAgentIcon'
import { sessionAgent } from '@/lib/chat-agents'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'
import { canPopOutDashboard, popOutDashboard } from '@/lib/dashboard-window'
import { WINDOW_ROLE } from '@/lib/window-role'
import { t } from '@/i18n/i18n'

// Follows Orca's agent dashboard (dashboard-popout/AgentKanbanBoard.tsx, AgentKanbanCard.tsx):
// Needs You / Working / Done / Idle lanes; Done holds turns the user has not looked at yet.

type Bucket = 'attention' | 'working' | 'done' | 'idle'
const BUCKET_LABEL: Record<Bucket, string> = {
  attention: t('Needs You'),
  working: t('Working'),
  done: t('Done'),
  idle: t('Idle')
}

function bucketOf(session: Session, unread: StoreState['unread']): Bucket {
  if (session.status === 'needs-you') return 'attention'
  if (session.status === 'working') return 'working'
  // A failed turn is not done: until it is looked at, it waits on the person.
  if (session.status === 'error') return unread[session.id] ? 'attention' : 'idle'
  return unread[session.id] ? 'done' : 'idle'
}

export function AgentDashboard() {
  const sessions = useStore((s) => s.sessions)
  const unread = useStore((s) => s.unread)
  const hosts = useStore((s) => s.hosts)
  const [showIdle, setShowIdle] = useState(false)
  const workspaces = allWorkspaces({ hosts })

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setDashboardOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const buckets: Bucket[] = showIdle ? ['attention', 'working', 'done', 'idle'] : ['attention', 'working', 'done']

  return (
    <div className="relative flex min-h-0 min-w-0 flex-1 flex-col bg-background text-foreground" data-dashboard>
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-2.5">
        <h1 className="text-[13px] font-semibold">{t('Agents')}</h1>
        <span className="text-[11px] text-muted-foreground">
          {t(sessions.length === 1 ? '{n} session' : '{n} sessions', { n: sessions.length })}{' '}
          {t(Object.keys(hosts).length === 1 ? 'across {n} host' : 'across {n} hosts', { n: Object.keys(hosts).length })}
        </span>
        <div className="ml-auto flex items-center gap-3">
          <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <Switch checked={showIdle} onCheckedChange={setShowIdle} />
            {t('Show idle')}
          </label>
          {WINDOW_ROLE === 'main' && canPopOutDashboard() ? (
            <button
              type="button"
              aria-label={t('Open dashboard in its own window')}
              title={t('Open in its own window')}
              data-dashboard-popout
              className="rounded-sm p-1 text-muted-foreground opacity-70 transition-opacity hover:opacity-100"
              onClick={() => void popOutDashboard()}
            >
              <ExternalLink className="size-4" />
            </button>
          ) : null}
          <button
            type="button"
            aria-label={t('Close dashboard')}
            className="rounded-sm p-1 text-muted-foreground opacity-70 transition-opacity hover:opacity-100"
            onClick={() => setDashboardOpen(false)}
          >
            <XIcon className="size-4" />
          </button>
        </div>
      </div>
      <div className="scrollbar-sleek flex min-h-0 flex-1 overflow-x-auto p-3">
        <div className="mx-auto flex w-full max-w-[1280px] gap-3">
          {buckets.map((bucket) => {
            const cards = sessions.filter((s) => bucketOf(s, unread) === bucket)
            return (
              <section
                key={bucket}
                data-bucket={bucket}
                className="flex min-w-[264px] flex-1 flex-col rounded-xl border border-border/60 bg-muted/30"
              >
                <header className="flex items-center gap-2 px-3 py-2">
                  <span className="text-[11px] font-semibold tracking-[0.05em] text-muted-foreground uppercase">
                    {BUCKET_LABEL[bucket]}
                  </span>
                  <span className="ml-auto rounded-full bg-background px-1.5 text-[11px] text-muted-foreground tabular-nums">
                    {cards.length}
                  </span>
                </header>
                <div className="scrollbar-sleek flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-2 pb-2">
                  {cards.length === 0 && <p className="px-1 py-2 text-[11px] text-muted-foreground">{t('Nothing here.')}</p>}
                  {cards.map((session) => (
                    <AgentCard
                      key={session.id}
                      session={session}
                      bucket={bucket}
                      workspace={workspaces.find((w) => w.id === session.workspaceId)?.name ?? ''}
                      host={hosts[session.hostId]?.label ?? session.hostId}
                    />
                  ))}
                </div>
              </section>
            )
          })}
        </div>
      </div>
    </div>
  )
}

const DOT: Record<Bucket, AgentDotState> = { attention: 'waiting', working: 'working', done: 'done', idle: 'idle' }

function AgentCard({
  session,
  bucket,
  workspace,
  host
}: {
  session: Session
  bucket: Bucket
  workspace: string
  host: string
}) {
  const lastAgent = session.items.findLast((i) => i.kind === 'agent')
  const pendingAsk = session.items.findLast((i) => i.kind === 'permission' && !i.chosen)
  return (
    <div
      data-dashboard-card={session.id}
      className={cn(
        'group flex w-full flex-col gap-1.5 rounded-lg border p-2.5 text-left transition-colors',
        bucket === 'attention'
          ? 'border-agent-question/40 bg-agent-question/[0.06] hover:border-agent-question/60 hover:bg-agent-question/10'
          : bucket === 'done'
            ? 'border-emerald-500/40 bg-emerald-500/[0.06] hover:border-emerald-500/60 hover:bg-emerald-500/10'
            : 'border-border/60 bg-card hover:border-border hover:bg-accent/40'
      )}
    >
      <button
        type="button"
        onClick={() => selectSession(session.id)}
        className="flex w-full flex-col gap-1.5 text-left focus-visible:rounded-md focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        <div className="flex w-full items-center gap-1.5">
          <span className="inline-flex shrink-0">
            <TuiAgentIcon agent={sessionAgent(session)} size={13} />
          </span>
          <span className="min-w-0 truncate text-[13px] font-medium">{session.title}</span>
          <AgentStateDot state={session.status === 'error' ? 'failed' : DOT[bucket]} className="ml-auto" />
        </div>
        <div className="line-clamp-1 text-[11px] leading-snug text-muted-foreground">
          <span className="font-medium text-foreground/45">{host} · </span>
          {workspace}
        </div>
        {lastAgent?.kind === 'agent' && (
          <div className="line-clamp-2 w-full text-xs leading-snug text-foreground/90">{lastAgent.text.trim()}</div>
        )}
        {pendingAsk?.kind === 'permission' && (
          <div className="flex w-full items-start gap-1 rounded-md bg-agent-question/15 px-1.5 py-1 text-[11px] text-agent-question-text ring-1 ring-agent-question/25 ring-inset">
            <AgentQuestionIcon className="mt-px size-3 shrink-0" />
            <span className="line-clamp-2">{t('Allow {title}?', { title: pendingAsk.title })}</span>
          </div>
        )}
      </button>
    </div>
  )
}
