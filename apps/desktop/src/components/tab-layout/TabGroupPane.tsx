import { useCallback, useEffect, useState } from 'react'
import { filePathDrag, type DraggedPaths } from '@/lib/file-path-drag'
import { ensureSessionLoaded } from '@/daemon-connection'
import { getState, useStore } from '@/session-store'
import { tabScope, WINDOW_TABS } from '@/stores/tab-layout-store'
import { QuickStart } from '@/components/QuickStart'
import { ThreadView } from '@/components/ThreadView'
import { TerminalTabBody } from '@/components/terminal/TerminalPaneTree'
import { DiffTabView } from '@/components/EditorTabViews'
import { FileEditorView } from '@/components/FileEditorView'
import { BrowserTabView } from './BrowserTabView'
import { ToolDrawer } from './ToolDrawer'
import { EmptyPane } from './EmptyPane'
import { WorkspacePanelView } from './workspace-panels'
import { TabStrip } from './TabStrip'
import { resolveTabDropTarget, setInsertionMark, tabDrag, type DraggedTab, type DropZone } from './tab-drag'
import { focusGroup, moveTabTo, openChatAt, openFilesAt, splitTabTo } from './tab-group-commands'
import { sidebarDrag, type DragItem } from '@/components/sidebar/sidebar-drag'
import './pane-split-commands'
import { tabWorkspaceId, type WorkspaceTab } from './workspace-tab-model'
import { t } from '@/i18n/i18n'

const OVERLAY_RECT: Record<DropZone, React.CSSProperties> = {
  up: { top: 0, left: 0, width: '100%', height: '50%' },
  down: { top: '50%', left: 0, width: '100%', height: '50%' },
  left: { top: 0, left: 0, width: '50%', height: '100%' },
  right: { top: 0, left: '50%', width: '50%', height: '100%' },
  center: { inset: 0 }
}

function TabBody({ tab }: { tab: WorkspaceTab }) {
  switch (tab.kind) {
    case 'start':
      return (
        <div key={tab.id} className="flex min-h-0 flex-1 flex-col overflow-y-auto">
          <QuickStart />
        </div>
      )
    case 'chat':
      return <ThreadView key={tab.id} session={tab.session} />
    case 'terminal':
      return <TerminalTabBody key={tab.id} tabId={tab.id} terminal={tab.terminal} />
    case 'editor':
      return tab.editor.kind === 'file' ? (
        <FileEditorView key={tab.id} tab={tab.editor} />
      ) : (
        <DiffTabView key={tab.id} tab={tab.editor} />
      )
    case 'browser':
      return <BrowserTabView key={tab.id} tab={tab.browser} />
    case 'panel':
      return (
        <div key={tab.id} className="flex min-h-0 flex-1 flex-col overflow-hidden bg-sidebar text-sidebar-foreground">
          <WorkspacePanelView id={tab.panel.panel} workspaceId={tab.panel.workspaceId} />
        </div>
      )
  }
}

/** Orca's TabGroupPanel: one split pane with its own tab row, body, and drop targets. */
export function TabGroupPane({
  workspaceId,
  groupId,
  tabs,
  activeId,
  isFocused,
  hasSplit,
  trailing,
  emptyHint
}: {
  workspaceId: string
  groupId: string
  tabs: WorkspaceTab[]
  activeId: string | null
  isFocused: boolean
  hasSplit: boolean
  trailing?: React.ReactNode
  emptyHint: string
}) {
  const active = tabs.find((t) => t.id === activeId) ?? null
  const activeChatId = active?.kind === 'chat' ? active.id : undefined
  // Among the window's tabs, the pane works in the workspace of the tab it shows: that is where its
  // "+" starts a terminal and whose drawer it pulls down. Showing none (or the "New thread" tab), it
  // falls back to the workspace in front, and has no workspace when there is none.
  const front = useStore((s) => s.activeWorkspaceId)
  const home = workspaceId !== WINDOW_TABS ? workspaceId : ((active ? tabWorkspaceId(active) : null) ?? front)
  const placed = home ?? workspaceId
  const [zone, setZone] = useState<DropZone | null>(null)

  useEffect(() => {
    if (activeChatId) void ensureSessionLoaded(activeChatId)
  }, [activeChatId])

  // Tabs move only within their own workspace, as before; the floating panel is another workspace.
  const dropRef = tabDrag.useDropTarget({
    accepts: (drag) => tabScope(drag.workspaceId) === tabScope(workspaceId),
    over: (drag, { point, element }) => {
      const target = resolveTabDropTarget(drag, groupId, element, point)
      setInsertionMark(target.kind === 'insert' ? target.mark : null)
      setZone(target.kind === 'split' ? target.side : target.kind === 'move' ? 'center' : null)
    },
    leave: () => {
      setInsertionMark(null)
      setZone(null)
    },
    drop: (drag, { point, element }) => {
      const target = resolveTabDropTarget(drag, groupId, element, point)
      if (target.kind === 'insert') moveTabTo(workspaceId, drag.tabId, target.groupId, target.index)
      else if (target.kind === 'split') splitTabTo(workspaceId, drag.tabId, target.groupId, target.side)
      else if (target.kind === 'move') moveTabTo(workspaceId, drag.tabId, target.groupId, tabs.length)
    }
  })

  // Files from the explorer open here, or in a new split from the pane's edge. As a drag they come
  // from no tab, so every edge splits and the body adds them to this pane.
  const asTab = (drag: DraggedPaths): DraggedTab => ({ workspaceId: drag.workspaceId, tabId: '', groupId: '', kind: 'editor' })
  const fileDropRef = filePathDrag.useDropTarget({
    accepts: (drag) => (drag.files?.length ?? 0) > 0 && tabScope(drag.workspaceId) === tabScope(workspaceId),
    over: (drag, { point, element }) => {
      const target = resolveTabDropTarget(asTab(drag), groupId, element, point)
      setInsertionMark(target.kind === 'insert' ? target.mark : null)
      setZone(target.kind === 'split' ? target.side : target.kind === 'move' ? 'center' : null)
    },
    leave: () => {
      setInsertionMark(null)
      setZone(null)
    },
    drop: (drag, { point, element }) => {
      const target = resolveTabDropTarget(asTab(drag), groupId, element, point)
      openFilesAt(workspaceId, drag.workspaceId, drag.files ?? [], target)
    }
  })
  // A thread dragged from the left sidebar opens as a tab the same way.
  const droppedChat = (item: DragItem) => {
    const session = item.sessionId ? getState().sessions.find((s) => s.id === item.sessionId) : undefined
    return session && !session.sideOf && tabScope(session.workspaceId) === tabScope(workspaceId) ? session : null
  }
  const chatAsTab = (workspace: string): DraggedTab => ({ workspaceId: workspace, tabId: '', groupId: '', kind: 'chat' })
  const chatDropRef = sidebarDrag.useDropTarget({
    accepts: (item) => droppedChat(item) !== null,
    over: (item, { point, element }) => {
      const target = resolveTabDropTarget(chatAsTab(droppedChat(item)!.workspaceId), groupId, element, point)
      setInsertionMark(target.kind === 'insert' ? target.mark : null)
      setZone(target.kind === 'split' ? target.side : target.kind === 'move' ? 'center' : null)
    },
    leave: () => {
      setInsertionMark(null)
      setZone(null)
    },
    drop: (item, { point, element }) => {
      const session = droppedChat(item)
      if (!session) return
      openChatAt(workspaceId, session.id, resolveTabDropTarget(chatAsTab(session.workspaceId), groupId, element, point))
    }
  })
  const paneRef = useCallback(
    (element: HTMLDivElement | null) => {
      dropRef(element)
      fileDropRef(element)
      chatDropRef(element)
    },
    [dropRef, fileDropRef, chatDropRef]
  )

  return (
    <div
      ref={paneRef}
      data-tab-group-id={groupId}
      data-focused={isFocused ? 'true' : 'false'}
      className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
      onPointerDown={() => !isFocused && focusGroup(workspaceId, groupId)}
    >
      <TabStrip
        workspaceId={placed}
        groupId={groupId}
        tabs={tabs}
        activeId={active?.id ?? null}
        isFocused={isFocused}
        hasSplit={hasSplit}
        trailing={trailing}
      />
      <div data-tab-group-body-id={groupId} className="relative flex min-h-0 min-w-0 flex-1 flex-col">
        {active ? (
          <TabBody tab={active} />
        ) : home ? (
          <EmptyPane workspaceId={home} groupId={groupId} hint={emptyHint} />
        ) : (
          // Nothing open and no workspace in front: the window offers what its "New thread" tab does.
          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
            <QuickStart />
          </div>
        )}
        {/* The drawer belongs to the tab on show: none without one, and each tab keeps its own. */}
        {active && home && active.kind !== 'start' && (
          <ToolDrawer key={active.id} workspaceId={home} tabId={active.id} exclude={active.id} focused={isFocused} />
        )}
      </div>
      {/* Split, the pane being worked in is outlined, so where a keystroke goes is plain to see. */}
      {hasSplit && isFocused && (
        <div aria-hidden data-focused-pane-outline className="pointer-events-none absolute inset-0 z-30 border border-highlight/60" />
      )}
      {zone && (
        <div aria-hidden data-tab-drop-zone={zone} className="tab-drop-overlay" style={OVERLAY_RECT[zone]}>
          {zone !== 'center' && (
            <span className="tab-drop-overlay__label pointer-events-none absolute bottom-2 left-2 rounded-sm px-1.5 py-0.5 font-medium">
              {t('New split')}
            </span>
          )}
        </div>
      )}
    </div>
  )
}
