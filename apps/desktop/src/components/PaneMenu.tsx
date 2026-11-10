import { useMemo } from 'react'
import { AppWindow, ChevronDown, MoreHorizontal, PanelRight } from 'lucide-react'
import { allProjects, allWorkspaces, useStore } from '@/session-store'
import { ProjectActionsMenuItems, sidebarActions } from '@/components/sidebar/ProjectActionsMenu'
import { sortGroups } from '@/components/sidebar/workspace-visibility'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { canPopOutWorkspace, popOutWorkspace } from '@/lib/workspace-window'
import { togglePaneSidebar, usePaneSidebar } from '@/stores/pane-sidebar-store'
import { cn } from '@/lib/utils'
import { t } from '@/i18n/i18n'

// A pane header's menus, as the Claude app's session header has them: the name opens the project's
// menu (the one on its sidebar row), and "…" holds what is about the pane itself.

/** Stops a press from starting the header's pane drag. */
const keepFromDrag = (event: React.PointerEvent) => event.stopPropagation()

function usePaneProject(workspaceId: string) {
  const hosts = useStore((s) => s.hosts)
  return useMemo(() => {
    const workspace = allWorkspaces({ hosts }).find((w) => w.id === workspaceId)
    const project = workspace ? (allProjects(hosts).find((p) => p.id === workspace.projectId && p.hostId === workspace.hostId) ?? null) : null
    const groups = project ? sortGroups(hosts[project.hostId]?.harness?.projectGroups ?? []) : []
    return { project, groups }
  }, [hosts, workspaceId])
}

/** The pane's name and where it is; with a project (and the sidebar that owns its dialogs), it opens the project's menu. */
export function PaneTitleMenu({ workspaceId, title, detail, focused }: { workspaceId: string; title: string; detail: string; focused: boolean }) {
  const { project, groups } = usePaneProject(workspaceId)
  const actions = sidebarActions()
  const label = (
    <>
      <span className={cn('min-w-0 shrink truncate text-sm font-medium', focused ? 'text-foreground' : 'text-muted-foreground')}>{title}</span>
      {detail && <span className="min-w-0 shrink-[2] truncate text-xs text-muted-foreground">{detail}</span>}
    </>
  )
  if (!project || !actions) return <div className="flex min-w-0 items-center gap-1.5">{label}</div>
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex min-w-0 items-center gap-1.5 rounded-md px-1.5 py-1 hover:bg-accent/60"
          aria-label={t('Project actions for {project}', { project: title })}
          data-pane-title-menu
          onPointerDown={keepFromDrag}
        >
          {label}
          <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-60">
        <ProjectActionsMenuItems project={project} groups={groups} actions={actions} />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** "…": the pane's own actions. */
export function PaneMoreMenu({ workspaceId }: { workspaceId: string }) {
  const sidebarOpen = usePaneSidebar(workspaceId).open
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          size="icon-sm"
          variant="ghost"
          className="size-7 shrink-0 text-muted-foreground"
          aria-label={t('Pane actions')}
          data-pane-menu
          onPointerDown={keepFromDrag}
        >
          <MoreHorizontal className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        {canPopOutWorkspace() && (
          <DropdownMenuItem data-pane-action="pop-out" onSelect={() => void popOutWorkspace(workspaceId)}>
            <AppWindow className="size-3.5" />
            {t('Open in New Window')}
          </DropdownMenuItem>
        )}
        <DropdownMenuItem data-pane-action="sidebar" onSelect={() => togglePaneSidebar(workspaceId)}>
          <PanelRight className="size-3.5" />
          {sidebarOpen ? t('Close sidebar') : t('Open sidebar')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
