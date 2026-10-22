import { ChevronRight, CircleAlert, Copy, ExternalLink, File, FilePlus, Files, Folder, FolderOpen, FolderPlus, Link, Loader2, Pencil, Search, Trash2 } from 'lucide-react'
import type { FileEntry } from '@acp-harness/protocol'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuTrigger
} from '@/components/ui/context-menu'
import { cn } from '@/lib/utils'
import { REVEAL_LABEL, parentDir } from './explorer-paths'

// Orca's FileExplorerRow and file-explorer-row-context-menu: 16px indent per level, git decoration
// colour on the name and letter on the right, the same menu items in the same order.

const isMac = navigator.userAgent.includes('Mac')
export const EXPLORER_SHORTCUTS = {
  rename: isMac ? '↩' : 'Enter',
  delete: isMac ? '⌘⌫' : 'Delete',
  copyPath: isMac ? '⌥⌘C' : 'Shift+Alt+C',
  copyRelativePath: isMac ? '⌥⇧⌘C' : 'Ctrl+Shift+Alt+C',
  findInFolder: isMac ? '⇧⌘F' : 'Ctrl+Shift+F'
}

export interface FileExplorerRowActions {
  onStartNew: (type: 'file' | 'folder', dir: string) => void
  onStartRename: (entry: FileEntry) => void
  onDuplicate: (entry: FileEntry) => void
  onCopyPaths: (kind: 'absolute' | 'relative') => void
  onReveal: (entry: FileEntry) => void
  onFindInFolder: (entry: FileEntry) => void
  onDelete: () => void
}

export function FileExplorerRow({
  entry,
  depth,
  isExpanded,
  isLoading,
  loadError,
  isSelected,
  isDropTarget,
  statusLetter,
  statusColor,
  dotOnly,
  selectionSize,
  actions,
  onClick,
  onContextMenu,
  onDragPointerDown
}: {
  entry: FileEntry
  depth: number
  isExpanded: boolean
  isLoading: boolean
  loadError: string | null
  isSelected: boolean
  isDropTarget: boolean
  statusLetter: string | null
  statusColor: string | null
  /** Folders show a dot for changes beneath them instead of a letter. */
  dotOnly: boolean
  selectionSize: number
  actions: FileExplorerRowActions
  onClick: (event: React.MouseEvent<HTMLButtonElement>) => void
  onContextMenu: () => void
  onDragPointerDown: (event: React.PointerEvent<HTMLButtonElement>) => void
}) {
  const isDir = entry.kind === 'dir'
  const targetDir = isDir ? entry.path : parentDir(entry.path)
  const many = selectionSize > 1
  return (
    <ContextMenu onOpenChange={(open) => open && onContextMenu()}>
      <ContextMenuTrigger asChild>
        <button
          type="button"
          role="treeitem"
          aria-selected={isSelected}
          aria-expanded={isDir ? isExpanded : undefined}
          data-file-explorer-row=""
          data-path={entry.path}
          data-entry-kind={entry.kind}
          data-selected={isSelected ? 'true' : undefined}
          className={cn(
            'flex w-full items-center gap-1 rounded-sm px-2 py-1 text-left text-xs transition-colors outline-none focus-visible:ring-1 focus-visible:ring-ring',
            isSelected ? 'bg-accent text-accent-foreground' : 'hover:bg-accent hover:text-foreground',
            isDropTarget && !isSelected && 'bg-accent/60'
          )}
          style={{ paddingLeft: `${depth * 16 + 8}px` }}
          onClick={onClick}
          onPointerDown={onDragPointerDown}
        >
          {isDir ? (
            <>
              <ChevronRight
                className={cn('size-3 shrink-0 text-muted-foreground transition-transform', isExpanded && 'rotate-90')}
              />
              {isLoading ? (
                <Loader2 className="size-3 shrink-0 animate-spin text-muted-foreground" />
              ) : loadError ? (
                <CircleAlert className="size-3 shrink-0 text-destructive" />
              ) : isExpanded ? (
                <FolderOpen className="size-3 shrink-0 text-muted-foreground" />
              ) : (
                <Folder className="size-3 shrink-0 text-muted-foreground" />
              )}
            </>
          ) : (
            <>
              <span className="size-3 shrink-0" />
              {entry.kind === 'symlink' ? (
                <Link className="size-3 shrink-0 text-muted-foreground" />
              ) : (
                <File className="size-3 shrink-0 text-muted-foreground" />
              )}
            </>
          )}
          <span className="truncate" style={statusColor ? { color: statusColor } : undefined}>
            {entry.name}
          </span>
          {loadError ? (
            <span className="w-0 flex-1 truncate text-destructive" title={loadError}>
              {loadError}
            </span>
          ) : null}
          {statusColor && dotOnly ? (
            <span className="mr-2 ml-auto size-1.5 shrink-0 rounded-full" style={{ background: statusColor }} />
          ) : statusLetter ? (
            <span className="mr-2 ml-auto shrink-0 text-[10px] font-semibold tracking-wide" style={{ color: statusColor ?? undefined }}>
              {statusLetter}
            </span>
          ) : null}
        </button>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-64" onCloseAutoFocus={(e) => e.preventDefault()}>
        <ContextMenuItem onSelect={() => actions.onStartNew('file', targetDir)}>
          <FilePlus />
          New File
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => actions.onStartNew('folder', targetDir)}>
          <FolderPlus />
          New Folder
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={() => actions.onCopyPaths('absolute')}>
          <Copy />
          {many ? 'Copy Paths' : 'Copy Path'}
          <ContextMenuShortcut>{EXPLORER_SHORTCUTS.copyPath}</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => actions.onCopyPaths('relative')}>
          <Copy />
          {many ? 'Copy Relative Paths' : 'Copy Relative Path'}
          <ContextMenuShortcut>{EXPLORER_SHORTCUTS.copyRelativePath}</ContextMenuShortcut>
        </ContextMenuItem>
        {!isDir && (
          <ContextMenuItem onSelect={() => actions.onDuplicate(entry)}>
            <Files />
            Duplicate
          </ContextMenuItem>
        )}
        {isDir && (
          <ContextMenuItem onSelect={() => actions.onFindInFolder(entry)}>
            <Search />
            Find in Folder
            <ContextMenuShortcut>{EXPLORER_SHORTCUTS.findInFolder}</ContextMenuShortcut>
          </ContextMenuItem>
        )}
        <ContextMenuItem onSelect={() => actions.onReveal(entry)}>
          <ExternalLink />
          {REVEAL_LABEL}
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={() => actions.onStartRename(entry)}>
          <Pencil />
          Rename
          <ContextMenuShortcut>{EXPLORER_SHORTCUTS.rename}</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuItem variant="destructive" onSelect={actions.onDelete}>
          <Trash2 />
          Delete
          <ContextMenuShortcut>{EXPLORER_SHORTCUTS.delete}</ContextMenuShortcut>
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}
