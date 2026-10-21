import { ChevronRight, Folder, MoreHorizontal, Pencil, Trash2 } from 'lucide-react'
import { HARNESS_METHODS, type ProjectGroup } from '@acp-harness/protocol'
import { harnessRequest } from '@/daemon-connection'
import { setDropTarget, useSidebarStore } from '@/stores/sidebar-store'
import type { SidebarActions } from '@/components/sidebar/ProjectSection'
import { currentDrag, endDrag } from '@/components/sidebar/sidebar-drag'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'

// Orca's project group header: a collapsible folder row; projects dropped on it join the group.
export function GroupHeader({
  group,
  count,
  hostId,
  actions,
  onDropProject
}: {
  group: ProjectGroup
  count: number
  hostId: string
  actions: SidebarActions
  onDropProject: (projectId: string) => void
}) {
  const dropping = useSidebarStore((s) => s.dropTarget?.id === `group:${group.id}`)
  const update = (patch: Partial<Pick<ProjectGroup, 'name' | 'collapsed'>>) =>
    void harnessRequest(HARNESS_METHODS.projectGroupUpdate, { groupId: group.id, patch }, hostId)

  return (
    <div
      className={cn(
        'group/group flex h-7 min-w-0 cursor-pointer items-center gap-1 rounded-md pt-1 pr-1 pl-1 select-none',
        dropping && 'bg-worktree-sidebar-accent/70 ring-1 ring-worktree-sidebar-ring'
      )}
      data-project-group-header={group.id}
      onClick={() => update({ collapsed: !group.collapsed })}
      onDragOver={(e) => {
        const item = currentDrag()
        if (item?.kind !== 'project' || item.hostId !== hostId) return
        e.preventDefault()
        setDropTarget({ id: `group:${group.id}`, position: 'inside' })
      }}
      onDrop={(e) => {
        e.preventDefault()
        const item = currentDrag()
        endDrag()
        if (item?.kind === 'project') onDropProject(item.id)
      }}
    >
      <ChevronRight
        className={cn('size-3 shrink-0 text-muted-foreground transition-transform', !group.collapsed && 'rotate-90')}
      />
      <Folder className="size-3.5 shrink-0 text-muted-foreground" />
      <div className="min-w-0 truncate pl-0.5 text-[13px] leading-none font-semibold">{group.name}</div>
      <span className="text-[11px] text-muted-foreground tabular-nums">{count}</span>
      <div
        className="ml-auto flex items-center opacity-0 group-hover/group:opacity-100 has-[[data-state=open]]:opacity-100"
        onClick={(e) => e.stopPropagation()}
      >
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="icon-xs" variant="ghost" aria-label={`Group actions for ${group.name}`}>
              <MoreHorizontal className="size-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-48">
            <DropdownMenuItem data-group-action="rename" onSelect={() => actions.renameGroup(hostId, group)}>
              <Pencil className="size-3.5" />
              Rename Group…
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              data-group-action="delete"
              variant="destructive"
              onSelect={() => {
                if (window.confirm(`Delete the group "${group.name}"? Its projects stay in the sidebar.`)) {
                  void harnessRequest(HARNESS_METHODS.projectGroupRemove, { groupId: group.id }, hostId)
                }
              }}
            >
              <Trash2 className="size-3.5" />
              Delete Group
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  )
}
