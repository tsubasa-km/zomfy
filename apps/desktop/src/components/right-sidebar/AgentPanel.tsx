import { useEffect, useRef } from 'react'
import { ExternalLink } from 'lucide-react'
import { chatAgentLabel, MANAGER_MCP_SERVER_NAME, workflowScorecard } from '@acp-harness/protocol'
import { allProjects, allWorkspaces, useStore, type Session } from '@/session-store'
import { useChatSession, type ContextUsage } from '@/stores/chat-store'
import { loadWorkflowRuns, useWorkflowRuns, type HostedWorkflowRun } from '@/stores/workflow-runs-store'
import { openWorkflows } from '@/stores/workflows-store'
import { TuiAgentIcon } from '@/components/terminal/TuiAgentIcon'
import { Button } from '@/components/ui/button'
import { formatDuration, formatTokens } from '@/components/workflows/WorkflowRunScorecard'
import { cn } from '@/lib/utils'
import { t } from '@/i18n/i18n'

// The Agent tab: for the chat in front, what fills its context (and whether this chat used it),
// what it has done, and the workflow run it belongs to or the project's recent runs.

/** Below this, an unused item is not worth flagging. */
const NOTABLE_TOKENS = 300

type ItemKind = ContextUsage['items'][number]['kind']
const KIND_LABELS: Record<ItemKind, string> = { skill: t('Skill'), mcp: 'MCP', memory: t('Memory'), agent: t('Agent') }

/** The chat in front in this workspace; the last one shown while a terminal or file is in front. */
function useFrontChat(workspaceId: string): Session | null {
  const sessions = useStore((s) => s.sessions)
  const activeId = useStore((s) => s.activeSessionByWorkspace[workspaceId])
  const last = useRef<string | null>(null)
  const inWorkspace = sessions.filter((s) => s.workspaceId === workspaceId)
  const front = inWorkspace.find((s) => s.id === activeId) ?? inWorkspace.find((s) => s.id === last.current) ?? null
  if (front) last.current = front.id
  return front ?? [...inWorkspace].sort((a, b) => b.createdAt - a.createdAt)[0] ?? null
}

/** What this chat called: tools by name, and the skills, MCP servers and subagents behind them. */
function chatActivity(session: Session) {
  const tools = new Map<string, number>()
  const used = { skill: new Map<string, number>(), mcp: new Map<string, number>(), agent: new Map<string, number>() }
  const bump = (map: Map<string, number>, key: string) => map.set(key, (map.get(key) ?? 0) + 1)
  let turns = 0
  for (const item of session.items) {
    if (item.kind === 'user') turns++
    if (item.kind !== 'tool') continue
    const name = item.toolName ?? item.title.split(':')[0] ?? 'tool'
    bump(tools, name.startsWith('mcp__') ? name.split('__').slice(0, 2).join('__') : name)
    const input = item.input && typeof item.input === 'object' ? (item.input as Record<string, unknown>) : {}
    if (name === 'Skill' && typeof input.skill === 'string') bump(used.skill, input.skill)
    if ((name === 'Agent' || name === 'Task') && typeof input.subagent_type === 'string') bump(used.agent, input.subagent_type)
    const server = name.startsWith('mcp__') ? name.split('__')[1] : /^mcp\.([^.]+)\./.exec(item.title)?.[1]
    if (server) bump(used.mcp, server)
  }
  return { turns, tools: [...tools].sort((a, b) => b[1] - a[1]), used }
}

function Section({ title, children, aside }: { title: string; children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <section className="space-y-2 border-b border-border px-3 py-3">
      <div className="flex items-center gap-2">
        <h3 className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">{title}</h3>
        <div className="ml-auto">{aside}</div>
      </div>
      {children}
    </section>
  )
}

function Bar({ value, max, warn }: { value: number; max: number; warn?: boolean }) {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
      <div className={cn('h-full rounded-full', warn ? 'bg-status-warning' : 'bg-highlight')} style={{ width: `${Math.min(100, max ? (value / max) * 100 : 0)}%` }} />
    </div>
  )
}

export function AgentPanel({ workspaceId }: { workspaceId: string }) {
  const session = useFrontChat(workspaceId)
  // Primitives only: allWorkspaces and allProjects build new objects on every call.
  const hostId = useStore((s) => allWorkspaces(s).find((w) => w.id === workspaceId)?.hostId ?? '')
  // A quick chat's throwaway folder belongs to no project, so has no workflows.
  const projectId = useStore((s) => allWorkspaces(s).find((w) => w.id === workspaceId)?.projectId ?? null)
  const projectName = useStore((s) => allProjects(s.hosts).find((p) => p.id === projectId)?.name ?? '')
  const usage = useChatSession(session?.id ?? '').usage
  const runs = useWorkflowRuns(hostId, projectId ?? '')

  useEffect(() => {
    if (hostId && projectId) void loadWorkflowRuns(hostId, projectId).catch(() => undefined)
  }, [hostId, projectId])

  if (!session) {
    return <p className="p-4 text-xs text-muted-foreground">{t('Open a chat to see its agent, context and activity.')}</p>
  }

  const agent = session.agent ?? 'claude'
  const activity = chatActivity(session)
  const run = runs.find((r) => r.steps.some((s) => s.sessionIds.includes(session.id)))
  const openRun = (r: HostedWorkflowRun) =>
    openWorkflows({ hostId: r.hostId, projectId: r.projectId, projectName, runId: r.id })

  return (
    // Room at the bottom for the window's floating layout button.
    <div className="min-h-0 flex-1 overflow-y-auto pb-14 text-xs" data-agent-panel>
      <div className="flex items-center gap-2 border-b border-border px-3 py-2.5">
        <TuiAgentIcon agent={agent} size={16} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{session.title}</div>
          <div className="truncate text-[11px] text-muted-foreground">
            {chatAgentLabel(agent)}
            {session.options?.model ? ` · ${session.options.model}` : ''}
            {session.options?.permissionMode ? ` · ${session.options.permissionMode}` : ''}
          </div>
        </div>
      </div>

      <ContextSection usage={usage} agent={agent} used={activity.used} />

      <Section title={t('This chat')}>
        <div className="grid grid-cols-3 gap-2">
          <Figure label={t('Turns')} value={String(activity.turns)} />
          <Figure label={t('Tool calls')} value={String(activity.tools.reduce((n, [, c]) => n + c, 0))} />
          <Figure label={t('Last turn')} value={usage?.costUsd != null ? `$${usage.costUsd.toFixed(2)}` : '—'} hint={t('What the last turn cost, as Claude reports it.')} />
        </div>
        {activity.tools.length > 0 && (
          <ul className="space-y-0.5" data-agent-tools>
            {activity.tools.slice(0, 8).map(([name, count]) => (
              <li key={name} className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate font-mono text-[11px]">{name}</span>
                <span className="text-muted-foreground tabular-nums">{count}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {projectId && (
        <Section
          title={t('Workflow run')}
          aside={
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-1.5 text-[11px]"
              onClick={() => openWorkflows({ hostId, projectId, projectName })}
            >
              {t('Workflows')}
            </Button>
          }
        >
          {run ? (
            <RunSummary run={run} sessionId={session.id} onOpen={() => openRun(run)} />
          ) : (
            <p className="text-muted-foreground">{t("This chat is not a step of a workflow run. The project's runs are under Workflows.")}</p>
          )}
        </Section>
      )}
    </div>
  )
}

function Figure({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="min-w-0" title={hint}>
      <div className="truncate text-sm font-medium tabular-nums">{value}</div>
      <div className="truncate text-[11px] text-muted-foreground">{label}</div>
    </div>
  )
}

function ContextSection({
  usage,
  agent,
  used
}: {
  usage: ContextUsage | null
  agent: string
  used: ReturnType<typeof chatActivity>['used']
}) {
  if (!usage) {
    return (
      <Section title={t('Context')}>
        <p className="text-muted-foreground">
          {agent === 'claude'
            ? t('Shown after the chat’s first turn.')
            : t('{agent} does not report what fills its context.', { agent: chatAgentLabel(agent) })}
        </p>
      </Section>
    )
  }
  const share = usage.size ? Math.round((usage.used / usage.size) * 100) : 0
  const uses = (kind: ItemKind, name: string) => (kind === 'memory' ? null : (used[kind].get(name) ?? 0))
  const idle = (kind: ItemKind, name: string, tokens: number) =>
    uses(kind, name) === 0 && tokens >= NOTABLE_TOKENS && !(kind === 'mcp' && name === MANAGER_MCP_SERVER_NAME)
  const idleTokens = usage.items.filter((i) => idle(i.kind, i.name, i.tokens)).reduce((n, i) => n + i.tokens, 0)
  const items = [...usage.items].sort((a, b) => b.tokens - a.tokens)
  return (
    <Section title={t('Context')} aside={<span className="text-[11px] text-muted-foreground tabular-nums">{share}%</span>}>
      <div className="space-y-1">
        <Bar value={usage.used} max={usage.size} warn={share >= 80} />
        <div className="text-[11px] text-muted-foreground tabular-nums">
          {t('{used} of {size}', { used: formatTokens(usage.used), size: formatTokens(usage.size) })}
          {usage.estimated ? ` ${t('(estimated)')}` : ''}
        </div>
      </div>
      {usage.categories.length > 0 && (
        <ul className="space-y-1" data-agent-context-categories>
          {[...usage.categories]
            .sort((a, b) => b.tokens - a.tokens)
            .map((c) => (
              <li key={c.name} className="space-y-0.5">
                <div className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate">{c.name}</span>
                  <span className="text-muted-foreground tabular-nums">{formatTokens(c.tokens)}</span>
                </div>
                <Bar value={c.tokens} max={usage.used} />
              </li>
            ))}
        </ul>
      )}
      {items.length > 0 && (
        <div className="space-y-1">
          <div className="text-[11px] text-muted-foreground">
            {t('Loaded every turn')}
            {idleTokens > 0 && (
              <span className="text-status-warning"> · {t('{tokens} unused in this chat', { tokens: formatTokens(idleTokens) })}</span>
            )}
          </div>
          <ul className="max-h-64 space-y-0.5 overflow-y-auto" data-agent-context-items>
            {items.map((i) => {
              const count = uses(i.kind, i.name)
              return (
                <li
                  key={`${i.kind}:${i.name}`}
                  className={cn('flex items-center gap-2', idle(i.kind, i.name, i.tokens) && 'text-status-warning')}
                  title={i.name}
                >
                  <span className="w-11 shrink-0 text-[11px] text-muted-foreground">{KIND_LABELS[i.kind]}</span>
                  <span className="min-w-0 flex-1 truncate">{i.kind === 'memory' ? i.name.split(/[\\/]/).slice(-2).join('/') : i.name}</span>
                  <span className="shrink-0 tabular-nums">{formatTokens(i.tokens)}</span>
                  <span className="w-8 shrink-0 text-right text-[11px] text-muted-foreground tabular-nums" title={t('Calls in this chat')}>
                    {count === null ? '—' : `×${count}`}
                  </span>
                </li>
              )
            })}
          </ul>
        </div>
      )}
    </Section>
  )
}

function RunSummary({ run, sessionId, onOpen }: { run: HostedWorkflowRun; sessionId: string; onOpen: () => void }) {
  const card = workflowScorecard(run)
  const step = run.steps.filter((s) => s.sessionIds.includes(sessionId)).map((s) => s.label)
  return (
    <div className="space-y-2" data-agent-run>
      <div>
        <div className="truncate font-medium">{run.workflow.name}</div>
        <div className="truncate text-[11px] text-muted-foreground">
          {run.status} · {t('this chat ran {steps}', { steps: [...new Set(step)].join(', ') })}
        </div>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <Figure label={t('Time')} value={formatDuration(card.durationMs)} />
        <Figure label={t('Tokens')} value={formatTokens(card.usage.inputTokens + card.usage.outputTokens)} />
        <Figure label={t('Rounds')} value={String(card.sentBack + card.checksFailed)} hint={t('Reviews that sent work back, plus failed checks.')} />
      </div>
      <Button variant="outline" size="sm" className="h-7 w-full" onClick={onOpen}>
        <ExternalLink className="size-3.5" />
        {t('Open the run')}
      </Button>
    </div>
  )
}
