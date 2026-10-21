import { useEffect, useRef } from 'react'
import { List, ListTree, Loader2, MoreHorizontal, RefreshCw, Search, Settings2, X } from 'lucide-react'
import type { GitBranchCompareSummary } from '@acp-harness/protocol'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

// Orca's source-control/panel: header-toolbar.tsx, header-overflow-menu.tsx and
// branch-context-row.tsx (stacked "head / → base" with commit counts against the base).

export type SourceControlViewMode = 'list' | 'tree'

export function SourceControlHeader({
  filterQuery,
  filterExpanded,
  onFilterQueryChange,
  onFilterExpandedChange,
  viewMode,
  onToggleViewMode,
  onChangeBaseRef,
  onRefresh,
  branch,
  compareSummary,
  compareLoading,
  baseRef
}: {
  filterQuery: string
  filterExpanded: boolean
  onFilterQueryChange: (value: string) => void
  onFilterExpandedChange: (expanded: boolean) => void
  viewMode: SourceControlViewMode
  onToggleViewMode: () => void
  onChangeBaseRef: () => void
  onRefresh: () => void
  branch: string | null
  compareSummary: GitBranchCompareSummary | null
  compareLoading: boolean
  baseRef: string | null
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const normalized = filterQuery.trim()
  useEffect(() => {
    if (!filterExpanded) return
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [filterExpanded])
  const filterTitle = normalized ? `Filter: ${filterQuery}` : 'Filter files by name'
  const displayedBase = compareSummary?.baseRef ?? baseRef

  return (
    <div className="border-b border-border px-3 pt-1.5 pb-1">
      <div className={cn('flex min-w-0 items-center gap-1', filterExpanded && 'w-full gap-1.5')}>
        {filterExpanded ? (
          <>
            {/* The expanded filter owns the row so typing isn't squeezed beside other actions. */}
            <div className="flex w-full min-w-0 flex-1 items-center gap-1.5">
              <Search className="size-3.5 shrink-0 text-muted-foreground" />
              <input
                ref={inputRef}
                type="text"
                value={filterQuery}
                onChange={(e) => onFilterQueryChange(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    e.preventDefault()
                    onFilterExpandedChange(false)
                  }
                }}
                placeholder="Filter files…"
                aria-label="Filter files…"
                className="w-full min-w-0 flex-1 bg-transparent text-xs text-foreground outline-none placeholder:text-muted-foreground/60"
              />
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              className="size-7 shrink-0 text-muted-foreground hover:text-foreground"
              aria-label="Clear and close filter"
              title="Clear and close filter"
              onClick={() => {
                onFilterQueryChange('')
                onFilterExpandedChange(false)
              }}
            >
              <X className="size-3.5" />
            </Button>
          </>
        ) : (
          <>
            <span className="min-w-0 flex-1" aria-hidden="true" />
            <button
              type="button"
              className={cn(
                'relative inline-flex size-7 shrink-0 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground',
                normalized && 'bg-muted text-foreground'
              )}
              onClick={() => onFilterExpandedChange(true)}
              aria-label={filterTitle}
              title={filterTitle}
            >
              <Search className="size-3.5" />
              {normalized ? <span className="absolute top-1 right-1 size-1.5 rounded-full bg-foreground" /> : null}
            </button>
            <DropdownMenu>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="inline-flex shrink-0">
                    <DropdownMenuTrigger asChild>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        className="size-7 text-muted-foreground hover:text-foreground"
                        aria-label="More source control actions"
                      >
                        <MoreHorizontal className="size-3.5" />
                      </Button>
                    </DropdownMenuTrigger>
                  </span>
                </TooltipTrigger>
                <TooltipContent side="bottom" sideOffset={6}>
                  More source control actions
                </TooltipContent>
              </Tooltip>
              <DropdownMenuContent align="end" className="min-w-[180px]">
                <DropdownMenuItem onSelect={onToggleViewMode}>
                  {viewMode === 'tree' ? <List className="size-3.5" /> : <ListTree className="size-3.5" />}
                  {viewMode === 'tree' ? 'View as list' : 'View as tree'}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={onChangeBaseRef}>
                  <Settings2 className="size-3.5" />
                  Change Base Ref…
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={onRefresh}>
                  <RefreshCw className="size-3.5" />
                  Refresh
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        )}
      </div>

      {(branch || displayedBase) && (
        <div className="mt-1 flex min-w-0 flex-col gap-0.5 text-[11px] text-muted-foreground">
          {branch && (
            <Tooltip>
              <TooltipTrigger asChild>
                <span
                  className="block max-w-full min-w-0 truncate rounded-sm font-mono text-[10.5px] font-medium text-foreground/90 outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  tabIndex={0}
                  aria-label={`Current branch: ${branch}`}
                  data-source-control-branch
                >
                  {branch}
                </span>
              </TooltipTrigger>
              <TooltipContent side="bottom" sideOffset={6} className="max-w-72 font-mono break-all">
                {branch}
              </TooltipContent>
            </Tooltip>
          )}
          {displayedBase && (
            <div className="flex min-w-0 items-center gap-1.5">
              {compareLoading && <Loader2 className="size-3 shrink-0 animate-spin" aria-hidden="true" />}
              <span className="shrink-0 text-muted-foreground/70" aria-hidden="true">
                {branch ? '→' : 'vs'}
              </span>
              <span className="min-w-0 flex-1">
                <button
                  type="button"
                  className="max-w-full min-w-0 truncate rounded-sm border-0 bg-transparent p-0 text-left font-mono text-[10.5px] font-medium text-foreground/90 underline decoration-border underline-offset-2 hover:text-foreground hover:decoration-foreground"
                  onClick={onChangeBaseRef}
                  title={`Change base ref (${displayedBase})`}
                  aria-label={`Change base ref: ${displayedBase}`}
                >
                  {displayedBase}
                </button>
              </span>
              {compareSummary?.status === 'ready' && (compareSummary.commitsAhead ?? 0) > 0 && (
                <Stat label={`↑${compareSummary.commitsAhead}`} title={`${compareSummary.commitsAhead} commit${compareSummary.commitsAhead === 1 ? '' : 's'} ahead of ${displayedBase}`} />
              )}
              {compareSummary?.status === 'ready' && (compareSummary.commitsBehind ?? 0) > 0 && (
                <Stat label={`↓${compareSummary.commitsBehind}`} title={`${compareSummary.commitsBehind} commit${compareSummary.commitsBehind === 1 ? '' : 's'} behind ${displayedBase}`} />
              )}
            </div>
          )}
          {compareSummary && compareSummary.status !== 'ready' && (
            <span className={cn('min-w-0 truncate', branch && 'pl-4')} title={compareSummary.errorMessage}>
              {compareSummary.errorMessage ?? 'Branch compare unavailable'}
            </span>
          )}
        </div>
      )}
    </div>
  )
}

function Stat({ label, title }: { label: string; title: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="shrink-0 rounded-sm text-muted-foreground/70 tabular-nums outline-none focus-visible:ring-1 focus-visible:ring-ring" tabIndex={0} aria-label={title}>
          {label}
        </span>
      </TooltipTrigger>
      <TooltipContent side="bottom" sideOffset={6}>
        {title}
      </TooltipContent>
    </Tooltip>
  )
}
