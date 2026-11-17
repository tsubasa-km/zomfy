import { AppWindow } from 'lucide-react'
import { allProjects, allWorkspaces, getState, selectSession, selectWorkspace, useStore } from '@/session-store'
import { sidebarDrag, type DragItem } from '@/components/sidebar/sidebar-drag'
import { projectLabel } from '@/components/sidebar/workspace-visibility'
import { WorkspaceTabs } from '@/components/WorkspaceTabs'
import { PaneSidebar, PaneSidebarButtons } from '@/components/tab-layout/PaneSidebar'
import { PaneMoreMenu, PaneTitleMenu } from '@/components/PaneMenu'
import { DragChip } from '@/components/PointerDragLayer'
import { canPopOutWorkspace, popOutWorkspace } from '@/lib/workspace-window'
import { paneDrag } from '@/components/pane-drop'
import { WINDOW_TABS } from '@/stores/tab-layout-store'
import { t } from '@/i18n/i18n'

// The main area: one set of tabs for the whole window, as an editor's. A tab is a chat, a terminal,
// a file, a page or a panel of any workspace, and tabs split side by side whatever project they
// belong to. The header and the sidebar on the right follow the tab in front: they name the
// workspace it works in and show that workspace's files, changes and checks.

const EMPTY_HINT = t('No tabs yet. Start one here, or find more under + in the tab bar.')

/** The workspace a sidebar drag opens: a chat's or workspace's own, or a project's main checkout. */
function draggedWorkspace(item: DragItem): string | null {
  const id =
    item.kind === 'workspace'
      ? item.id
      : (allWorkspaces().find((w) => w.hostId === item.hostId && w.projectId === item.id && w.isPrimary)?.id ?? null)
  return id && !getState().poppedOut.includes(id) ? id : null
}

export function WorkspaceMain() {
  const active = useStore((s) => s.activeWorkspaceId)
  // A chat or workspace dropped here from the sidebar opens, as a click on it does.
  const dropRef = sidebarDrag.useDropTarget({
    accepts: (item) => draggedWorkspace(item) !== null,
    over: () => undefined,
    leave: () => undefined,
    drop: (item) => {
      const workspaceId = draggedWorkspace(item)
      if (item.sessionId) selectSession(item.sessionId)
      else if (workspaceId) selectWorkspace(workspaceId)
    }
  })

  return (
    <div ref={dropRef} className="relative flex min-w-0 flex-1" data-workspace-main>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {active ? <PaneHeader workspaceId={active} /> : <BareHeader />}
        <div className="flex min-h-0 min-w-0 flex-1">
          <WorkspaceTabs workspaceId={WINDOW_TABS} emptyHint={EMPTY_HINT} />
          {active && <PaneSidebar workspaceId={active} />}
        </div>
      </div>
    </div>
  )
}

/** A workspace's project (or quick chat) name, and its workspace and branch when they say more. */
export function usePaneTitle(workspaceId: string): { title: string; detail: string } {
  // Strings, not objects: the store hands out fresh workspace objects on every read.
  const title = useStore((s) => {
    const workspace = allWorkspaces(s).find((w) => w.id === workspaceId)
    if (!workspace) return ''
    const project = allProjects(s.hosts).find((p) => p.id === workspace.projectId)
    return project ? projectLabel(project) : workspace.scratch ? t('Quick chat') : workspace.name
  })
  const detail = useStore((s) => {
    const workspace = allWorkspaces(s).find((w) => w.id === workspaceId)
    if (!workspace || !workspace.projectId) return ''
    const name = workspace.displayName ?? workspace.name
    return workspace.branch && workspace.branch !== name ? `${name} · ${workspace.branch}` : name
  })
  return { title, detail: detail !== title ? detail : '' }
}

/**
 * The window's header, laid out as the Claude app's session header: where the tab in front works
 * (opening the project's menu), then that workspace's panels and "…". Dragged out of the window, it
 * opens the workspace in a window of its own.
 */
export function PaneHeader({ workspaceId }: { workspaceId: string }) {
  const { title, detail } = usePaneTitle(workspaceId)
  return (
    <div
      data-column-header
      title={canPopOutWorkspace() ? t('Drag out of the window to open this workspace in a window of its own') : undefined}
      className="flex h-10 shrink-0 items-center gap-1 border-b border-b-border pr-1.5 pl-1.5 select-none"
      onPointerDown={(event) => {
        if (!canPopOutWorkspace()) return
        if (event.target instanceof Element && event.target.closest('button')) return
        paneDrag.begin(event, {
          payload: () => ({ workspaceId }),
          preview: <DragChip label={title} icon={<AppWindow className="size-3.5" />} />,
          onDropOutside: (_item, screen) => void popOutWorkspace(workspaceId, screen)
        })
      }}
    >
      <PaneTitleMenu workspaceId={workspaceId} title={title} detail={detail} focused={false} />
      <div className="ml-auto flex shrink-0 items-center gap-0.5">
        <PaneSidebarButtons workspaceId={workspaceId} />
        <PaneMoreMenu workspaceId={workspaceId} />
      </div>
    </div>
  )
}

/** The header with no workspace in front (the "New chat" tab, or nothing open): the same height, so tabs do not jump. */
function BareHeader() {
  return (
    <div data-column-header className="flex h-10 shrink-0 items-center border-b border-b-border pr-1.5 pl-3 select-none">
      <span className="truncate text-sm font-medium text-muted-foreground">{t('New chat')}</span>
    </div>
  )
}
