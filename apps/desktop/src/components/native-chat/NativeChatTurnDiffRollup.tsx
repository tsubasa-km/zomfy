import { useState } from 'react'
import { ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { NativeChatDiffView } from './NativeChatDiffView'
import { NativeChatExpandable } from './NativeChatExpandable'
import type { TurnDiff, TurnDiffFile } from './native-chat-transcript-model'

// Ported from Orca's NativeChatTurnDiffRollup and DiffLineCounts.

function DiffLineCounts({ added, removed }: { added: number; removed: number }) {
  if (added === 0 && removed === 0) return null
  return (
    <span className="shrink-0 text-xs tabular-nums">
      {added > 0 && <span style={{ color: 'var(--git-decoration-added)' }}>+{added}</span>}
      {added > 0 && removed > 0 && <span> </span>}
      {removed > 0 && <span style={{ color: 'var(--git-decoration-deleted)' }}>-{removed}</span>}
    </span>
  )
}

function TurnDiffFileRow({ file, onReveal }: { file: TurnDiffFile; onReveal: (path: string) => void }) {
  const [open, setOpen] = useState(false)
  return (
    <div>
      <div className="flex min-w-0 items-center">
        <Button variant="ghost" size="xs" className="min-w-0 flex-1 justify-start" onClick={() => onReveal(file.path)}>
          <span className="min-w-0 truncate font-mono" title={file.path}>
            {file.path}
          </span>
          <DiffLineCounts added={file.added} removed={file.removed} />
        </Button>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={open ? 'Hide diff' : 'Show diff'}
          title={file.path}
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          <ChevronRight aria-hidden className={open ? 'size-3.5 rotate-90' : 'size-3.5'} />
        </Button>
      </div>
      <NativeChatExpandable open={open}>
        <div className="space-y-1 py-1 pl-2">
          {file.edits.map((lines, index) => (
            <NativeChatDiffView key={index} lines={lines} />
          ))}
        </div>
      </NativeChatExpandable>
    </div>
  )
}

export function NativeChatTurnDiffRollup({ diff, onReveal }: { diff: TurnDiff; onReveal: (path: string) => void }) {
  return (
    <Collapsible className="text-xs text-muted-foreground">
      <CollapsibleTrigger asChild>
        <Button variant="ghost" size="xs" className="group w-full min-w-0 justify-start gap-1.5">
          <span className="min-w-0 truncate">
            {diff.files.length === 1 ? '1 changed file' : `${diff.files.length} changed files`}
          </span>
          <DiffLineCounts added={diff.added} removed={diff.removed} />
          <ChevronRight
            aria-hidden
            className="size-3.5 shrink-0 transition-transform group-data-[state=open]:rotate-90 motion-reduce:transition-none"
          />
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-1 space-y-1 pl-4">
        {diff.files.map((file) => (
          <TurnDiffFileRow key={file.path} file={file} onReveal={onReveal} />
        ))}
      </CollapsibleContent>
    </Collapsible>
  )
}
