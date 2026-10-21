import { ChevronRight, FolderGit2, FolderOpen, MoreHorizontal, Plus } from 'lucide-react'
import { HARNESS_METHODS, type ProjectGroup, type Workspace } from '@acp-harness/protocol'
import { harnessRequest } from '@/daemon-connection'
import { setSidebarView, useStore, type HostId, type HostedProject, type Session } from '@/session-store'
import { toggleProjectCollapsed, useSidebarStore } from '@/stores/sidebar-store'
import { DropLine, WorkspaceCard } from '@/components/sidebar/WorkspaceCard'
import { ProjectMenuItems, updateWorkspace } from '@/components/sidebar/WorkspaceMenu'
import { currentDrag, endDrag, handleDragOver, startDrag, type DragItem } from '@/components/sidebar/sidebar-drag'
import {
  buildWorkspaceTree,
  projectLabel,
  reorderIds,
  sortWorkspaces,
  type WorkspaceNode
} from '@/components/sidebar/workspace-visibility'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

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
  onProjectDrop
}: {
  project: HostedProject
  groups: ProjectGroup[]
  workspaces: Workspace[]
  sessions: Session[]
  activeWorkspaceId: string | null
  actions: SidebarActions
  onProjectDrop: (item: DragItem, position: 'before' | 'after') => void
}) {
  const view = useStore((s) => s.sidebarView)
  const collapsed = useSidebarStore((s) => s.collapsedProjects.includes(project.id))
  const headerDrop = useSidebarStore((s) => (s.dropTarget?.id === `project:${project.id}` ? s.dropTarget.position : null))
  const label = projectLabel(project)
  const tree = buildWorkspaceTree(sortWorkspaces(workspaces, view, sessions))

  /** Reorder among the target's siblings, or nest under the target (Orca's lineage drop). */
  function dropOnWorkspace(item: DragItem, target: Workspace, siblings: Workspace[], position: 'before' | 'after' | 'inside') {
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
    void harnessRequest(HARNESS_METHODS.workspacesReorder, { workspaceIds: order }, project.hostId)
    if (view.sortBy !== 'manual') setSidebarView({ sortBy: 'manual' })
  }

  const renderNodes = (nodes: WorkspaceNode[], depth: number) =>
    nodes.map((node) => {
      const w = node.workspace
      const siblings = nodes.map((n) => n.workspace)
      return (
        <div key={w.id} data-workspace-node={w.id}>
          <WorkspaceCard
            workspace={w}
            hostId={project.hostId}
            sessions={sessions.filter((s) => s.workspaceId === w.id)}
            active={w.id === activeWorkspaceId}
            depth={depth}
            drop={{
              accept: (item) =>
                item.kind === 'workspace' &&
                item.hostId === project.hostId &&
                item.projectId === project.id &&
                item.id !== w.id &&
                !isDescendant(workspaces, w.id, item.id) &&
                (project.kind === 'git' ? 'order-or-nest' : 'order'),
              onDrop: (item, position) => dropOnWorkspace(item, w, siblings, position)
            }}
            onUpdate={() => actions.update(w)}
            onDelete={() => actions.remove(w)}
            onNewChild={project.kind === 'git' && w.branch ? () => actions.newWorkspace(project, w) : undefined}
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
        draggable
        data-project-header
        onClick={() => toggleProjectCollapsed(project.id)}
        onDragStart={(e) => startDrag(e, { kind: 'project', id: project.id, hostId: project.hostId, projectId: project.id })}
        onDragEnd={endDrag}
        onDragOver={(e) =>
          handleDragOver(e, `project:${project.id}`, (item) =>
            item.kind === 'project' && item.hostId === project.hostId && item.id !== project.id ? 'order' : false
          )
        }
        onDrop={(e) => {
          e.preventDefault()
          const item = currentDrag()
          const position = headerDrop === 'before' ? 'before' : 'after'
          endDrag()
          if (item?.kind === 'project') onProjectDrop(item, position)
        }}
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
        <span className="text-[11px] text-muted-foreground tabular-nums">{workspaces.length}</span>
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
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      {!collapsed && renderNodes(tree, 0)}
    </section>
  )
}
