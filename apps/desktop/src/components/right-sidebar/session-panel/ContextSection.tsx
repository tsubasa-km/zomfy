import { useEffect, useRef, useState } from 'react'
import { Loader2, Shrink } from 'lucide-react'
import { chatAgentLabel, MANAGER_MCP_SERVER_NAME } from '@acp-harness/protocol'
import type { Session } from '@/session-store'
import type { ContextUsage } from '@/stores/chat-store'
import { isWorking, submitPrompt } from '@/chat-actions'
import { formatContextTokenCount } from '@/components/native-chat/NativeChatContextUsageRing'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { Disclosure, Section } from './panel-parts'
import { t } from '@/i18n/i18n'

// What fills the chat's context window, as Claude's /context counts it: a stacked bar of the rows
// in the window, each row's tokens and share, the deferred tools (out of the window, no share), and
// lists of the MCP tools and memory files. Compact runs Claude's /compact on the conversation.

/** Below this, an unused item is not worth flagging. */
const NOTABLE_TOKENS = 300

type Row = ContextUsage['categories'][number]
type ItemKind = ContextUsage['items'][number]['kind']
export type ChatUse = Record<Exclude<ItemKind, 'memory'>, Map<string, number>>

/** A colour per row id, so the same row keeps its colour between turns. */
const ROW_COLORS: Record<string, string> = {
  messages: 'bg-highlight',
  system_prompt: 'bg-sky-500',
  system_tools: 'bg-violet-500',
  mcp_tools: 'bg-emerald-500',
  mcp_instructions: 'bg-teal-500',
  custom_agents: 'bg-rose-500',
  memory_files: 'bg-amber-500',
  skills: 'bg-fuchsia-500',
  autocompact_buffer: 'bg-muted-foreground/40',
  compact_buffer: 'bg-muted-foreground/40'
}
const SPARE_COLORS = ['bg-lime-500', 'bg-indigo-500', 'bg-orange-400', 'bg-cyan-500']

function rowColor(row: Row, index: number): string {
  return (row.id && ROW_COLORS[row.id]) ?? (row.kind === 'buffer' ? 'bg-muted-foreground/40' : SPARE_COLORS[index % SPARE_COLORS.length]!)
}

const KIND_LABELS: Record<ItemKind, string> = { skill: t('Skill'), mcp: 'MCP', memory: t('Memory'), agent: t('Agent') }

function share(tokens: number, size: number): string {
  if (!size) return '—'
  const percent = (tokens / size) * 100
  return `${percent < 10 ? percent.toFixed(1) : Math.round(percent)}%`
}

export function ContextSection({ session, usage, used }: { session: Session; usage: ContextUsage | null; used: ChatUse }) {
  const agent = session.agent ?? 'claude'
  const compact = agent === 'claude' ? <CompactButton session={session} /> : null
  if (!usage) {
    return (
      <Section title={t('Context')} aside={compact}>
        <p className="text-muted-foreground">
          {agent === 'claude'
            ? t('Shown after the thread’s first turn.')
            : t('{agent} does not report what fills its context.', { agent: chatAgentLabel(agent) })}
        </p>
      </Section>
    )
  }
  const percent = usage.size ? Math.round((usage.used / usage.size) * 100) : 0
  // Rows from an older daemon have no kind: they are all content in the window.
  const inWindow = usage.categories.filter((c) => c.kind !== 'deferred')
  const deferred = usage.categories.filter((c) => c.kind === 'deferred')
  const filled = inWindow.filter((c) => c.kind !== 'free')
  const free = inWindow.find((c) => c.kind === 'free') ?? (usage.size > usage.used ? { name: t('Free space'), tokens: usage.size - usage.used, kind: 'free' as const } : null)
  // Content by size, then the compaction reserve, as /context lists them.
  const rows = [...filled].sort((a, b) => Number(a.kind === 'buffer') - Number(b.kind === 'buffer') || b.tokens - a.tokens)
  const colors = new Map(filled.map((row, index) => [row, rowColor(row, index)]))
  return (
    <Section title={t('Context')} aside={compact}>
      <div className="space-y-1.5">
        <div className="flex items-baseline gap-2" data-session-context-total>
          <span className="text-sm font-medium tabular-nums">{t('{percent}% used', { percent })}</span>
          <span className="ml-auto text-[11px] text-muted-foreground tabular-nums">
            {formatContextTokenCount(usage.used)} / {formatContextTokenCount(usage.size)}
            {usage.estimated ? ` ${t('(estimated)')}` : ''}
          </span>
        </div>
        <div className="flex h-2 w-full overflow-hidden rounded-full bg-muted" data-session-context-bar>
          {(filled.length > 0 ? filled : [{ name: t('Context'), tokens: usage.used }]).map((row, index) => (
            <div
              key={`${row.name}:${index}`}
              className={cn('h-full', colors.get(row) ?? 'bg-highlight')}
              style={{ width: `${usage.size ? (row.tokens / usage.size) * 100 : 0}%` }}
              title={`${row.name} · ${formatContextTokenCount(row.tokens)}`}
            />
          ))}
        </div>
      </div>
      {rows.length > 0 && (
        <ul className="space-y-0.5" data-session-context-rows>
          {rows.map((row) => (
            <li key={row.name} className="flex items-center gap-2">
              <span className={cn('size-2 shrink-0 rounded-sm', colors.get(row))} aria-hidden />
              <span className="min-w-0 flex-1 truncate">{row.name}</span>
              <span className="shrink-0 text-muted-foreground tabular-nums">{formatContextTokenCount(row.tokens)}</span>
              <span className="w-10 shrink-0 text-right text-muted-foreground tabular-nums">{share(row.tokens, usage.size)}</span>
            </li>
          ))}
          {free && (
            <li className="flex items-center gap-2">
              <span className="size-2 shrink-0 rounded-sm border border-border bg-muted" aria-hidden />
              <span className="min-w-0 flex-1 truncate">{free.name}</span>
              <span className="shrink-0 text-muted-foreground tabular-nums">{formatContextTokenCount(free.tokens)}</span>
              <span className="w-10 shrink-0 text-right text-muted-foreground tabular-nums">{share(free.tokens, usage.size)}</span>
            </li>
          )}
          {deferred.map((row) => (
            <li key={row.name} className="flex items-center gap-2 text-muted-foreground" title={t('Not in the window until a tool search loads them.')}>
              <span className="size-2 shrink-0 rounded-sm border border-dashed border-muted-foreground/60" aria-hidden />
              <span className="min-w-0 flex-1 truncate">{row.name}</span>
              <span className="shrink-0 tabular-nums">{formatContextTokenCount(row.tokens)}</span>
              <span className="w-10 shrink-0" />
            </li>
          ))}
        </ul>
      )}
      <div className="space-y-1">
        <Disclosure label={t('MCP tools')} count={usage.mcpTools.length}>
          <McpToolList tools={usage.mcpTools} />
        </Disclosure>
        <Disclosure label={t('Memory files')} count={usage.memoryFiles.length}>
          <ul className="space-y-0.5" data-session-memory-files>
            {usage.memoryFiles.map((file) => (
              <li key={file.path} className="flex items-center gap-2" title={file.path}>
                <span className="min-w-0 flex-1 truncate font-mono text-[11px]">{file.path.split(/[\\/]/).slice(-2).join('/')}</span>
                <span className="shrink-0 text-muted-foreground tabular-nums">{formatContextTokenCount(file.tokens)}</span>
              </li>
            ))}
          </ul>
        </Disclosure>
        <LoadedItems usage={usage} used={used} />
      </div>
    </Section>
  )
}

function McpToolList({ tools }: { tools: ContextUsage['mcpTools'] }) {
  const servers = new Map<string, ContextUsage['mcpTools']>()
  for (const tool of tools) servers.set(tool.server, [...(servers.get(tool.server) ?? []), tool])
  return (
    <div className="space-y-1.5" data-session-mcp-tools>
      {[...servers].map(([server, list]) => (
        <div key={server}>
          <div className="truncate text-[11px] text-muted-foreground">
            {server} · {list.length}
          </div>
          <ul className="space-y-0.5">
            {list.map((tool) => (
              <li key={tool.name} className={cn('flex items-center gap-2', !tool.loaded && 'text-muted-foreground')} title={tool.loaded ? tool.name : `${tool.name} · ${t('deferred')}`}>
                <span className="min-w-0 flex-1 truncate font-mono text-[11px]">{tool.name.startsWith(`mcp__${server}__`) ? tool.name.slice(server.length + 7) : tool.name}</span>
                <span className="shrink-0 tabular-nums">{tool.loaded ? formatContextTokenCount(tool.tokens) : t('deferred')}</span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  )
}

/** The skills, MCP servers, memory files and subagents loaded every turn, and whether this chat used them. */
function LoadedItems({ usage, used }: { usage: ContextUsage; used: ChatUse }) {
  const uses = (kind: ItemKind, name: string) => (kind === 'memory' ? null : (used[kind].get(name) ?? 0))
  const idle = (kind: ItemKind, name: string, tokens: number) =>
    uses(kind, name) === 0 && tokens >= NOTABLE_TOKENS && !(kind === 'mcp' && name === MANAGER_MCP_SERVER_NAME)
  const idleTokens = usage.items.filter((i) => idle(i.kind, i.name, i.tokens)).reduce((n, i) => n + i.tokens, 0)
  const items = [...usage.items].sort((a, b) => b.tokens - a.tokens)
  return (
    <Disclosure
      label={idleTokens > 0 ? `${t('Loaded every turn')} · ${t('{tokens} unused in this thread', { tokens: formatContextTokenCount(idleTokens) })}` : t('Loaded every turn')}
      count={items.length}
    >
      <ul className="space-y-0.5" data-agent-context-items>
        {items.map((i) => {
          const count = uses(i.kind, i.name)
          return (
            <li key={`${i.kind}:${i.name}`} className={cn('flex items-center gap-2', idle(i.kind, i.name, i.tokens) && 'text-status-warning')} title={i.name}>
              <span className="w-11 shrink-0 text-[11px] text-muted-foreground">{KIND_LABELS[i.kind]}</span>
              <span className="min-w-0 flex-1 truncate">{i.kind === 'memory' ? i.name.split(/[\\/]/).slice(-2).join('/') : i.name}</span>
              <span className="shrink-0 tabular-nums">{formatContextTokenCount(i.tokens)}</span>
              <span className="w-8 shrink-0 text-right text-[11px] text-muted-foreground tabular-nums" title={t('Calls in this thread')}>
                {count === null ? '—' : `×${count}`}
              </span>
            </li>
          )
        })}
      </ul>
    </Disclosure>
  )
}

type CompactState = 'idle' | 'sent' | 'running' | 'done'

/** Sends /compact; says it is compacting while the turn runs and that it is done after. */
function CompactButton({ session }: { session: Session }) {
  const [state, setState] = useState<CompactState>('idle')
  const working = isWorking(session)
  const previous = useRef(working)
  useEffect(() => {
    if (state === 'sent' && working) setState('running')
    else if ((state === 'running' || state === 'sent') && !working && previous.current) setState('done')
    previous.current = working
  }, [working, state])
  useEffect(() => {
    if (state !== 'done') return
    const timer = setTimeout(() => setState('idle'), 6000)
    return () => clearTimeout(timer)
  }, [state])
  const busy = state === 'sent' || state === 'running'
  const empty = !session.items.some((item) => item.kind === 'user')
  return (
    <Button
      variant="outline"
      size="sm"
      className="h-6 gap-1 px-2 text-[11px]"
      disabled={working || busy || empty}
      title={
        empty
          ? t('There is no conversation to compact yet.')
          : working && !busy
            ? t('Wait for the turn to end.')
            : t('Summarise the conversation so far to free context (/compact).')
      }
      onClick={() => {
        setState('sent')
        submitPrompt(session.id, '/compact', [])
      }}
      data-session-compact={state}
    >
      {busy ? <Loader2 className="size-3 animate-spin" /> : <Shrink className="size-3" />}
      {busy ? t('Compacting…') : state === 'done' ? t('Compacted') : t('Compact')}
    </Button>
  )
}
