import { lazy, memo, Suspense, useCallback, useEffect, useState } from 'react'
import { filePathDrag, type DraggedPaths } from '@/lib/file-path-drag'
import { ensureSessionLoaded } from '@/daemon-connection'
import { getState, sidebarWorkspaceId, usePaneSidebarWorkspaceId, useStore } from '@/session-store'
import { setGroupContext, tabScope, WINDOW_TABS } from '@/stores/tab-layout-store'
import { paneSidebarKey } from '@/stores/pane-sidebar-store'
import { QuickStart } from '@/components/QuickStart'
import { ThreadView } from '@/components/ThreadView'
import { TerminalTabBody } from '@/components/terminal/TerminalPaneTree'
import { BrowserTabView } from './BrowserTabView'
import { DRAWER_HANDLE_INSET, ToolDrawer } from './ToolDrawer'
import { EmptyPane } from './EmptyPane'
import { WindowEmptyPane } from './WindowEmptyPane'
import { ErrorBoundary, ViewError } from '@/components/ErrorBoundary'
import { WorkspacePanelView } from './workspace-panels'
import { TabStrip } from './TabStrip'
import { PaneSidebar, PaneSidebarToggle } from './PaneSidebar'
import { usePaneContext } from './PaneContext'
import { dropHintRect } from './tab-drop-geometry'
import { resolveTabDropTarget, setInsertionMark, tabDrag, type DraggedTab, type DropZone } from './tab-drag'
import { focusGroup, moveTabTo, openChatAt, openFilesAt, splitTabTo } from './tab-group-commands'
import { sidebarDrag, type DragItem } from '@/components/sidebar/sidebar-drag'
import './pane-split-commands'
import { tabWorkspaceId, type WorkspaceTab } from './workspace-tab-model'
import { cn } from '@/lib/utils'
import { t } from '@/i18n/i18n'

// The editors bring Monaco (megabytes of script); loaded on the first file or diff tab, not at startup.
const FileEditorView = lazy(() => import('@/components/FileEditorView').then((m) => ({ default: m.FileEditorView })))
const DiffTabView = lazy(() => import('@/components/EditorTabViews').then((m) => ({ default: m.DiffTabView })))

// The hint covers the place the new split takes: a share of the whole pane, its sidebar included.
const pct = (share: number) => `${share * 100}%`
const overlayRect = (zone: DropZone): React.CSSProperties => {
  const r = dropHintRect(zone)
  return { left: pct(r.left), top: pct(r.top), width: pct(r.width), height: pct(r.height) }
}

/** Memoised: the tab objects are kept while unchanged, so another tab's change leaves this view alone. */
const TabBody = memo(function TabBody({ tab }: { tab: WorkspaceTab }) {
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
      return (
        <Suspense fallback={<div key={tab.id} className="min-h-0 flex-1 bg-editor-surface" />}>
          {tab.editor.kind === 'file' ? <FileEditorView key={tab.id} tab={tab.editor} /> : <DiffTabView key={tab.id} tab={tab.editor} />}
        </Suspense>
      )
    case 'browser':
      return <BrowserTabView key={tab.id} tab={tab.browser} />
    case 'panel':
      return (
        // The panel keeps clear of the drawer's handle itself; what it holds (a side chat) keeps no inset of its own.
        <div key={tab.id} className="flex min-h-0 flex-1 flex-col overflow-hidden bg-sidebar pt-(--tab-top-inset) text-sidebar-foreground *:[--tab-top-inset:0px]">
          <WorkspacePanelView id={tab.panel.panel} workspaceId={tab.panel.workspaceId} />
        </div>
      )
  }
})

/**
 * A tab's body in its error boundary: one tab that fails to render keeps to its own pane, and
 * switching tabs remounts the boundary. Hidden, it stays mounted and laid out under the tab in
 * front, out of sight and out of reach of focus and the pointer.
 */
function TabBodyFrame({ tab, hidden }: { tab: WorkspaceTab; hidden?: boolean }) {
  return (
    <div
      data-tab-body={tab.id}
      data-tab-body-hidden={hidden || undefined}
      inert={hidden || undefined}
      aria-hidden={hidden || undefined}
      className={cn('flex min-h-0 min-w-0 flex-1 flex-col', hidden && 'pointer-events-none invisible absolute inset-0')}
    >
      <ErrorBoundary fallback={(error, reset) => <ViewError error={error} onRetry={reset} />}>
        <TabBody tab={tab} />
      </ErrorBoundary>
    </div>
  )
}

/** Orca's TabGroupPanel: one split pane with its own tab row, body, and drop targets. Memoised (see WorkspaceTabs). */
export const TabGroupPane = memo(function TabGroupPane({
  workspaceId,
  groupId,
  tabs,
  activeId,
  isFocused,
  hasSplit,
  trailing,
  emptyHint,
  sidebar
}: {
  workspaceId: string
  groupId: string
  tabs: WorkspaceTab[]
  activeId: string | null
  isFocused: boolean
  hasSplit: boolean
  trailing?: React.ReactNode
  emptyHint: string
  /** Whether the pane has a right sidebar of its own (docs/specs/pane-sidebars.md). */
  sidebar: boolean
}) {
  const active = tabs.find((t) => t.id === activeId) ?? null
  // The chat shown before the "New thread" tab stays mounted under it, hidden: closing the New
  // thread tab (or going back to the chat) then shows it at once, where mounting a long chat's
  // transcript again stalls the window for a moment. Only a chat: other kinds are cheap to mount,
  // and a browser tab's view is not hidden by its page's styles.
  const [lastShown, setLastShown] = useState<string | null>(null)
  if (active && active.kind !== 'start' && active.id !== lastShown) setLastShown(active.id)
  const behind = active?.kind === 'start' ? (tabs.find((t) => t.id === lastShown && t.kind === 'chat') ?? null) : null
  const activeChatId = active?.kind === 'chat' ? active.id : undefined
  // The pane works in a workspace of its own (docs/specs/panes-as-workspaces.md): its "+", pins and
  // sidebar act on it, whatever tab it shows. The drawer is the tab's: it holds that tab's terminals.
  const { context, settle } = usePaneContext(workspaceId, groupId, tabs, active?.id ?? null)
  useEffect(() => {
    if (settle) setGroupContext(workspaceId, groupId, settle)
  }, [settle, workspaceId, groupId])
  const home = workspaceId !== WINDOW_TABS ? workspaceId : active ? tabWorkspaceId(active) : null
  // With no tab and no context, the empty pane still offers the project the sidebar shows.
  const recent = useStore((s) => (context ? null : sidebarWorkspaceId(s)))
  const [zone, setZone] = useState<DropZone | null>(null)
  const drawer = Boolean(active && home && active.kind !== 'start')
  // The pane's own right sidebar, on the pane's workspace.
  const scope = tabScope(workspaceId)
  const sidebarKey = paneSidebarKey(scope, groupId)
  const ownSidebarWorkspace = usePaneSidebarWorkspaceId(scope, scope === WINDOW_TABS ? context : null)
  const sidebarWorkspace = scope === WINDOW_TABS ? context : ownSidebarWorkspace
  const showSidebar = sidebar && sidebarWorkspace !== null

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
    // A press anywhere in the pane, its sidebar too, makes it the one being worked in.
    // The whole pane, sidebar included, is the drop target: a split divides all of it.
    <div
      ref={paneRef}
      data-tab-pane={groupId}
      className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden"
      onPointerDown={() => !isFocused && focusGroup(workspaceId, groupId)}
    >
      <div
        data-tab-group-id={groupId}
        data-focused={isFocused ? 'true' : 'false'}
        className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
      >
        <TabStrip
          workspaceId={workspaceId}
          context={context}
          groupId={groupId}
          tabs={tabs}
          activeId={active?.id ?? null}
          isFocused={isFocused}
          hasSplit={hasSplit}
          trailing={
            showSidebar ? (
              <>
                {trailing}
                <div className="flex shrink-0 items-center pr-1.5 pl-1" data-pane-tools>
                  <PaneSidebarToggle paneKey={sidebarKey} />
                </div>
              </>
            ) : (
              trailing
            )
          }
        />
        {/* Under a drawer's handle the tab's content starts lower, each kind in its own way (--tab-top-inset). */}
        <div
          data-tab-group-body-id={groupId}
          className="relative flex min-h-0 min-w-0 flex-1 flex-col"
          style={drawer ? DRAWER_HANDLE_INSET : undefined}
        >
          {behind && <TabBodyFrame key={`body:${behind.id}`} tab={behind} hidden />}
          {active ? (
            // Its key differs from the drawer's beside it: siblings sharing a key leave a closed tab's
            // view on screen. The same key keeps a chat mounted as it moves from behind the New
            // thread tab to the front.
            <TabBodyFrame key={`body:${active.id}`} tab={active} />
          ) : context ? (
            <EmptyPane workspaceId={context} groupId={groupId} hint={emptyHint} />
          ) : recent ? (
            <EmptyPane workspaceId={recent} groupId={groupId} hint={emptyHint} />
          ) : (
            // Nothing open and no project to offer: the list a project's empty pane shows, for the window.
            <WindowEmptyPane />
          )}
          {/* The drawer belongs to the tab on show: none without one, and each tab keeps its own. */}
          {active && home && drawer && (
            <ToolDrawer key={`drawer:${active.id}`} workspaceId={home} tabId={active.id} exclude={active.id} focused={isFocused} />
          )}
        </div>
      </div>
      {showSidebar && <PaneSidebar paneKey={sidebarKey} workspaceId={sidebarWorkspace} />}
      {zone && (
        <div aria-hidden data-tab-drop-zone={zone} className="tab-drop-overlay" style={overlayRect(zone)}>
          {zone !== 'center' && (
            <span className="tab-drop-overlay__label pointer-events-none absolute bottom-2 left-2 rounded-sm px-1.5 py-0.5 font-medium">
              {t('New split')}
            </span>
          )}
        </div>
      )}
      {/* Split, the pane being worked in is outlined, so where a keystroke goes is plain to see. */}
      {hasSplit && isFocused && (
        <div aria-hidden data-focused-pane-outline className="pointer-events-none absolute inset-0 z-30 border border-highlight/60" />
      )}
    </div>
  )
})
