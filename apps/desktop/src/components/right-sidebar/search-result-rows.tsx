import { ChevronRight, Copy, File, Replace, ReplaceAll } from 'lucide-react'
import type { SearchMatch } from '@acp-harness/protocol'
import { Button } from '@/components/ui/button'
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from '@/components/ui/context-menu'
import { cn } from '@/lib/utils'
import { copyText } from './explorer-paths'

// Orca's SearchResultItems (ToggleButton, FileResultRow, MatchResultRow), plus VS Code's replace
// preview: the hit struck through with its replacement beside it, and per-row replace buttons.

export function ToggleButton({
  active,
  onClick,
  title,
  children,
  ariaExpanded
}: {
  active: boolean
  onClick: () => void
  title: string
  children: React.ReactNode
  ariaExpanded?: boolean
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-xs"
      className={cn(
        'h-auto w-auto shrink-0 rounded-sm p-0.5',
        active ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground'
      )}
      onClick={onClick}
      title={title}
      aria-label={title}
      aria-pressed={ariaExpanded === undefined ? active : undefined}
      aria-expanded={ariaExpanded}
    >
      {children}
    </Button>
  )
}

function RowAction({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <span
      role="button"
      tabIndex={-1}
      aria-label={label}
      title={label}
      className="flex size-4 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:bg-muted hover:text-foreground"
      onClick={(event) => {
        event.stopPropagation()
        onClick()
      }}
    >
      {children}
    </span>
  )
}

export function FileResultRow({
  path,
  count,
  collapsed,
  onToggle,
  onReplaceAll
}: {
  path: string
  count: number
  collapsed: boolean
  onToggle: () => void
  /** Present while the replace field is shown. */
  onReplaceAll?: () => void
}) {
  const slash = path.lastIndexOf('/')
  return (
    <div className="pt-1.5">
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            data-search-file={path}
            title={path}
            className="group h-auto w-full justify-start gap-1 rounded-none px-2 py-0.5 text-left"
            onClick={onToggle}
          >
            <ChevronRight className={cn('size-3 shrink-0 text-muted-foreground transition-transform', !collapsed && 'rotate-90')} />
            <File className="size-3.5 shrink-0 text-muted-foreground" />
            <div className="min-w-0 flex-1 text-xs">
              <span className="block min-w-0 truncate">
                <span className="text-foreground">{path.slice(slash + 1)}</span>
                {slash >= 0 && <span className="ml-1.5 text-[11px] text-muted-foreground">{path.slice(0, slash)}</span>}
              </span>
            </div>
            {onReplaceAll && (
              <span className="hidden group-hover:flex">
                <RowAction label="Replace All in File" onClick={onReplaceAll}>
                  <ReplaceAll className="size-3" />
                </RowAction>
              </span>
            )}
            <span className="shrink-0 rounded-full bg-muted/80 px-1.5 text-[10px] text-muted-foreground tabular-nums">{count}</span>
          </Button>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem onSelect={() => copyText(path)}>
            <Copy className="size-3.5" />
            Copy Path
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    </div>
  )
}

export function MatchResultRow({
  path,
  match,
  parts,
  replacement,
  onOpen,
  onReplace
}: {
  path: string
  match: SearchMatch
  parts: { before: string; hit: string; after: string }
  /** The hit's replacement while the replace field is shown. */
  replacement: string | null
  onOpen: () => void
  onReplace?: () => void
}) {
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          data-search-match={`${path}:${match.line}`}
          className="group h-auto min-h-[18px] w-full justify-start gap-1 rounded-none py-px pr-2 pl-7 text-left"
          // Focus goes to the opened editor, not back to this button.
          onMouseDown={(event) => event.button === 0 && event.preventDefault()}
          onClick={onOpen}
        >
          <span className="mt-px shrink-0 text-[10px] text-muted-foreground tabular-nums">{match.line}</span>
          <span className="flex min-w-0 flex-1 items-baseline text-xs whitespace-pre">
            <span className="shrink-0 text-muted-foreground">{parts.before}</span>
            {parts.hit && (
              <span
                className={cn(
                  'shrink-0 rounded-sm text-foreground',
                  replacement === null ? 'bg-amber-500/30' : 'bg-[var(--diff-removed-ground)] line-through'
                )}
              >
                {parts.hit}
              </span>
            )}
            {replacement !== null && parts.hit && (
              <span className="shrink-0 rounded-sm bg-[var(--diff-added-ground)] text-foreground">{replacement}</span>
            )}
            {/* truncate sets nowrap, which would drop the space right after the hit. */}
            <span className="min-w-0 truncate text-muted-foreground" style={{ whiteSpace: 'pre' }}>
              {parts.after}
            </span>
          </span>
          {onReplace && (
            <span className="hidden group-hover:flex">
              <RowAction label="Replace" onClick={onReplace}>
                <Replace className="size-3" />
              </RowAction>
            </span>
          )}
        </Button>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onSelect={() => copyText(`${path}#L${match.line}`)}>
          <Copy className="size-3.5" />
          Copy Line Path
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}
