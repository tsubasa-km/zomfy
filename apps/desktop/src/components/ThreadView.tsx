import { useEffect, useRef, useState } from 'react'
import type * as acp from '@agentclientprotocol/sdk'
import {
  ArrowUp,
  ChevronRight,
  Eye,
  Globe,
  Pencil,
  Search,
  ShieldQuestion,
  Square,
  SquareTerminal,
  Trash2,
  Wrench,
  type LucideIcon
} from 'lucide-react'
import { answerPermission, cancelTurn, sendPrompt } from '@/daemon-connection'
import type { Session, ThreadItem } from '@/session-store'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { NativeChatMarkdown } from '@/components/native-chat/NativeChatMarkdown'
import { NativeChatExpandable } from '@/components/native-chat/NativeChatExpandable'
import { cn } from '@/lib/utils'
import '@/components/native-chat/native-chat-appearance.css'

// Layout and classes follow Orca's native chat (NativeChatMessageList, *MessageRow, NativeChatToolLine,
// NativeChatReasoningRow, NativeChatApprovalCard, NativeChatComposerField, NativeChatWorkingStatus).
const TRANSCRIPT_OUTER_CLASS = 'px-3 pt-10 pb-10 sm:px-4'
const TRANSCRIPT_COLUMN_CLASS =
  'mx-auto flex w-full max-w-(--chat-content-max-width) flex-col gap-5 px-[5px]'

export function ThreadView({ session }: { session: Session }) {
  const bottom = useRef<HTMLDivElement>(null)
  useEffect(() => {
    // Braces matter: newer WebView2 returns a Promise here, which React would treat as cleanup.
    void bottom.current?.scrollIntoView({ block: 'end' })
  }, [session.items])

  const pendingPermission = session.items.findLast(
    (item): item is Extract<ThreadItem, { kind: 'permission' }> =>
      item.kind === 'permission' && item.chosen === null
  )

  return (
    <div className="native-chat-appearance flex min-h-0 min-w-0 flex-1 flex-col bg-chat-canvas text-chat-foreground">
      <div className="relative min-h-0 flex-1">
        <div className="scrollbar-sleek relative h-full overflow-y-auto [overflow-anchor:none] [scrollbar-gutter:stable_both-edges]">
          <div className={TRANSCRIPT_OUTER_CLASS}>
            <div className={TRANSCRIPT_COLUMN_CLASS}>
              {groupTranscript(session.items).map((row, index) => (
                <TranscriptRow key={index} row={row} rowKey={`${session.id}:${index}`} />
              ))}
              {session.turnStartedAt !== null && <WorkingStatus startedAt={session.turnStartedAt} />}
              <div ref={bottom} />
            </div>
          </div>
        </div>
      </div>
      {pendingPermission && <ApprovalCard permission={pendingPermission} />}
      <Composer session={session} />
    </div>
  )
}

type TranscriptRowModel =
  | Exclude<ThreadItem, { kind: 'tool' } | { kind: 'permission' }>
  | { kind: 'tools'; tools: Extract<ThreadItem, { kind: 'tool' }>[] }
  | { kind: 'decision'; title: string; chosen: string }

/** Consecutive tool calls read as one run, the way Orca folds them under a run header. */
function groupTranscript(items: ThreadItem[]): TranscriptRowModel[] {
  const rows: TranscriptRowModel[] = []
  for (const item of items) {
    if (item.kind === 'tool') {
      const last = rows.at(-1)
      if (last?.kind === 'tools') last.tools.push(item)
      else rows.push({ kind: 'tools', tools: [item] })
    } else if (item.kind === 'permission') {
      if (item.chosen) rows.push({ kind: 'decision', title: item.title, chosen: item.chosen })
    } else {
      rows.push(item)
    }
  }
  return rows
}

function TranscriptRow({ row, rowKey }: { row: TranscriptRowModel; rowKey: string }) {
  switch (row.kind) {
    case 'user':
      return (
        <div className="group relative flex flex-col items-end gap-0.5">
          <div className="max-w-[80%] rounded-xl border border-chat-user-border bg-chat-user-surface px-3.5 py-2.5 text-sm text-chat-foreground-strong">
            <NativeChatMarkdown rowKey={rowKey} content={row.text} className="text-sm" />
          </div>
        </div>
      )
    case 'agent':
      return (
        <div className="group relative max-w-full text-sm leading-relaxed text-chat-foreground select-text">
          <NativeChatMarkdown rowKey={rowKey} content={row.text} className="text-sm" />
        </div>
      )
    case 'thought':
      return <ReasoningRow markdown={row.text} rowKey={rowKey} />
    case 'tools':
      return (
        <div className="flex flex-col">
          {row.tools.map((tool) => (
            <ToolLine key={tool.id} tool={tool} />
          ))}
        </div>
      )
    case 'decision':
      return (
        <div className="flex items-center gap-1.5 text-xs text-chat-foreground-faint">
          <ShieldQuestion className="size-3.5" aria-hidden />
          <span className="truncate">
            {row.chosen === 'reject' || row.chosen === 'cancelled' ? 'Rejected' : 'Allowed'}: {row.title}
          </span>
        </div>
      )
    case 'notice':
      return (
        <div className="flex min-h-8 items-center gap-1 border-b border-border text-sm text-chat-foreground-faint tabular-nums">
          {row.text}
        </div>
      )
  }
}

function ReasoningRow({ markdown, rowKey }: { markdown: string; rowKey: string }) {
  const [open, setOpen] = useState(false)
  if (!markdown.trim()) return null
  return (
    <div className="min-w-0 text-sm text-chat-foreground-faint">
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="group/reasoning flex min-h-6 w-full min-w-0 items-center gap-1.5 rounded-md py-0.5 text-left focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-inset"
          >
            <span className="flex size-4 shrink-0 items-center justify-center">
              <BrainGlyph />
            </span>
            <span className="min-w-0 truncate text-sm leading-relaxed text-chat-foreground-faint transition-colors group-hover/reasoning:text-chat-foreground">
              Thinking
            </span>
            <ChevronRight className="size-3.5 shrink-0 text-chat-foreground-faint transition-all group-hover/reasoning:opacity-100 group-data-[state=open]/reasoning:rotate-90 group-data-[state=open]/reasoning:opacity-100 motion-reduce:transition-none can-hover:opacity-0" />
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="scrollbar-sleek mt-1 max-h-80 overflow-y-auto pl-5.5 text-chat-foreground-faint">
            <NativeChatMarkdown rowKey={`${rowKey}:reasoning`} content={markdown} className="text-sm" />
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  )
}

function BrainGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="size-3.5" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
      <path d="M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z" />
      <path d="M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z" />
    </svg>
  )
}

const TOOL_GLYPHS: Record<acp.ToolKind, LucideIcon> = {
  read: Eye,
  edit: Pencil,
  delete: Trash2,
  move: Pencil,
  search: Search,
  execute: SquareTerminal,
  think: Wrench,
  fetch: Globe,
  switch_mode: Wrench,
  other: Wrench
}

const TARGET_CLASS =
  'min-w-0 truncate text-chat-foreground transition-colors group-hover/tool-line:text-chat-foreground-strong'

function ToolLine({ tool }: { tool: Extract<ThreadItem, { kind: 'tool' }> }) {
  const [expanded, setExpanded] = useState(false)
  const Glyph = TOOL_GLYPHS[tool.toolKind] ?? Wrench
  const failed = tool.status === 'failed'
  const [verb, ...rest] = tool.title.split(': ')
  const target = rest.join(': ')
  const command = commandOf(tool.input)
  const hasDetail = tool.output.length > 0 || command !== null

  return (
    <div>
      <button
        type="button"
        onClick={() => hasDetail && setExpanded(!expanded)}
        className={cn(
          'group/tool-line flex min-h-6.5 w-full items-center gap-2 rounded-md text-left font-sans text-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-inset',
          hasDetail ? 'cursor-pointer' : 'cursor-default'
        )}
        aria-expanded={hasDetail ? expanded : undefined}
      >
        <span
          className={cn(
            'flex size-4 shrink-0 items-center justify-center',
            failed ? 'text-destructive/70' : 'text-chat-foreground-faint'
          )}
        >
          {tool.status === 'in_progress' || tool.status === 'pending' ? (
            <span className="agent-working-spinner block size-2.5 rounded-full border-[1.5px] border-current border-t-transparent" />
          ) : (
            <Glyph aria-hidden className="size-3.5" />
          )}
        </span>
        <span className="shrink-0 text-chat-foreground-faint transition-colors group-hover/tool-line:text-chat-foreground">
          {verb}
        </span>
        {target ? (
          <span className={TARGET_CLASS} title={target}>
            {target}
          </span>
        ) : null}
        <span className="ml-auto flex shrink-0 items-center gap-1.5 pl-2">
          {hasDetail ? (
            <ChevronRight
              className={cn(
                'size-3.5 shrink-0 text-chat-foreground-faint transition-transform motion-reduce:transition-none',
                expanded && 'rotate-90'
              )}
            />
          ) : null}
        </span>
      </button>
      {hasDetail ? (
        <NativeChatExpandable open={expanded}>
          <div className="mt-1 mb-2 ml-6 space-y-2">
            {command ? (
              <pre className="scrollbar-sleek max-h-64 overflow-auto rounded-lg border border-chat-code-border bg-chat-code-surface p-2 font-mono text-chat-code break-words whitespace-pre-wrap text-chat-foreground">
                {command}
              </pre>
            ) : null}
            {tool.output ? (
              <pre
                className={cn(
                  'scrollbar-sleek max-h-64 overflow-auto rounded-lg border border-chat-code-border bg-chat-code-surface p-2 font-mono text-chat-code break-words whitespace-pre-wrap',
                  failed ? 'text-destructive' : 'text-chat-foreground'
                )}
              >
                {tool.output.length > 20_000 ? `${tool.output.slice(0, 20_000)}\n…` : tool.output}
              </pre>
            ) : null}
          </div>
        </NativeChatExpandable>
      ) : null}
    </div>
  )
}

function commandOf(input: unknown): string | null {
  if (typeof input !== 'object' || input === null) return null
  const command = (input as Record<string, unknown>).command
  return typeof command === 'string' ? command : null
}

function WorkingStatus({ startedAt }: { startedAt: number }) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])
  const seconds = Math.max(0, Math.floor((now - startedAt) / 1000))
  return (
    <div className="flex min-h-8 items-center gap-1 border-b border-border text-sm text-chat-foreground-faint tabular-nums">
      <span>Working for {seconds}s</span>
    </div>
  )
}

function ApprovalCard({ permission }: { permission: Extract<ThreadItem, { kind: 'permission' }> }) {
  // Allow first, as Orca puts the primary choice first.
  const options = [...permission.options].sort(
    (a, b) => Number(b.kind.startsWith('allow')) - Number(a.kind.startsWith('allow'))
  )
  return (
    <div className="min-h-0 shrink overflow-hidden bg-chat-canvas">
      <div className="mx-auto flex h-full max-h-full min-h-0 w-full max-w-(--chat-content-max-width) px-3 pt-2 pb-1 sm:px-4">
        <div
          role="group"
          aria-label={permission.title}
          className="flex min-h-0 w-full flex-1 flex-col gap-2 overflow-hidden rounded-lg border border-input bg-card px-4 py-3 shadow-xs"
        >
          <div className="flex shrink-0 items-start gap-2">
            <ShieldQuestion className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <p className="line-clamp-2 text-sm font-semibold break-words text-foreground">
                Allow {permission.title}?
              </p>
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            {options.map((option, i) => (
              <button
                key={option.optionId}
                data-approval-option={option.optionId}
                type="button"
                onClick={() => answerPermission(permission.requestId, option.optionId)}
                className={cn(
                  'rounded-md px-4 py-1.5 text-sm font-semibold transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50',
                  i === 0
                    ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                    : 'border border-border bg-background text-foreground hover:bg-accent'
                )}
              >
                {option.name}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

function Composer({ session }: { session: Session }) {
  const [text, setText] = useState('')
  const working = session.status === 'working' || session.status === 'needs-you'

  function submit() {
    const value = text.trim()
    if (!value || working) return
    setText('')
    void sendPrompt(session.id, value)
  }

  return (
    <div className="shrink-0 bg-chat-canvas">
      <div className="px-3 pt-2 pb-4 sm:px-4">
        <div className="relative mx-auto w-full max-w-(--chat-content-max-width)">
          <div className="rounded-xl border border-chat-composer-border bg-chat-composer-surface p-1.5 shadow-xs [contain:paint]">
            <textarea
              aria-label="Message the agent"
              placeholder="Message the agent"
              value={text}
              rows={2}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault()
                  submit()
                }
              }}
              className="scrollbar-sleek max-h-[calc(8lh+0.5rem)] min-h-12 w-full resize-none overflow-y-auto bg-transparent px-2 py-1 text-sm text-chat-foreground-strong outline-none placeholder:text-chat-foreground-faint"
            />
            <div className="flex flex-wrap items-center gap-2 pt-0.5">
              <div className="flex w-full items-center justify-between gap-2 text-chat-foreground-faint">
                <span className="px-2 text-xs">Claude</span>
                <div className="ml-auto flex items-center gap-1.5">
                  <Button
                    type="button"
                    aria-label={working ? 'Stop the agent' : 'Send'}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => (working ? cancelTurn(session.id) : submit())}
                    disabled={!working && !text.trim()}
                    variant={working ? 'secondary' : 'default'}
                    size="icon"
                    className="size-8 rounded-full"
                  >
                    {working ? <Square className="size-3.5 fill-current" /> : <ArrowUp className="size-4" />}
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
