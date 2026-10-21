import { useState } from 'react'
import { ChevronRight, ShieldQuestion, Undo2 } from 'lucide-react'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { NativeChatMarkdown } from './NativeChatMarkdown'
import { NativeChatCopyButton } from './NativeChatCopyButton'
import { NativeChatToolLine } from './NativeChatToolLine'
import { NativeChatSubagentRun } from './NativeChatSubagentRun'
import { NativeChatTaskList } from './NativeChatTaskList'
import { NativeChatTurnDiffRollup } from './NativeChatTurnDiffRollup'
import { NATIVE_CHAT_QUOTE_SOURCE_PROPS } from './NativeChatSelectionQuote'
import { isSubagentTool, type TranscriptRowModel } from './native-chat-transcript-model'

// Rows follow Orca's NativeChatUserMessageRow, NativeChatAssistantMessageRow,
// NativeChatReasoningRow, NativeChatToolRun and NativeChatNoticeRow.

/** Hover-revealed controls under a message, as Orca reveals copy and rewind together. */
const META_REVEAL =
  'transition-opacity can-hover:pointer-events-none can-hover:opacity-0 group-hover:pointer-events-auto group-hover:opacity-100 [.group:has(:focus-visible)_&]:pointer-events-auto [.group:has(:focus-visible)_&]:opacity-100'

export type TranscriptRowActions = {
  /** Absent while a turn runs: rewinding needs the agent stopped. */
  onRewind?: (messageId: string) => void
  onRevealFile: (path: string) => void
}

export function NativeChatTranscriptRow({
  row,
  rowKey,
  actions
}: {
  row: TranscriptRowModel
  rowKey: string
  actions: TranscriptRowActions
}) {
  switch (row.kind) {
    case 'user': {
      const { item } = row
      const messageId = item.messageId
      return (
        <div
          className="group relative flex flex-col items-end gap-0.5"
          data-native-chat-user-row={rowKey}
          data-native-chat-message-text={item.text}
        >
          <div className="max-w-[80%] rounded-xl border border-chat-user-border bg-chat-user-surface px-3.5 py-2.5 text-sm text-chat-foreground-strong">
            {item.images?.length ? (
              <div className="mb-1.5 flex flex-wrap justify-end gap-2">
                {item.images.map((image, index) => (
                  <img
                    key={index}
                    src={`data:${image.mimeType};base64,${image.data}`}
                    alt={`Image ${index + 1}`}
                    className="max-h-40 max-w-60 rounded-md border border-border object-contain"
                  />
                ))}
              </div>
            ) : null}
            {item.text ? <NativeChatMarkdown rowKey={rowKey} content={item.text} className="text-sm" /> : null}
          </div>
          <div data-native-chat-find-skip className={cn('flex items-center gap-1 select-none', META_REVEAL)}>
            {item.text ? <NativeChatCopyButton text={item.text} /> : null}
            {messageId && actions.onRewind ? (
              <RewindButton onRewind={() => actions.onRewind?.(messageId)} />
            ) : null}
          </div>
        </div>
      )
    }
    case 'agent':
      return (
        <div
          className="group relative max-w-full text-sm leading-relaxed text-chat-foreground select-text"
          data-native-chat-message-text={row.text}
        >
          <div {...NATIVE_CHAT_QUOTE_SOURCE_PROPS}>
            <NativeChatMarkdown rowKey={rowKey} content={row.text} className="text-sm" />
          </div>
          <div data-native-chat-find-skip className={cn('mt-1 -mb-5 flex w-fit items-center gap-1 select-none', META_REVEAL)}>
            <NativeChatCopyButton text={row.text} />
          </div>
        </div>
      )
    case 'thought':
      return <ReasoningRow markdown={row.text} rowKey={rowKey} />
    case 'tools':
      return (
        <div className="flex flex-col">
          {row.tools.map((node) =>
            isSubagentTool(node.tool) ? (
              <NativeChatSubagentRun key={node.tool.id} node={node} rowKey={rowKey} />
            ) : (
              <NativeChatToolLine key={node.tool.id} tool={node.tool} />
            )
          )}
        </div>
      )
    case 'tasks':
      return <NativeChatTaskList list={row.list} previous={row.previous} />
    case 'turn-diff':
      return <NativeChatTurnDiffRollup diff={row.diff} onReveal={actions.onRevealFile} />
    case 'decision':
      return (
        <div className="flex items-center gap-1.5 text-xs text-chat-foreground-faint">
          <ShieldQuestion className="size-3.5" aria-hidden />
          <span className="truncate">
            {row.chosen === 'reject' || row.chosen === 'cancelled' ? 'Rejected' : 'Allowed'}: {row.title}
          </span>
        </div>
      )
    case 'compaction': {
      const label = row.status === 'completed' ? 'Context compacted' : row.status === 'in_progress' ? 'Compacting context…' : 'Compaction failed'
      return (
        <div role="separator" aria-label={label} className="flex items-center gap-3 py-2 text-xs text-chat-foreground-faint">
          <span className="h-px flex-1 bg-border" />
          <span>{label}</span>
          <span className="h-px flex-1 bg-border" />
        </div>
      )
    }
    case 'notice':
      return row.severity === 'error' ? (
        <p className="min-w-0 max-w-full text-sm break-words text-destructive select-text">{row.text}</p>
      ) : (
        <div className="flex min-h-8 items-center gap-1 border-b border-border text-sm text-chat-foreground-faint tabular-nums">
          {row.text}
        </div>
      )
  }
}

function RewindButton({ onRewind }: { onRewind: () => void }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label="Rewind to here"
          data-native-chat-rewind
          className="flex size-6 shrink-0 items-center justify-center rounded-md text-chat-foreground-faint transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          onClick={onRewind}
        >
          <Undo2 className="size-3.5" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" sideOffset={4}>
        Rewind to here
      </TooltipContent>
    </Tooltip>
  )
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
