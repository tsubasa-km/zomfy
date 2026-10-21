import { useRef } from 'react'
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Columns2,
  Copy,
  CopyX,
  ExternalLink,
  Hash,
  ListX,
  PanelLeftClose,
  PanelRightClose,
  Pencil,
  Pin,
  PinOff,
  X
} from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { setTabMeta, useTabLayout, type SplitSide } from '@/stores/tab-layout-store'
import { currentUrl } from '@/stores/browser-tab-store'
import { cn } from '@/lib/utils'
import {
  absoluteEditorPath,
  canRenameTab,
  closeWorkspaceTabs,
  duplicateBrowserTab,
  type WorkspaceTab
} from './workspace-tab-model'
import { closeGroup, splitTabTo } from './tab-group-commands'
import { shortcutLabel } from './tab-shortcuts'

// Items and order follow Orca's SortableTabContextMenu, EditorFileTabContextMenu and BrowserTab menus.

// Why: a fixed width wraps long labels and Windows' wider shortcut chips; size to content, capped.
const MENU_CLASS = 'min-w-[13rem] max-w-[calc(100vw-1rem)] whitespace-nowrap'

const TAB_COLORS: { label: string; value: string | null }[] = [
  { label: 'None', value: null },
  { label: 'Blue', value: '#3b82f6' },
  { label: 'Purple', value: '#a855f7' },
  { label: 'Pink', value: '#ec4899' },
  { label: 'Red', value: '#ef4444' },
  { label: 'Orange', value: '#f97316' },
  { label: 'Yellow', value: '#eab308' },
  { label: 'Green', value: '#22c55e' },
  { label: 'Teal', value: '#14b8a6' },
  { label: 'Gray', value: '#9ca3af' }
]

const SPLIT_SIDES: { side: SplitSide; label: string; icon: React.ReactNode }[] = [
  { side: 'right', label: 'Right', icon: <ArrowRight className="size-3.5 shrink-0" /> },
  { side: 'left', label: 'Left', icon: <ArrowLeft className="size-3.5 shrink-0" /> },
  { side: 'down', label: 'Down', icon: <ArrowDown className="size-3.5 shrink-0" /> },
  { side: 'up', label: 'Up', icon: <ArrowUp className="size-3.5 shrink-0" /> }
]

function copyText(text: string): void {
  void navigator.clipboard.writeText(text).catch(() => undefined)
}

export function TabContextMenu({
  workspaceId,
  groupId,
  tab,
  groupTabs,
  hasSplit,
  open,
  point,
  onOpenChange,
  onRename
}: {
  workspaceId: string
  groupId: string
  tab: WorkspaceTab
  /** The group's tabs in strip order. */
  groupTabs: WorkspaceTab[]
  hasSplit: boolean
  open: boolean
  point: { x: number; y: number }
  onOpenChange: (open: boolean) => void
  onRename: () => void
}) {
  const meta = useTabLayout((s) => s.meta)
  const isPinned = meta[tab.id]?.pinned === true
  const index = groupTabs.findIndex((t) => t.id === tab.id)
  const unpinned = (list: WorkspaceTab[]) => list.filter((t) => !meta[t.id]?.pinned)
  const others = unpinned(groupTabs.filter((t) => t.id !== tab.id))
  const toRight = unpinned(groupTabs.slice(index + 1))
  const toLeft = unpinned(groupTabs.slice(0, index))
  const renameAfterClose = useRef(false)
  const close = (list: WorkspaceTab[]) => closeWorkspaceTabs(workspaceId, list)

  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange} modal={false}>
      <DropdownMenuTrigger asChild>
        <button
          aria-hidden
          tabIndex={-1}
          className="pointer-events-none fixed size-px opacity-0"
          style={{ left: point.x, top: point.y }}
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        data-tab-context-menu={tab.id}
        className={MENU_CLASS}
        sideOffset={0}
        align="start"
        onCloseAutoFocus={(event) => {
          if (!renameAfterClose.current) return
          renameAfterClose.current = false
          // Why: opening the input in onSelect lets the closing menu take focus back and blur it.
          event.preventDefault()
          onRename()
        }}
      >
        {groupTabs.length > 1 && (
          <>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger className="[&>svg:last-child]:size-3.5">
                <Columns2 className="size-3.5 shrink-0" />
                Move Tab to Split
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="max-w-[calc(100vw-1rem)] whitespace-nowrap">
                {SPLIT_SIDES.map(({ side, label, icon }) => (
                  <DropdownMenuItem key={side} data-split-side={side} onSelect={() => splitTabTo(workspaceId, tab.id, groupId, side)}>
                    {icon}
                    {label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuSeparator />
          </>
        )}
        {tab.kind === 'browser' && (
          <>
            <DropdownMenuItem onSelect={() => duplicateBrowserTab(workspaceId, tab.id)}>
              <Copy className="size-3.5" />
              Duplicate Tab
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        )}
        <DropdownMenuItem onSelect={() => setTabMeta(tab.id, { pinned: !isPinned })}>
          {isPinned ? <PinOff className="size-3.5 shrink-0" /> : <Pin className="size-3.5 shrink-0" />}
          {isPinned ? 'Unpin Tab' : 'Pin Tab'}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => copyText(tab.id)}>
          <Hash className="size-3.5" />
          Copy Tab ID
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem data-menu-action="close" disabled={isPinned} onSelect={() => !isPinned && close([tab])}>
          <X className="size-3.5" />
          Close
          <DropdownMenuShortcut>{shortcutLabel('tab.close')}</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem data-menu-action="close-others" disabled={others.length === 0} onSelect={() => close(others)}>
          {tab.kind === 'chat' || tab.kind === 'terminal' ? <ListX className="size-3.5" /> : <CopyX className="size-3.5" />}
          Close Others
        </DropdownMenuItem>
        {tab.kind === 'editor' && (
          <DropdownMenuItem
            onSelect={() => close(unpinned(groupTabs.filter((t) => t.kind === 'editor')))}
          >
            <ListX className="size-3.5" />
            Close All Editor Tabs
          </DropdownMenuItem>
        )}
        <DropdownMenuItem data-menu-action="close-right" disabled={toRight.length === 0} onSelect={() => close(toRight)}>
          <PanelRightClose className="size-3.5" />
          Close Tabs To The Right
        </DropdownMenuItem>
        <DropdownMenuItem data-menu-action="close-left" disabled={toLeft.length === 0} onSelect={() => close(toLeft)}>
          <PanelLeftClose className="size-3.5" />
          Close Tabs To The Left
        </DropdownMenuItem>
        {hasSplit && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={() => closeGroup(workspaceId, groupId, groupTabs)}>
              <X className="size-3.5" />
              Close split pane
            </DropdownMenuItem>
          </>
        )}
        {tab.kind === 'browser' && (
          <DropdownMenuItem
            disabled={!/^https?:/.test(currentUrl(tab.browser))}
            onSelect={() => window.open(currentUrl(tab.browser), '_blank', 'noopener')}
          >
            <ExternalLink className="size-3.5" />
            Open In Browser
          </DropdownMenuItem>
        )}
        {tab.kind === 'editor' && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => copyText(absoluteEditorPath(workspaceId, tab.editor.path))}>
              <Copy className="size-3.5" />
              Copy Path
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => copyText(tab.editor.path)}>
              <Copy className="size-3.5" />
              Copy Relative Path
            </DropdownMenuItem>
          </>
        )}
        {canRenameTab(tab) && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem data-menu-action="rename" onSelect={() => (renameAfterClose.current = true)}>
              <Pencil className="size-3.5" />
              Change Title
            </DropdownMenuItem>
            <div className="px-2 pt-1.5 pb-1">
              <div className="mb-1.5 text-xs font-medium text-muted-foreground">Tab Color</div>
              <div className="flex flex-wrap gap-2">
                {TAB_COLORS.map((color) => (
                  <DropdownMenuItem
                    key={color.label}
                    aria-label={color.label}
                    className={cn(
                      'relative h-4 w-4 min-w-4 rounded-full border p-0',
                      (meta[tab.id]?.color ?? null) === color.value &&
                        'ring-1 ring-foreground/70 ring-offset-1 ring-offset-popover',
                      color.value ? 'border-transparent' : 'border-muted-foreground/50 bg-transparent'
                    )}
                    style={color.value ? { backgroundColor: color.value } : undefined}
                    onSelect={() => setTabMeta(tab.id, { color: color.value })}
                  >
                    {color.value === null && <span className="absolute block h-px w-3 rotate-45 bg-muted-foreground/80" />}
                  </DropdownMenuItem>
                ))}
              </div>
            </div>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
