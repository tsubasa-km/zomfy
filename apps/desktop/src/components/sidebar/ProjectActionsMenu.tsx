import { Fragment } from 'react'
import { FolderPlus, MessageSquarePlus, Plus, Settings2, Unlink, Workflow as WorkflowIcon } from 'lucide-react'
import { HARNESS_METHODS, type ProjectGroup } from '@acp-harness/protocol'
import { harnessRequest } from '@/daemon-connection'
import type { HostId, HostedProject } from '@/session-store'
import { ProjectMenuItems } from '@/components/sidebar/WorkspaceMenu'
import type { SidebarActions } from '@/components/sidebar/ProjectSection'
import { projectLabel } from '@/components/sidebar/workspace-visibility'
import { DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator } from '@/components/ui/dropdown-menu'
import { openAddProjectDialog } from '@/lib/project-dialogs'
import { unlinkProject } from '@/stores/project-links-store'
import { openWorkflows } from '@/stores/workflows-store'
import { startChat } from '@/lib/chat-worktree'
import { t } from '@/i18n/i18n'

// A project's "…" menu: on its row in the sidebar, and beside its name over a workspace pane.

let current: SidebarActions | null = null

/** The sidebar root, which owns the dialogs these items open, hands its actions over here. */
export function setSidebarActions(actions: SidebarActions): void {
  current = actions
}

/** Null where no sidebar is mounted (a workspace's own window). */
export function sidebarActions(): SidebarActions | null {
  return current
}

export function ProjectActionsMenuItems({
  project,
  groups,
  actions,
  copies = [],
  badgeFor
}: {
  project: HostedProject
  groups: ProjectGroup[]
  actions: SidebarActions
  /** The same repository on other hosts, listed with it in the sidebar. */
  copies?: HostedProject[]
  badgeFor?: (hostId: HostId) => string | null
}) {
  const label = projectLabel(project)
  return (
    <>
      <ProjectMenuItems
        hostId={project.hostId}
        path={project.path}
        groups={groups}
        groupId={project.groupId}
        onNewWorkspace={() => actions.newWorkspace(project)}
        onSettings={() => actions.projectSettings(project)}
        onMoveToGroup={(groupId) =>
          void harnessRequest(HARNESS_METHODS.projectUpdate, { projectId: project.id, patch: { groupId } }, project.hostId)
        }
        onNewGroup={() => actions.newGroup(project.hostId, [project.id])}
        onCleanUp={project.kind === 'git' ? () => actions.cleanUp(project) : undefined}
        onRemove={() => actions.removeProject(project)}
      />
      {project.kind === 'git' && (
        <>
          <DropdownMenuSeparator />
          <DropdownMenuItem data-project-action="chat-worktree" onSelect={() => void startChat(project)}>
            <MessageSquarePlus className="size-3.5" />
            {t('New Chat in Its Own Worktree')}
          </DropdownMenuItem>
          <DropdownMenuItem data-project-action="chat-checkout" onSelect={() => void startChat(project, 'checkout')}>
            <MessageSquarePlus className="size-3.5" />
            {t('New Chat in the Main Checkout')}
          </DropdownMenuItem>
        </>
      )}
      <DropdownMenuSeparator />
      <DropdownMenuItem
        data-project-action="workflows"
        onSelect={() => openWorkflows({ hostId: project.hostId, projectId: project.id, projectName: label })}
      >
        <WorkflowIcon className="size-3.5" />
        {t('Workflows…')}
      </DropdownMenuItem>
      <DropdownMenuItem
        data-project-action="add-workspace-elsewhere"
        onSelect={() => openAddProjectDialog({ linkTo: { hostId: project.hostId, projectId: project.id, name: label } })}
      >
        <FolderPlus className="size-3.5" />
        {t('Add Workspace on Another Host…')}
      </DropdownMenuItem>
      {copies.map((copy) => (
        <Fragment key={copy.id}>
          <DropdownMenuSeparator />
          <DropdownMenuLabel className="px-2 py-1 text-[11px] font-medium text-muted-foreground">
            {t('{project} on {host}', { project: projectLabel(copy), host: badgeFor?.(copy.hostId) ?? copy.hostId })}
          </DropdownMenuLabel>
          <DropdownMenuItem onSelect={() => actions.newWorkspace(copy)}>
            <Plus className="size-3.5" />
            {t('New Workspace There…')}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => actions.projectSettings(copy)}>
            <Settings2 className="size-3.5" />
            {t('Project Settings…')}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => void unlinkProject({ hostId: copy.hostId, projectId: copy.id })}>
            <Unlink className="size-3.5" />
            {t('Detach from {project}', { project: label })}
          </DropdownMenuItem>
        </Fragment>
      ))}
    </>
  )
}
