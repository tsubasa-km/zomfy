import { useState } from 'react'
import { Bot, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { NativeChatMarkdown } from './NativeChatMarkdown'
import { NativeChatToolLine } from './NativeChatToolLine'
import type { ToolNode } from './native-chat-transcript-model'

type SubagentState = 'working' | 'completed' | 'failed'

// Dot classes from Orca's NativeChatSubagentRun.
const STATE_DOT_CLASS: Record<SubagentState, string> = {
  working: 'bg-foreground/70',
  completed: 'bg-muted-foreground/60',
  failed: 'bg-destructive'
}

const STATE_LABEL: Record<SubagentState, string> = {
  working: 'Working',
  completed: 'Done',
  failed: 'Failed'
}

function stateOf(status: string): SubagentState {
  if (status === 'failed') return 'failed'
  return status === 'completed' ? 'completed' : 'working'
}

function field(input: unknown, key: string): string | null {
  if (typeof input !== 'object' || input === null) return null
  const value = Object.fromEntries(Object.entries(input))[key]
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

/** One Task call: the subagent's headline and state, opening onto the calls it made and its report. */
export function NativeChatSubagentRun({ node, rowKey, cwd }: { node: ToolNode; rowKey: string; cwd: string }) {
  const [open, setOpen] = useState(false)
  const { tool, children } = node
  const state = stateOf(tool.status)
  const working = state === 'working'
  const headline = field(tool.input, 'description') ?? 'Subagent'
  const agentType = field(tool.input, 'subagent_type')
  const calls = children.length

  return (
    <div data-native-chat-tool={tool.id}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="group/subagent-run flex min-h-6 w-full items-center gap-1.5 rounded-md py-0.5 text-left font-sans text-sm leading-relaxed text-chat-foreground-faint hover:bg-accent/20 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-inset"
        aria-expanded={open}
        aria-live="polite"
      >
        <span className="flex size-4 shrink-0 items-center justify-center text-chat-foreground-faint">
          <Bot aria-hidden className="size-3.5" />
        </span>
        <span
          aria-hidden
          className={cn(
            'size-1.5 shrink-0 rounded-full',
            STATE_DOT_CLASS[state],
            working && 'animate-pulse motion-reduce:animate-none'
          )}
        />
        <span className={cn('min-w-0 truncate', working && 'text-chat-foreground')}>{headline}</span>
        {agentType ? (
          <code className="min-w-0 shrink truncate font-mono text-2xs text-chat-foreground-faint">{agentType}</code>
        ) : null}
        <span className="ml-auto shrink-0 font-sans text-xs text-chat-foreground-faint tabular-nums">
          {STATE_LABEL[state]}
          {calls > 0 ? ` · ${calls} ${calls === 1 ? 'call' : 'calls'}` : null}
        </span>
        <ChevronRight
          className={cn(
            'size-3.5 shrink-0 text-chat-foreground-faint transition-all motion-reduce:transition-none',
            open ? 'rotate-90 opacity-100' : 'opacity-0 group-hover/subagent-run:opacity-100'
          )}
        />
      </button>
      {open ? (
        <div className="mt-1 ml-2 border-l border-border pl-3">
          {children.map((child) => (
            <NativeChatToolLine key={child.id} tool={child} cwd={cwd} />
          ))}
          {tool.output && !working ? (
            <div className="mt-1 mb-2 text-sm text-chat-foreground">
              <NativeChatMarkdown rowKey={`${rowKey}:subagent:${tool.id}`} content={tool.output} className="text-sm" />
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
