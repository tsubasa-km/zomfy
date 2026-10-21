import { useEffect, useRef, useState } from 'react'
import { Loader2, Minus, Plus, Trash, Undo2, X } from 'lucide-react'
import type { GitDiscardArea } from '@acp-harness/protocol'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'

// Orca's commit/discard-dialog.tsx + discard-confirmation.ts, commit/bulk-action-bar.tsx and the
// "Change Base Ref" picker.

export type PendingDiscard =
  | { kind: 'entry'; area: GitDiscardArea; path: string; deleted: boolean; paths: string[] }
  | { kind: 'area'; area: GitDiscardArea; paths: string[] }
  | { kind: 'selection'; groups: { area: GitDiscardArea; paths: string[] }[] }

function discardCopy(pending: PendingDiscard): { title: string; description: string; confirmLabel: string } {
  if (pending.kind === 'entry') {
    const name = pending.path.split('/').at(-1)
    if (pending.area === 'untracked') {
      return { title: `Delete "${name}"?`, description: 'This will permanently delete this file. This cannot be undone.', confirmLabel: 'Delete' }
    }
    if (pending.area === 'staged') {
      return {
        title: `Discard changes to "${name}"?`,
        description: 'This will unstage and revert the changes to this file. A staged new file will be deleted. This cannot be undone.',
        confirmLabel: 'Discard'
      }
    }
    if (pending.deleted) {
      return {
        title: `Restore "${name}"?`,
        description: 'This will restore the last staged version and discard the deletion. This cannot be undone.',
        confirmLabel: 'Restore'
      }
    }
    return {
      title: `Discard changes to "${name}"?`,
      description: 'This will revert the unstaged changes to this file. This cannot be undone.',
      confirmLabel: 'Discard'
    }
  }
  if (pending.kind === 'selection') {
    const count = pending.groups.reduce((n, g) => n + g.paths.length, 0)
    const deletes = pending.groups.some((g) => g.area === 'untracked')
    return {
      title: count === 1 ? 'Discard changes to 1 selected file?' : `Discard changes to ${count} selected files?`,
      description: `Tracked files revert to their last committed or staged version${deletes ? '; untracked files are deleted' : ''}. This cannot be undone.`,
      confirmLabel: count === 1 ? 'Discard' : `Discard ${count}`
    }
  }
  const count = pending.paths.length
  switch (pending.area) {
    case 'untracked':
      return {
        title: count === 1 ? 'Delete 1 untracked file?' : `Delete ${count} untracked files?`,
        description:
          count === 1
            ? 'This will permanently delete this untracked file. This cannot be undone.'
            : `This will permanently delete these ${count} untracked files. This cannot be undone.`,
        confirmLabel: count === 1 ? 'Delete' : `Delete ${count}`
      }
    case 'staged':
      return {
        title: 'Discard all staged changes?',
        description: 'This will unstage and revert all staged changes. Staged new files will be deleted. This cannot be undone.',
        confirmLabel: 'Discard all'
      }
    case 'unstaged':
      return {
        title: 'Discard all unstaged changes?',
        description:
          count === 1 ? 'This will revert the unstaged changes in 1 file. This cannot be undone.' : `This will revert unstaged changes in ${count} files. This cannot be undone.`,
        confirmLabel: 'Discard all'
      }
  }
}

export function DiscardDialog({
  pending,
  onCancel,
  onConfirm
}: {
  pending: PendingDiscard | null
  onCancel: () => void
  onConfirm: () => void
}) {
  const confirmRef = useRef<HTMLButtonElement>(null)
  const copy = pending ? discardCopy(pending) : null
  const Icon = copy?.confirmLabel.startsWith('Delete') ? Trash : Undo2
  return (
    <Dialog open={pending !== null} onOpenChange={(open) => !open && onCancel()}>
      <DialogContent
        className="max-w-md"
        onOpenAutoFocus={(event) => {
          // Radix would focus Cancel first, letting Enter dismiss a destructive confirm.
          event.preventDefault()
          confirmRef.current?.focus()
        }}
      >
        <DialogHeader>
          <DialogTitle className="text-sm">{copy?.title ?? 'Discard changes?'}</DialogTitle>
          <DialogDescription className="text-xs">{copy?.description ?? 'This cannot be undone.'}</DialogDescription>
        </DialogHeader>
        {pending?.kind === 'area' ? (
          <div className="rounded-md border border-border/70 bg-muted/35 px-3 py-2 text-xs text-muted-foreground">
            {pending.paths.length} {pending.paths.length === 1 ? 'file' : 'files'}
          </div>
        ) : pending?.kind === 'selection' ? (
          <div className="scrollbar-sleek max-h-32 overflow-y-auto rounded-md border border-border/70 bg-muted/35 px-3 py-2 text-xs">
            {pending.groups.flatMap((g) => g.paths).map((path) => (
              <div key={path} className="break-all text-foreground">
                {path}
              </div>
            ))}
          </div>
        ) : pending?.kind === 'entry' ? (
          <div className="rounded-md border border-border/70 bg-muted/35 px-3 py-2 text-xs">
            <div className="font-medium break-all text-foreground">{pending.path}</div>
          </div>
        ) : null}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button ref={confirmRef} type="button" variant="destructive" onClick={onConfirm} data-discard-confirm>
            <Icon className="size-4" />
            {copy?.confirmLabel ?? 'Discard'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function BulkActionBar({
  selectedCount,
  stageableCount,
  unstageableCount,
  discardableCount,
  onStage,
  onUnstage,
  onDiscard,
  onClear,
  isExecuting
}: {
  selectedCount: number
  stageableCount: number
  unstageableCount: number
  discardableCount: number
  onStage: () => void
  onUnstage: () => void
  onDiscard: () => void
  onClear: () => void
  isExecuting: boolean
}) {
  return (
    <div className="absolute right-0 bottom-0 left-0 z-10 animate-in border-t border-border bg-background/95 p-2 shadow-lg backdrop-blur-sm slide-in-from-bottom-2">
      <div className="flex items-center justify-between gap-2 rounded-md border border-border/50 bg-accent/30 p-1.5 pr-2">
        <div className="ml-1 flex items-center gap-2 text-xs font-medium text-foreground">
          {isExecuting ? <Loader2 className="size-3.5 animate-spin text-muted-foreground" /> : <span className="tabular-nums">{selectedCount} selected</span>}
        </div>
        {/* Icon + count so three actions fit the 300px sidebar; the tooltip carries Orca's label. */}
        <div className="flex items-center gap-1">
          {discardableCount > 0 && <BulkButton icon={Undo2} label="Discard" count={discardableCount} onClick={onDiscard} disabled={isExecuting} />}
          {stageableCount > 0 && <BulkButton icon={Plus} label="Stage" count={stageableCount} onClick={onStage} disabled={isExecuting} />}
          {unstageableCount > 0 && <BulkButton icon={Minus} label="Unstage" count={unstageableCount} onClick={onUnstage} disabled={isExecuting} />}
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="ml-0.5 h-7 w-7 text-muted-foreground hover:bg-muted hover:text-foreground"
            onClick={onClear}
            disabled={isExecuting}
            aria-label="Clear selection"
          >
            <X className="size-3.5" />
          </Button>
        </div>
      </div>
    </div>
  )
}

function BulkButton({
  icon: Icon,
  label,
  count,
  onClick,
  disabled
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  count: number
  onClick: () => void
  disabled: boolean
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button type="button" variant="secondary" size="sm" className="h-7 gap-1 px-2 text-[11px] tabular-nums" onClick={onClick} disabled={disabled} aria-label={`${label} (${count})`}>
          <Icon className="size-3" />
          {count}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="top" sideOffset={6}>
        {`${label} (${count})`}
      </TooltipContent>
    </Tooltip>
  )
}

export function BaseRefDialog({
  open,
  current,
  loadRefs,
  onOpenChange,
  onPick
}: {
  open: boolean
  current: string | null
  loadRefs: () => Promise<{ refs: string[]; defaultBaseRef: string }>
  onOpenChange: (open: boolean) => void
  /** null resets to the repository default. */
  onPick: (ref: string | null) => void
}) {
  const [refs, setRefs] = useState<{ refs: string[]; defaultBaseRef: string } | null>(null)
  const [query, setQuery] = useState('')
  useEffect(() => {
    if (!open) return
    setQuery('')
    void loadRefs().then(setRefs, () => setRefs({ refs: [], defaultBaseRef: '' }))
  }, [open, loadRefs])
  const typed = query.trim()
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md p-0" showCloseButton={false}>
        <DialogHeader className="px-4 pt-4">
          <DialogTitle className="text-sm">Change Base Ref</DialogTitle>
          <DialogDescription className="text-xs">
            Compare this branch against another branch. {refs?.defaultBaseRef ? `Default: ${refs.defaultBaseRef}.` : ''}
          </DialogDescription>
        </DialogHeader>
        <Command className="border-t border-border">
          <CommandInput placeholder="Search branches…" value={query} onValueChange={setQuery} />
          <CommandList className="max-h-72">
            <CommandEmpty>{refs === null ? 'Loading branches…' : 'No matching branch.'}</CommandEmpty>
            <CommandGroup>
              {refs?.defaultBaseRef && (
                <CommandItem value={`default ${refs.defaultBaseRef}`} onSelect={() => onPick(null)}>
                  Use default ({refs.defaultBaseRef})
                </CommandItem>
              )}
              {typed && !refs?.refs.includes(typed) && (
                <CommandItem value={`use ${typed}`} onSelect={() => onPick(typed)}>
                  Use “{typed}”
                </CommandItem>
              )}
              {refs?.refs.map((ref) => (
                <CommandItem key={ref} value={ref} onSelect={() => onPick(ref)}>
                  <span className="font-mono">{ref}</span>
                  {ref === current && <span className="ml-auto text-[11px] text-muted-foreground">current</span>}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  )
}
