import { useState } from 'react'
import type * as acp from '@agentclientprotocol/sdk'
import {
  Bot,
  ChevronRight,
  Eye,
  Globe,
  ListChecks,
  Pencil,
  Search,
  SquareTerminal,
  Trash2,
  Wrench,
  type LucideIcon
} from 'lucide-react'
import { diffFromToolCall } from '@/shared/native-chat-diff'
import { cn } from '@/lib/utils'
import { NativeChatExpandable } from './NativeChatExpandable'
import { NativeChatDiffView } from './NativeChatDiffView'
import { toolNameOf, type ToolItem } from './native-chat-transcript-model'

// Classes follow Orca's NativeChatToolLine / NativeChatToolIcon.
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

function glyphFor(tool: ToolItem): LucideIcon {
  const name = toolNameOf(tool)
  if (name === 'Task' || name === 'Agent') return Bot
  if (name === 'TodoWrite') return ListChecks
  return TOOL_GLYPHS[tool.toolKind] ?? Wrench
}

const TARGET_CLASS =
  'min-w-0 truncate text-chat-foreground transition-colors group-hover/tool-line:text-chat-foreground-strong'

export function NativeChatToolLine({ tool }: { tool: ToolItem }) {
  const [expanded, setExpanded] = useState(false)
  const Glyph = glyphFor(tool)
  const failed = tool.status === 'failed'
  const [verb, ...rest] = tool.title.split(': ')
  const target = rest.join(': ')
  const command = commandOf(tool.input)
  const diff = failed ? null : diffFromToolCall(toolNameOf(tool), tool.input)
  const hasDetail = tool.output.length > 0 || command !== null || diff !== null

  return (
    <div data-native-chat-tool={tool.id}>
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
            {diff ? <NativeChatDiffView lines={diff} /> : null}
            {tool.output && !diff ? (
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
  if (typeof input !== 'object' || input === null || !('command' in input)) return null
  return typeof input.command === 'string' ? input.command : null
}
