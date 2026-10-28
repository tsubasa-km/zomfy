import { Fragment } from 'react'
import { ChevronRight, FolderGit2, FolderOpen, FolderPlus, MoreHorizontal, Plus, Settings2, Unlink, Workflow as WorkflowIcon } from 'lucide-react'
import { HARNESS_METHODS, type ProjectGroup, type Workspace } from '@acp-harness/protocol'
import { harnessRequest } from '@/daemon-connection'
import { setSidebarView, useStore, type HostId, type HostedProject, type Session } from '@/session-store'
import { toggleProjectCollapsed, useSidebarStore } from '@/stores/sidebar-store'
import { DropLine, WorkspaceCard } from '@/components/sidebar/WorkspaceCard'
import { ProjectMenuItems, updateWorkspace } from '@/components/sidebar/WorkspaceMenu'
import { ProjectChatList, projectChats } from '@/components/sidebar/ProjectChatList'
import { beginSidebarDrag, useSidebarDropTarget, type DragItem } from '@/components/sidebar/sidebar-drag'
import {
  buildWorkspaceTree,
  projectLabel,
  reorderIds,
  sortWorkspaces,
  type WorkspaceNode
} from '@/components/sidebar/workspace-visibility'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { openAddProjectDialog } from '@/lib/project-dialogs'
import { unlinkProject } from '@/stores/project-links-store'
import { openWorkflows } from '@/stores/workflows-store'

/** Dialogs and flows the sidebar root owns; sections only ask for them. */
export interface SidebarActions {
  newWorkspace: (project: HostedProject, parent?: Workspace) => void
  update: (workspace: Workspace) => void
  remove: (workspace: Workspace) => void
  projectSettings: (project: HostedProject) => void
  newGroup: (hostId: HostId, projectIds?: string[]) => void
  renameGroup: (hostId: HostId, group: ProjectGroup) => void
  cleanUp: (project: HostedProject) => void
  removeProject: (project: HostedProject) => void
}

function isDescendant(workspaces: Workspace[], candidateId: string, ancestorId: string): boolean {
  for (let id: string | undefined = candidateId; id; ) {
    if (id === ancestorId) return true
    id = workspaces.find((w) => w.id === id)?.parentWorkspaceId
  }
  return false
}

export function ProjectSection({
  project,
  groups,
  workspaces,
  sessions,
  activeWorkspaceId,
  actions,
  onProjectDrop,
  hostBadge,
  copies = [],
  badgeFor
}: {
  project: HostedProject
  groups: ProjectGroup[]
  workspaces: Workspace[]
  sessions: Session[]
  activeWorkspaceId: string | null
  actions: SidebarActions
  onProjectDrop: (item: DragItem, position: 'before' | 'after') => void
  /** Where the project lives when that is not the default host ("WSL", an SSH host). */
  hostBadge?: string
  /** The same repository added on other hosts, listed as one project; `workspaces` holds theirs too. */
  copies?: HostedProject[]
  /** A host's short name for cards of a merged project (null for the default host). */
  badgeFor?: (hostId: HostId) => string | null
}) {
  const view = useStore((s) => s.sidebarView)
  const collapsed = useSidebarStore((s) => s.collapsedProjects.includes(project.id))
  const headerDrop = useSidebarStore((s) => (s.dropTarget?.id === `project:${project.id}` ? s.dropTarget.position : null))
  const label = projectLabel(project)
  const headerDropRef = useSidebarDropTarget(
    `project:${project.id}`,
    (item) => (item.kind === 'project' && item.hostId === project.hostId && item.id !== project.id ? 'order' : false),
    (item, position) => onProjectDrop(item, position === 'before' ? 'before' : 'after')
  )
  const tree = buildWorkspaceTree(sortWorkspaces(workspaces, view, sessions))
  const showChats = (view.rows ?? 'chats') === 'chats'
  const hostOf = (w: Workspace) => (copies.find((c) => c.id === w.projectId) ?? project).hostId

  /** Reorder among the target's siblings, or nest under the target (Orca's lineage drop). */
  function dropOnWorkspace(
    item: DragItem,
    target: Workspace,
    siblings: Workspace[],
    position: 'before' | 'after' | 'inside',
    hostId: HostId
  ) {
    if (position === 'inside') {
      void updateWorkspace(item.id, { parentWorkspaceId: target.id })
      return
    }
    const dragged = workspaces.find((w) => w.id === item.id)
    if (dragged && (dragged.parentWorkspaceId ?? undefined) !== (target.parentWorkspaceId ?? undefined)) {
      void updateWorkspace(item.id, { parentWorkspaceId: target.parentWorkspaceId ?? null })
    }
    const order = reorderIds(siblings.map((w) => w.id), item.id, target.id, position)
    if (!order) return
    void harnessRequest(HARNESS_METHODS.workspacesReorder, { workspaceIds: order }, hostId)
    if (view.sortBy !== 'manual') setSidebarView({ sortBy: 'manual' })
  }

  const renderNodes = (nodes: WorkspaceNode[], depth: number) =>
    nodes.map((node) => {
      const w = node.workspace
      // A merged project's workspace belongs to the copy on its own host; moves stay within that copy.
      const owner = copies.find((c) => c.id === w.projectId) ?? project
      const siblings = nodes.map((n) => n.workspace).filter((s) => s.projectId === owner.id)
      return (
        <div key={w.id} data-workspace-node={w.id}>
          <WorkspaceCard
            workspace={w}
            hostId={owner.hostId}
            hostBadge={copies.length > 0 ? (badgeFor?.(owner.hostId) ?? undefined) : undefined}
            sessions={sessions.filter((s) => s.workspaceId === w.id)}
            active={w.id === activeWorkspaceId}
            depth={depth}
            drop={{
              accept: (item) =>
                item.kind === 'workspace' &&
                item.hostId === owner.hostId &&
                item.projectId === owner.id &&
                item.id !== w.id &&
                !isDescendant(workspaces, w.id, item.id) &&
                (owner.kind === 'git' ? 'order-or-nest' : 'order'),
              onDrop: (item, position) => dropOnWorkspace(item, w, siblings, position, owner.hostId)
            }}
            onUpdate={() => actions.update(w)}
            onDelete={() => actions.remove(w)}
            onNewChild={owner.kind === 'git' && w.branch ? () => actions.newWorkspace(owner, w) : undefined}
          />
          {node.children.length > 0 && renderNodes(node.children, depth + 1)}
        </div>
      )
    })

  return (
    <section className="group/project relative mb-2" data-project-id={project.id}>
      {headerDrop === 'before' && <DropLine edge="top" />}
      {headerDrop === 'after' && <DropLine edge="bottom" />}
      <div
        className="flex h-7 min-w-0 cursor-pointer items-center gap-1 pt-1 pr-1 pl-1 select-none"
        title={project.path}
        ref={headerDropRef}
        data-project-header
        onClick={() => toggleProjectCollapsed(project.id)}
        onPointerDown={(e) =>
          beginSidebarDrag(e, { kind: 'project', id: project.id, hostId: project.hostId, projectId: project.id }, label)
        }
      >
        <ChevronRight
          className={cn('size-3 shrink-0 text-muted-foreground transition-transform', !collapsed && 'rotate-90')}
        />
        {project.kind === 'git' ? (
          <FolderGit2 className="size-3.5 shrink-0 text-muted-foreground" />
        ) : (
          <FolderOpen className="size-3.5 shrink-0 text-muted-foreground" />
        )}
        <div className="min-w-0 truncate pl-0.5 text-[13px] leading-none font-semibold">{label}</div>
        <span className="text-[11px] text-muted-foreground tabular-nums">
          {showChats ? projectChats(workspaces, sessions).length : workspaces.length}
        </span>
        {hostBadge && (
          <span
            className="shrink-0 rounded border border-worktree-sidebar-border px-1 text-[10px] leading-4 text-muted-foreground"
            data-project-host={project.hostId}
            title={project.path}
          >
            {hostBadge}
          </span>
        )}
        <div
          className="ml-auto flex items-center opacity-0 group-hover/project:opacity-100 has-[[data-state=open]]:opacity-100"
          onClick={(e) => e.stopPropagation()}
        >
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="icon-xs"
                variant="ghost"
                aria-label={`New workspace in ${label}`}
                onClick={() => actions.newWorkspace(project)}
              >
                <Plus className="size-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">New workspace…</TooltipContent>
          </Tooltip>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="icon-xs" variant="ghost" aria-label={`Project actions for ${label}`}>
                <MoreHorizontal className="size-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-60">
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
              <DropdownMenuSeparator />
              <DropdownMenuItem
                data-project-action="workflows"
                onSelect={() => openWorkflows({ hostId: project.hostId, projectId: project.id, projectName: label })}
              >
                <WorkflowIcon className="size-3.5" />
                Workflows…
              </DropdownMenuItem>
              <DropdownMenuItem
                data-project-action="add-workspace-elsewhere"
                onSelect={() =>
                  openAddProjectDialog({ linkTo: { hostId: project.hostId, projectId: project.id, name: label } })
                }
              >
                <FolderPlus className="size-3.5" />
                Add Workspace on Another Host…
              </DropdownMenuItem>
              {copies.map((copy) => (
                <Fragment key={copy.id}>
                  <DropdownMenuSeparator />
                  <DropdownMenuLabel className="px-2 py-1 text-[11px] font-medium text-muted-foreground">
                    {projectLabel(copy)} on {badgeFor?.(copy.hostId) ?? copy.hostId}
                  </DropdownMenuLabel>
                  <DropdownMenuItem onSelect={() => actions.newWorkspace(copy)}>
                    <Plus className="size-3.5" />
                    New Workspace There…
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => actions.projectSettings(copy)}>
                    <Settings2 className="size-3.5" />
                    Project Settings…
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => void unlinkProject({ hostId: copy.hostId, projectId: copy.id })}>
                    <Unlink className="size-3.5" />
                    Detach from {label}
                  </DropdownMenuItem>
                </Fragment>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      {!collapsed &&
        (showChats ? (
          <ProjectChatList workspaces={workspaces} sessions={sessions} activeWorkspaceId={activeWorkspaceId} hostOf={hostOf} />
        ) : (
          renderNodes(tree, 0)
        ))}
    </section>
  )
}
