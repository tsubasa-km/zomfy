import { allProjects, allWorkspaces, getState, selectSession, selectWorkspace, useStore } from '@/session-store'
import { sidebarDrag, type DragItem } from '@/components/sidebar/sidebar-drag'
import { projectLabel } from '@/components/sidebar/workspace-visibility'
import { WorkspaceTabs } from '@/components/WorkspaceTabs'
import { WINDOW_TABS } from '@/stores/tab-layout-store'
import { t } from '@/i18n/i18n'

// The main area: one set of tabs for the whole window, as an editor's. A tab is a chat, a terminal,
// a file, a page or a panel of any workspace, and tabs split side by side whatever project they
// belong to. There is no header above them: each split pane has a sidebar on its right showing the
// files, changes and checks of the workspace its tab works in (docs/specs/pane-sidebars.md), and the
// status bar names the workspace in front.

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
      <WorkspaceTabs workspaceId={WINDOW_TABS} emptyHint={EMPTY_HINT} />
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
    return project ? projectLabel(project) : workspace.scratch ? t('Quick thread') : workspace.name
  })
  const detail = useStore((s) => {
    const workspace = allWorkspaces(s).find((w) => w.id === workspaceId)
    if (!workspace || !workspace.projectId) return ''
    const name = workspace.displayName ?? workspace.name
    return workspace.branch && workspace.branch !== name ? `${name} · ${workspace.branch}` : name
  })
  return { title, detail: detail !== title ? detail : '' }
}
