import { ChevronDown, Copy, Eye, File, FileText, Folder, FolderOpen, FolderSearch, SquareArrowOutUpRight } from 'lucide-react'
import type { GitChange } from '@acp-harness/protocol'
import { allWorkspaces, openEditorTab, setRightSidebar, useStore } from '@/session-store'
import { GIT_STATUS_COLOR, GIT_STATUS_LETTER } from '@/hooks/use-git-status'
import { openWorkspaceIn } from '@/components/sidebar/WorkspaceMenu'
import { Button } from '@/components/ui/button'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger
} from '@/components/ui/context-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

// Row chrome follows Orca's source-control/listing: section-header.tsx, uncommitted-entry-row.tsx,
// tree-directory-rows.tsx, action-button.tsx, diff-line-counts.tsx and entry-context-menu.tsx.

export const TREE_INDENT_PX = 12
const TREE_FILE_PADDING_PX = 20
const TREE_DIRECTORY_PADDING_PX = 8
// Measurable overlay so tooltips anchor correctly; revealed on row hover or focus.
const ROW_ACTION_OVERLAY_CLASS =
  'absolute right-0 top-0 bottom-0 flex shrink-0 items-center gap-1.5 bg-accent pr-3 pl-2 opacity-0 pointer-events-none transition-opacity group-hover:opacity-100 group-hover:pointer-events-auto focus-within:opacity-100 focus-within:pointer-events-auto'

export function ActionButton({
  icon: Icon,
  title,
  onClick,
  disabled
}: {
  icon: React.ComponentType<{ className?: string }>
  title: string
  onClick: (event: React.MouseEvent) => void
  disabled?: boolean
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          className={cn('text-muted-foreground hover:bg-background/70 hover:text-foreground', disabled && 'cursor-not-allowed opacity-50')}
          aria-label={title}
          aria-disabled={disabled}
          onClick={(event) => {
            event.stopPropagation()
            if (!disabled) onClick(event)
          }}
        >
          <Icon className="size-3.5" />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom" sideOffset={6}>
        {title}
      </TooltipContent>
    </Tooltip>
  )
}

export function SectionHeader({
  label,
  count,
  countTitle,
  collapsed,
  onToggle,
  actions
}: {
  label: string
  count: number
  countTitle?: string
  collapsed: boolean
  onToggle: () => void
  actions?: React.ReactNode
}) {
  return (
    <div className="pt-3 pr-3 pb-1 pl-1">
      <div className="group/section flex items-center gap-x-1 rounded-md pr-1 hover:bg-accent hover:text-accent-foreground">
        <Button
          type="button"
          variant="ghost"
          size="xs"
          className="h-auto min-h-6 min-w-0 flex-1 justify-start gap-x-1 py-0.5 text-left font-semibold tracking-wider text-foreground/70 uppercase group-hover/section:text-accent-foreground"
          onClick={onToggle}
          aria-expanded={!collapsed}
        >
          <ChevronDown className={cn('size-3.5 shrink-0 transition-transform', collapsed && '-rotate-90')} />
          <span className="min-w-0 truncate" title={label}>
            {label}
          </span>
          <span className="shrink-0 text-[11px] font-medium tabular-nums" title={countTitle}>
            {count}
          </span>
        </Button>
        <div className="ml-auto flex shrink-0 items-center justify-end">{actions}</div>
      </div>
    </div>
  )
}

export function DiffLineCounts({ added, removed }: { added: number | null; removed: number | null }) {
  const hasAdded = typeof added === 'number' && added > 0
  const hasRemoved = typeof removed === 'number' && removed > 0
  if (!hasAdded && !hasRemoved) return null
  return (
    <span className="shrink-0 text-[10px] tabular-nums">
      {hasAdded && <span style={{ color: 'var(--git-decoration-added)' }}>+{added}</span>}
      {hasAdded && hasRemoved && <span> </span>}
      {hasRemoved && <span style={{ color: 'var(--git-decoration-deleted)' }}>-{removed}</span>}
    </span>
  )
}

/** Orca's entry context menu: view the change, open the file, copy paths, reveal it. */
function ChangeContextMenu({
  workspaceId,
  entry,
  onOpenDiff,
  onOpenChange,
  children
}: {
  workspaceId: string
  entry: GitChange
  onOpenDiff: () => void
  onOpenChange?: (open: boolean) => void
  children: React.ReactNode
}) {
  // Select primitives: allWorkspaces builds new objects, which would never compare equal.
  const workspacePath = useStore((s) => allWorkspaces(s).find((w) => w.id === workspaceId)?.path ?? null)
  const hostId = useStore((s) => allWorkspaces(s).find((w) => w.id === workspaceId)?.hostId ?? null)
  const workspace = workspacePath !== null && hostId !== null ? { path: workspacePath, hostId } : null
  const sep = workspace?.path.includes('\\') ? '\\' : '/'
  const absolutePath = workspace ? `${workspace.path.replace(/[\\/]+$/, '')}${sep}${entry.path.split('/').join(sep)}` : null
  const exists = entry.status !== 'deleted'
  return (
    <ContextMenu onOpenChange={onOpenChange}>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent className="w-52">
        <ContextMenuItem onSelect={onOpenDiff}>
          <Eye className="size-3.5" />
          Open Changes
        </ContextMenuItem>
        <ContextMenuItem
          disabled={!exists}
          onSelect={() => openEditorTab({ workspaceId, kind: 'file', path: entry.path, staged: false })}
        >
          <FileText className="size-3.5" />
          Open File
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem disabled={!absolutePath} onSelect={() => absolutePath && void navigator.clipboard.writeText(absolutePath)}>
          <Copy className="size-3.5" />
          Copy Path
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => void navigator.clipboard.writeText(entry.path)}>
          <Copy className="size-3.5" />
          Copy Relative Path
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem
          disabled={!absolutePath || !exists || !workspace}
          onSelect={() => {
            if (!absolutePath || !workspace) return
            openWorkspaceIn('explorer', workspace.hostId, absolutePath.slice(0, absolutePath.lastIndexOf(sep)) || absolutePath)
          }}
        >
          <SquareArrowOutUpRight className="size-3.5" />
          Reveal in File Explorer
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => setRightSidebar({ open: true, tab: 'explorer' })}>
          <FolderSearch className="size-3.5" />
          Open in Explorer Panel
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}

export function ChangeRow({
  workspaceId,
  entry,
  depth = 0,
  showPathHint = true,
  selected,
  rowKey,
  onClick,
  onOpenDiff,
  onContextMenu,
  actions
}: {
  workspaceId: string
  entry: GitChange
  depth?: number
  showPathHint?: boolean
  selected?: boolean
  rowKey: string
  onClick: (event: React.MouseEvent) => void
  onOpenDiff: () => void
  onContextMenu?: () => void
  actions?: React.ReactNode
}) {
  const slash = entry.path.lastIndexOf('/')
  const fileName = entry.path.slice(slash + 1)
  const dirPath = slash >= 0 ? entry.path.slice(0, slash) : ''
  const color = GIT_STATUS_COLOR[entry.status]
  return (
    <ChangeContextMenu workspaceId={workspaceId} entry={entry} onOpenDiff={onOpenDiff} onOpenChange={(open) => open && onContextMenu?.()}>
      <div
        role="button"
        tabIndex={0}
        data-change-key={rowKey}
        data-change-path={entry.path}
        className={cn(
          'group relative flex cursor-pointer items-center gap-1 py-1 pr-3 transition-colors hover:bg-accent/40',
          selected && 'bg-accent/60'
        )}
        style={{ paddingLeft: `${depth * TREE_INDENT_PX + TREE_FILE_PADDING_PX}px` }}
        onClick={onClick}
        onKeyDown={(e) => {
          if (e.key === 'Enter') onOpenDiff()
        }}
      >
        <File className="size-3.5 shrink-0" style={{ color }} />
        <div className="min-w-0 flex-1 text-xs">
          <span className="block min-w-0 truncate" title={entry.oldPath ? `${entry.oldPath} → ${entry.path}` : entry.path}>
            <span className="text-foreground">{fileName}</span>
            {showPathHint && dirPath && <span className="ml-1.5 text-[11px] text-muted-foreground">{dirPath}</span>}
          </span>
        </div>
        <DiffLineCounts added={entry.additions} removed={entry.deletions} />
        <span className="w-4 shrink-0 text-center text-[10px] font-bold" style={{ color }}>
          {GIT_STATUS_LETTER[entry.status]}
        </span>
        {actions && <div className={ROW_ACTION_OVERLAY_CLASS}>{actions}</div>}
      </div>
    </ChangeContextMenu>
  )
}

export function DirectoryRow({
  name,
  depth,
  fileCount,
  collapsed,
  onToggle,
  actions
}: {
  name: string
  depth: number
  fileCount: number
  collapsed: boolean
  onToggle: () => void
  actions?: React.ReactNode
}) {
  return (
    <div
      className="group relative flex w-full items-center gap-1 py-1 pr-3 text-xs text-muted-foreground transition-colors hover:bg-accent/40 hover:text-foreground"
      style={{ paddingLeft: `${depth * TREE_INDENT_PX + TREE_DIRECTORY_PADDING_PX}px` }}
    >
      <button type="button" className="flex min-w-0 flex-1 items-center gap-1 text-left" onClick={onToggle} aria-expanded={!collapsed}>
        <ChevronDown className={cn('size-3 shrink-0 transition-transform', collapsed && '-rotate-90')} />
        {collapsed ? <Folder className="size-3 shrink-0" /> : <FolderOpen className="size-3 shrink-0" />}
        <span className="min-w-0 flex-1 truncate">{name}</span>
      </button>
      <span className="w-4 shrink-0 text-center text-[10px] font-bold text-muted-foreground/80 tabular-nums">{fileCount}</span>
      {actions && <div className={ROW_ACTION_OVERLAY_CLASS}>{actions}</div>}
    </div>
  )
}
