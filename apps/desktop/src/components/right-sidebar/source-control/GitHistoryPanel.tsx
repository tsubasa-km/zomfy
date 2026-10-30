import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, Copy, File, Hash, RefreshCw } from 'lucide-react'
import type { GitChange, GitCommitChanges, GitHistoryItem, GitHistoryItemRef, GitHistoryResult } from '@acp-harness/protocol'
import { GIT_STATUS_COLOR, GIT_STATUS_LETTER } from '@/hooks/use-git-status'
import { Button } from '@/components/ui/button'
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from '@/components/ui/context-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { DiffLineCounts } from './change-rows'
import { buildDefaultGitHistoryColorMap, buildGitHistoryViewModels, dedupeRemoteTrackingRefs, isBoundaryRow, type GitHistoryItemViewModel } from './git-history-graph'
import { GitHistoryGraphSvg, graphColor } from './GitHistoryGraphSvg'
import { t } from '@/i18n/i18n'

// Orca's source-control/sync: git-history-panel.tsx, git-history-row.tsx,
// git-history-commit-files.tsx and git-history-commit-context-menu.tsx.

export type GitHistoryState =
  | { status: 'loading'; result?: GitHistoryResult; error?: string }
  | { status: 'ready'; result: GitHistoryResult }
  | { status: 'error'; result?: GitHistoryResult; error: string }

type CommitFilesState = { status: 'loading' } | { status: 'error'; error: string } | { status: 'ready'; changes: GitCommitChanges }

const DEFAULT_HEIGHT = 256
const MIN_HEIGHT = 96
const MAX_HEIGHT = 520
const clampHeight = (h: number) => Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, h))
const timestampFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' })

export function GitHistoryPanel({
  state,
  collapsed,
  onToggle,
  onRefresh,
  loadCommitFiles,
  onOpenCommitFile
}: {
  state: GitHistoryState
  collapsed: boolean
  onToggle: () => void
  onRefresh: () => void
  loadCommitFiles: (item: GitHistoryItem) => Promise<GitCommitChanges>
  onOpenCommitFile: (item: GitHistoryItem, changes: GitCommitChanges, entry: GitChange) => void
}) {
  const result = state.result
  const viewModels = useMemo(
    () =>
      result
        ? buildGitHistoryViewModels(
            result.items,
            buildDefaultGitHistoryColorMap(result),
            result.currentRef,
            result.remoteRef,
            result.baseRef,
            result.hasIncomingChanges,
            result.hasOutgoingChanges,
            result.mergeBase
          )
        : [],
    [result]
  )
  const [height, setHeight] = useState(DEFAULT_HEIGHT)
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
  const [files, setFiles] = useState<Record<string, CommitFilesState>>({})
  const resize = useRef<{ startY: number; startHeight: number } | null>(null)

  // A new result can reorder or replace commits; drop expansion rather than show stale files.
  const [seenResult, setSeenResult] = useState(result)
  if (seenResult !== result) {
    setSeenResult(result)
    setExpanded(new Set())
    setFiles({})
  }

  const toggleExpand = useCallback(
    (item: GitHistoryItem) => {
      const willExpand = !expanded.has(item.id)
      setExpanded((prev) => {
        const next = new Set(prev)
        if (willExpand) next.add(item.id)
        else next.delete(item.id)
        return next
      })
      if (!willExpand || files[item.id]?.status === 'ready' || files[item.id]?.status === 'loading') return
      setFiles((prev) => ({ ...prev, [item.id]: { status: 'loading' } }))
      loadCommitFiles(item).then(
        (changes) => setFiles((prev) => ({ ...prev, [item.id]: { status: 'ready', changes } })),
        (error: unknown) =>
          setFiles((prev) => ({ ...prev, [item.id]: { status: 'error', error: error instanceof Error ? error.message : t('Failed to load commit files') } }))
      )
    },
    [expanded, files, loadCommitFiles]
  )

  useEffect(() => {
    const move = (e: PointerEvent) => {
      if (resize.current) setHeight(clampHeight(resize.current.startHeight + resize.current.startY - e.clientY))
    }
    const stop = () => {
      if (!resize.current) return
      resize.current = null
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', stop)
    window.addEventListener('blur', stop)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', stop)
      window.removeEventListener('blur', stop)
    }
  }, [])

  const bodyStyle = { height: `min(${height}px, 33vh)` }
  const loading = state.status === 'loading'

  return (
    <div className="relative" data-git-history>
      {!collapsed && (
        <div
          role="separator"
          aria-label={t('Resize commits')}
          aria-orientation="horizontal"
          aria-valuemin={MIN_HEIGHT}
          aria-valuemax={MAX_HEIGHT}
          aria-valuenow={height}
          tabIndex={0}
          className="absolute inset-x-0 -top-1 z-10 h-2 cursor-row-resize outline-none focus-visible:bg-ring/30"
          onPointerDown={(e) => {
            e.preventDefault()
            resize.current = { startY: e.clientY, startHeight: height }
            document.body.style.cursor = 'row-resize'
            document.body.style.userSelect = 'none'
          }}
          onKeyDown={(e) => {
            const step = e.shiftKey ? 32 : 16
            if (e.key === 'ArrowUp') setHeight((h) => clampHeight(h + step))
            else if (e.key === 'ArrowDown') setHeight((h) => clampHeight(h - step))
          }}
        />
      )}
      <div className="h-7 pr-3 pl-1">
        <div className="flex h-full items-stretch rounded-md pr-1">
          <button
            type="button"
            className="flex min-w-0 flex-1 items-center gap-1 px-0.5 text-left text-[11px] font-semibold tracking-wider text-foreground/70 uppercase"
            onClick={onToggle}
            aria-expanded={!collapsed}
          >
            <ChevronDown className={cn('size-3 shrink-0 transition-transform', collapsed && '-rotate-90')} />
            <span>{t('Commits')}</span>
            {result && <span className="text-[10px] font-medium tabular-nums">{result.items.length}</span>}
            {result?.hasMore && <span className="text-[10px] font-medium">+</span>}
          </button>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                className="my-auto h-auto w-auto p-0.5 text-muted-foreground hover:bg-transparent hover:text-muted-foreground dark:hover:bg-transparent"
                aria-label={t('Refresh commits')}
                onClick={(e) => {
                  e.stopPropagation()
                  if (collapsed) onToggle()
                  else onRefresh()
                }}
              >
                <RefreshCw className={cn('size-3.5', loading && 'animate-spin')} />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom" sideOffset={6}>
              {t('Refresh commits')}
            </TooltipContent>
          </Tooltip>
        </div>
      </div>
      {!collapsed && state.status === 'error' && !result && (
        <div className="scrollbar-sleek overflow-y-auto px-6 py-2 text-[11px] text-destructive" style={bodyStyle}>
          {state.error}
        </div>
      )}
      {!collapsed && loading && !result && (
        <div className="flex items-start gap-2 px-6 py-2 text-[11px] text-muted-foreground" style={bodyStyle}>
          <RefreshCw className="size-3 animate-spin" />
          <span>{t('Loading graph...')}</span>
        </div>
      )}
      {!collapsed && result && viewModels.length === 0 && (
        <div className="px-6 py-2 text-[11px] text-muted-foreground" style={bodyStyle}>
          {t('No commits yet')}
        </div>
      )}
      {!collapsed && viewModels.length > 0 && (
        <div className="scrollbar-sleek overflow-y-auto" style={bodyStyle}>
          {viewModels.map((viewModel) => {
            const item = viewModel.historyItem
            const boundary = isBoundaryRow(viewModel)
            const isExpanded = !boundary && expanded.has(item.id)
            const row = (
              <HistoryRow
                viewModel={viewModel}
                expanded={isExpanded}
                preserveRefIds={result?.baseRef ? [result.baseRef.id] : []}
                onToggle={boundary ? undefined : () => toggleExpand(item)}
              />
            )
            return (
              <Fragment key={`${viewModel.kind}:${item.id}`}>
                {boundary ? (
                  row
                ) : (
                  <ContextMenu>
                    <ContextMenuTrigger asChild>{row}</ContextMenuTrigger>
                    <ContextMenuContent className="w-56">
                      <ContextMenuItem onSelect={() => void navigator.clipboard.writeText(item.id)}>
                        <Hash className="size-3.5" />
                        {t('Copy commit hash')}
                      </ContextMenuItem>
                      <ContextMenuItem onSelect={() => void navigator.clipboard.writeText(item.message || item.subject)}>
                        <Copy className="size-3.5" />
                        {t('Copy commit message')}
                      </ContextMenuItem>
                    </ContextMenuContent>
                  </ContextMenu>
                )}
                {isExpanded && (
                  <CommitFiles
                    state={files[item.id] ?? { status: 'loading' }}
                    item={item}
                    onOpenFile={(changes, entry) => onOpenCommitFile(item, changes, entry)}
                  />
                )}
              </Fragment>
            )
          })}
        </div>
      )}
    </div>
  )
}

function RefBadge({ itemRef }: { itemRef: GitHistoryItemRef }) {
  const color = itemRef.color ? graphColor(itemRef.color) : undefined
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className="max-w-[8rem] truncate rounded-full border bg-sidebar px-1.5 py-0.5 text-[10px] leading-none"
          style={{ borderColor: color ?? 'var(--border)', color: color ?? 'var(--muted-foreground)' }}
        >
          {itemRef.name}
        </span>
      </TooltipTrigger>
      <TooltipContent side="bottom" sideOffset={6} className="max-w-72">
        {itemRef.category ? `${itemRef.name} (${itemRef.category})` : itemRef.name}
      </TooltipContent>
    </Tooltip>
  )
}

function HistoryRow({
  viewModel,
  expanded,
  preserveRefIds,
  onToggle,
  ...rootProps
}: {
  viewModel: GitHistoryItemViewModel
  expanded: boolean
  preserveRefIds: string[]
  onToggle?: () => void
} & React.HTMLAttributes<HTMLElement>) {
  const item = viewModel.historyItem
  const refs = dedupeRemoteTrackingRefs(item.references ?? [], preserveRefIds)
  const visible = refs.slice(0, 2)
  const hidden = refs.slice(2)
  const className = cn(
    'grid min-h-[26px] w-full min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-1.5 px-3 py-0.5 text-left text-xs transition-colors',
    onToggle ? 'cursor-pointer hover:bg-accent/40 focus-visible:bg-accent/40' : 'cursor-default text-muted-foreground'
  )
  const content = (
    <>
      <GitHistoryGraphSvg viewModel={viewModel} />
      <div className="flex min-w-0 items-center gap-1 overflow-hidden">
        {onToggle && <ChevronDown aria-hidden="true" className={cn('size-3 shrink-0 text-muted-foreground transition-transform', !expanded && '-rotate-90')} />}
        <Tooltip>
          <TooltipTrigger asChild>
            <span className={cn('block min-w-0 flex-1 truncate', onToggle && 'text-foreground')}>{item.subject}</span>
          </TooltipTrigger>
          <TooltipContent side="bottom" sideOffset={6} collisionPadding={8} className="max-w-[min(76ch,var(--radix-tooltip-content-available-width))] break-words whitespace-pre-wrap">
            {item.message || item.subject}
          </TooltipContent>
        </Tooltip>
      </div>
      {refs.length > 0 && (
        <div className="flex shrink-0 items-center gap-1 overflow-hidden">
          {visible.map((ref) => (
            <RefBadge key={ref.id} itemRef={ref} />
          ))}
          {hidden.length > 0 && <span className="shrink-0 text-[10px] leading-none text-muted-foreground" title={hidden.map((r) => r.name).join(', ')}>+{hidden.length}</span>}
        </div>
      )}
    </>
  )
  if (!onToggle) {
    return (
      <div {...rootProps} className={className} data-git-history-row>
        {content}
      </div>
    )
  }
  return (
    <button
      {...rootProps}
      type="button"
      className={className}
      aria-expanded={expanded}
      aria-label={t(expanded ? 'Hide files in commit {id}: {subject}' : 'Show files in commit {id}: {subject}', { id: item.displayId ?? item.id, subject: item.subject })}
      data-git-history-row
      onClick={onToggle}
    >
      {content}
    </button>
  )
}

function CommitFiles({
  state,
  item,
  onOpenFile
}: {
  state: CommitFilesState
  item: GitHistoryItem
  onOpenFile: (changes: GitCommitChanges, entry: GitChange) => void
}) {
  // Author and date move off the dense row and surface on expand.
  const meta = [item.displayId, item.author, item.timestamp ? timestampFormat.format(new Date(item.timestamp)) : null].filter(Boolean).join(' · ')
  return (
    <div className="border-l border-border/60 bg-muted/20" data-commit-files={item.id}>
      {meta && <div className="py-1 pr-3 pl-9 text-[11px] text-muted-foreground">{meta}</div>}
      {item.message.includes('\n') && (
        <div className="pr-3 pb-1 pl-9 text-[11px] whitespace-pre-wrap text-muted-foreground">{item.message.slice(item.message.indexOf('\n') + 1).trim()}</div>
      )}
      {state.status === 'loading' ? (
        <div className="flex items-center gap-2 py-1 pr-3 pl-9 text-[11px] text-muted-foreground">
          <RefreshCw className="size-3 animate-spin" />
          <span>{t('Loading files…')}</span>
        </div>
      ) : state.status === 'error' ? (
        <div className="py-1 pr-3 pl-9 text-[11px] text-destructive" title={state.error}>
          {state.error}
        </div>
      ) : state.changes.entries.length === 0 ? (
        <div className="py-1 pr-3 pl-9 text-[11px] text-muted-foreground">{t('No file changes in this commit')}</div>
      ) : (
        state.changes.entries.map((entry) => {
          const slash = entry.path.lastIndexOf('/')
          const color = GIT_STATUS_COLOR[entry.status]
          return (
            <button
              key={entry.path}
              type="button"
              className="group flex w-full min-w-0 cursor-pointer items-center gap-1 py-1 pr-3 pl-9 text-left text-xs transition-colors hover:bg-accent/40"
              title={entry.path}
              data-commit-file={entry.path}
              onClick={() => onOpenFile(state.changes, entry)}
            >
              <File className="size-3.5 shrink-0" style={{ color }} />
              <span className="min-w-0 flex-1 truncate">
                <span className="text-foreground">{entry.path.slice(slash + 1)}</span>
                {slash > 0 && <span className="ml-1.5 text-[11px] text-muted-foreground">{entry.path.slice(0, slash)}</span>}
              </span>
              <DiffLineCounts added={entry.additions} removed={entry.deletions} />
              <span className="w-4 shrink-0 text-center text-[10px] font-bold" style={{ color }}>
                {GIT_STATUS_LETTER[entry.status]}
              </span>
            </button>
          )
        })
      )}
    </div>
  )
}
