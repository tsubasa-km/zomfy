import { ChevronRight, ShieldQuestion } from 'lucide-react'
import { cn } from '@/lib/utils'
import { NativeChatToolLine } from './NativeChatToolLine'
import { NativeChatSubagentRun } from './NativeChatSubagentRun'
import { useNativeChatDisclosure } from './native-chat-disclosure-store'
import { isSubagentTool, shortenPaths, type ApprovalOutcome, type ToolNode } from './native-chat-transcript-model'

// A run of tool calls folds into one line, as the Claude app shows "Ran 4 commands": the reader
// opens it for the calls; while one is still going, that call shows under the line.

const KIND_PHRASES: Record<string, [string, string, string]> = {
  execute: ['Ran', 'command', 'commands'],
  read: ['Read', 'file', 'files'],
  edit: ['Edited', 'file', 'files'],
  delete: ['Deleted', 'file', 'files'],
  move: ['Moved', 'file', 'files'],
  search: ['Searched', 'time', 'times'],
  fetch: ['Fetched', 'page', 'pages']
}

/** "Ran 2 commands, edited 1 file" from the calls' kinds, in the order they first appear. */
export function toolRunSummary(tools: ToolNode[]): string {
  const counts = new Map<string, number>()
  for (const { tool } of tools) {
    const kind = isSubagentTool(tool) ? 'agent' : KIND_PHRASES[tool.toolKind] ? tool.toolKind : 'other'
    counts.set(kind, (counts.get(kind) ?? 0) + 1)
  }
  const parts = [...counts].map(([kind, n]) => {
    if (kind === 'agent') return `ran ${n} agent${n > 1 ? 's' : ''}`
    if (kind === 'other') return `${n} other step${n > 1 ? 's' : ''}`
    const [verb, one, many] = KIND_PHRASES[kind]!
    return `${verb.toLowerCase()} ${n} ${n > 1 ? many : one}`
  })
  const text = parts.join(', ')
  return text.charAt(0).toUpperCase() + text.slice(1)
}

const OUTCOME_LABELS: Record<ApprovalOutcome, string> = { allowed: 'Allowed', rejected: 'Rejected', expired: 'Expired' }

export function NativeChatDecisionLine({ title, outcome, cwd }: { title: string; outcome: ApprovalOutcome; cwd: string }) {
  return (
    <div data-approval-outcome={outcome} className="flex items-center gap-1.5 text-xs text-chat-foreground-faint">
      <ShieldQuestion className="size-3.5" aria-hidden />
      <span className="truncate">
        {OUTCOME_LABELS[outcome]}: {shortenPaths(title, cwd)}
      </span>
    </div>
  )
}

function Call({ node, rowKey, cwd }: { node: ToolNode; rowKey: string; cwd: string }) {
  return (
    <>
      {isSubagentTool(node.tool) ? (
        <NativeChatSubagentRun node={node} rowKey={rowKey} cwd={cwd} />
      ) : (
        <NativeChatToolLine tool={node.tool} cwd={cwd} />
      )}
      {node.decision ? <NativeChatDecisionLine title={node.decision.title} outcome={node.decision.outcome} cwd={cwd} /> : null}
    </>
  )
}

const running = (node: ToolNode) => node.tool.status === 'pending' || node.tool.status === 'in_progress'

export function NativeChatToolGroup({ tools, rowKey, cwd }: { tools: ToolNode[]; rowKey: string; cwd: string }) {
  const { open, setOpen } = useNativeChatDisclosure(`${rowKey}:tool-run`, false)
  if (tools.length === 1) {
    return (
      <div className="flex flex-col">
        <Call node={tools[0]!} rowKey={rowKey} cwd={cwd} />
      </div>
    )
  }
  const live = tools.filter(running)
  const failed = tools.filter((n) => n.tool.status === 'failed').length
  return (
    <div className="flex flex-col" data-native-chat-tool-run={open ? 'open' : 'closed'}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="group/tool-run flex min-h-6.5 w-full items-center gap-1.5 rounded-md text-left text-sm text-chat-foreground-faint hover:text-chat-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-inset"
      >
        <span className="min-w-0 truncate">{toolRunSummary(tools)}</span>
        {failed > 0 ? <span className="shrink-0 text-xs text-destructive/80">{failed} failed</span> : null}
        <ChevronRight aria-hidden className={cn('size-3.5 shrink-0 transition-transform', open && 'rotate-90')} />
      </button>
      {open ? (
        <div className="ml-1.5 flex flex-col border-l border-border pl-2.5">
          {tools.map((node) => (
            <Call key={node.tool.id} node={node} rowKey={rowKey} cwd={cwd} />
          ))}
        </div>
      ) : (
        live.map((node) => <Call key={node.tool.id} node={node} rowKey={rowKey} cwd={cwd} />)
      )}
    </div>
  )
}
