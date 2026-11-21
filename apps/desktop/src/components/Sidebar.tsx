import { useState } from 'react'
import { HARNESS_METHODS, type Workspace } from '@zomfy/protocol'
import { harnessRequest } from '@/daemon-connection'
import type { HostedProject } from '@/session-store'
import { DeleteWorkspaceDialog, UpdateWorkspaceDialog } from '@/components/workspace-dialogs'
import { SidebarHeader } from '@/components/sidebar/SidebarHeader'
import { SidebarSearch } from '@/components/sidebar/SidebarSearch'
import { ChatList, useChatListCounts } from '@/components/sidebar/ChatList'
import type { SidebarActions } from '@/components/sidebar/sidebar-actions'
import { setSidebarActions } from '@/components/sidebar/ProjectActionsMenu'
import { NewWorkspaceDialog } from '@/components/sidebar/NewWorkspaceDialog'
import { SidebarNav } from '@/components/sidebar/SidebarNav'
import { openNewWorkspace, useNewWorkspaceRequest } from '@/stores/tasks-store'
import { ProjectSettingsDialog } from '@/components/sidebar/ProjectSettingsDialog'
import { ProjectDialogs } from '@/components/sidebar/ProjectDialogs'
import { CleanupMergedDialog } from '@/components/sidebar/CleanupMergedDialog'
import { useWorkspaceSummaries } from '@/components/sidebar/use-workspace-summaries'
import { useCardReviewSummaries } from '@/stores/hosting-store'
import { projectLabel } from '@/components/sidebar/workspace-visibility'
import { useSetting } from '@/stores/settings-store'
import { useSidebarWidth } from '@/stores/sidebar-width-store'
import { SidebarResizeHandle } from '@/components/SidebarResizeHandle'
import { cn } from '@/lib/utils'
import { t } from '@/i18n/i18n'

// The left sidebar: the app's pages, then every chat in one list (components/sidebar/ChatList).
// Markup and classes follow Orca's sidebar; the dialogs its menus open live here.

export function Sidebar() {
  const visible = useSetting('sidebarVisible')
  const width = useSidebarWidth('left')
  const chatCounts = useChatListCounts()
  const newWorkspace = useNewWorkspaceRequest()
  const [deleting, setDeleting] = useState<Workspace | null>(null)
  const [updating, setUpdating] = useState<Workspace | null>(null)
  const [settingsFor, setSettingsFor] = useState<HostedProject | null>(null)
  const [cleanUp, setCleanUp] = useState<HostedProject | null>(null)
  useWorkspaceSummaries()
  useCardReviewSummaries()

  const actions: SidebarActions = {
    newWorkspace: (project, parent) => openNewWorkspace({ project, parent }),
    update: setUpdating,
    remove: setDeleting,
    projectSettings: setSettingsFor,
    cleanUp: setCleanUp,
    removeProject: (project) => {
      if (window.confirm(t('Remove {name} from Zomfy? Its folders and worktrees on disk are kept.', { name: projectLabel(project) }))) {
        void harnessRequest(HARNESS_METHODS.projectRemove, { projectId: project.id }, project.hostId)
      }
    }
  }
  // Pane headers open the same project menu; its dialogs live here.
  setSidebarActions(actions)

  return (
    // Hidden, not unmounted: the dialogs below are opened from elsewhere too.
    <aside
      style={{ width }}
      className={cn(
        'relative flex min-h-0 flex-shrink-0 flex-col overflow-hidden border-r border-worktree-sidebar-border bg-worktree-sidebar text-worktree-sidebar-foreground',
        !visible && 'hidden'
      )}
    >
      <SidebarResizeHandle widthKey="left" edge="right" />
      <SidebarNav />
      <SidebarHeader />
      <SidebarSearch matchCount={chatCounts.matched} totalCount={chatCounts.total} />

      <div className="worktree-sidebar-scrollbar mt-1 flex min-h-0 flex-1 flex-col overflow-x-hidden overflow-y-auto px-1 pb-3" data-chat-list-scroll>
        <ChatList actions={actions} />
      </div>

      <NewWorkspaceDialog request={newWorkspace} onClose={() => openNewWorkspace(null)} />
      <DeleteWorkspaceDialog workspace={deleting} onClose={() => setDeleting(null)} />
      <UpdateWorkspaceDialog workspace={updating} onClose={() => setUpdating(null)} />
      <ProjectSettingsDialog project={settingsFor} onClose={() => setSettingsFor(null)} />
      <ProjectDialogs />
      <CleanupMergedDialog project={cleanUp} onClose={() => setCleanUp(null)} />
    </aside>
  )
}
