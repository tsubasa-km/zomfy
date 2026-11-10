import { useMemo } from 'react'
import { AppWindow, MoreHorizontal } from 'lucide-react'
import { allProjects, allWorkspaces, useStore } from '@/session-store'
import { ProjectActionsMenuItems, sidebarActions } from '@/components/sidebar/ProjectActionsMenu'
import { sortGroups } from '@/components/sidebar/workspace-visibility'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { canPopOutWorkspace, popOutWorkspace } from '@/lib/workspace-window'
import { t } from '@/i18n/i18n'

// The "…" beside a pane's project name: opening the workspace in a window of its own, then the
// project's menu as its sidebar row has it.

export function PaneMenu({ workspaceId }: { workspaceId: string }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          size="icon-xs"
          variant="ghost"
          className="shrink-0 text-muted-foreground"
          aria-label={t('Pane actions')}
          data-pane-menu
          // The header drags the pane; a press here opens the menu.
          onPointerDown={(event) => event.stopPropagation()}
        >
          <MoreHorizontal className="size-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-60">
        <PaneMenuItems workspaceId={workspaceId} />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function PaneMenuItems({ workspaceId }: { workspaceId: string }) {
  const hosts = useStore((s) => s.hosts)
  const { project, groups } = useMemo(() => {
    const workspace = allWorkspaces({ hosts }).find((w) => w.id === workspaceId)
    const project = workspace ? (allProjects(hosts).find((p) => p.id === workspace.projectId && p.hostId === workspace.hostId) ?? null) : null
    const groups = project ? sortGroups(hosts[project.hostId]?.harness?.projectGroups ?? []) : []
    return { project, groups }
  }, [hosts, workspaceId])
  const actions = sidebarActions()
  const popOut = canPopOutWorkspace()
  return (
    <>
      {popOut && (
        <DropdownMenuItem data-pane-action="pop-out" onSelect={() => void popOutWorkspace(workspaceId)}>
          <AppWindow className="size-3.5" />
          {t('Open in New Window')}
        </DropdownMenuItem>
      )}
      {project && actions && (
        <>
          {popOut && <DropdownMenuSeparator />}
          <ProjectActionsMenuItems project={project} groups={groups} actions={actions} />
        </>
      )}
    </>
  )
}
