import { useState } from 'react'
import { invoke, isTauri } from '@tauri-apps/api/core'
import {
  Download,
  FolderPlus,
  GitBranchPlus,
  Kanban,
  Plus,
  Server,
  SquarePlus,
  Folders,
  TerminalSquare
} from 'lucide-react'
import { connectHost } from '@/daemon-connection'
import { LOCAL_HOST, setDashboardOpen, useStore, type HostId } from '@/session-store'
import { setBoardOpen, useSidebarStore } from '@/stores/sidebar-store'
import { SidebarFilterMenu } from '@/components/sidebar/SidebarFilterMenu'
import { WorkspaceOptionsMenu } from '@/components/sidebar/WorkspaceOptionsMenu'
import { openAddProjectDialog, setOrcaImportOpen } from '@/lib/project-dialogs'
import { SshConnectDialog } from '@/components/sidebar/SshConnectDialog'
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

// Orca's SidebarHeader / sidebar-header-actions / SidebarToolbar: title, then board, filter, options
// and add. Skills, Automations and the dashboard are SidebarNav rows, as in Orca.

export function SidebarHeader({ onNewGroup }: { onNewGroup: (hostId: HostId) => void }) {
  const groupBy = useStore((s) => s.sidebarView.groupBy)
  return (
    <div className="mt-2 flex h-8 min-w-0 items-center justify-between gap-1.5 px-2">
      <span className="min-w-0 truncate pr-0.5 pl-2 text-xs font-semibold text-muted-foreground/80 select-none">
        {groupBy === 'project' ? 'Projects' : 'Workspaces'}
      </span>
      <div className="flex shrink-0 items-center gap-0.5">
        <BoardButton />
        <SidebarFilterMenu />
        <WorkspaceOptionsMenu />
        <AddMenu onNewGroup={onNewGroup} />
      </div>
    </div>
  )
}

function BoardButton() {
  const open = useSidebarStore((s) => s.boardOpen)
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          size="icon-xs"
          variant="ghost"
          aria-label="Workspace board"
          aria-pressed={open}
          data-board-toggle
          className={cn('text-muted-foreground', open && 'bg-primary/15 text-primary hover:bg-primary/20')}
          onClick={() => {
            if (!open) setDashboardOpen(false)
            setBoardOpen(!open)
          }}
        >
          <Kanban className="size-3.5" strokeWidth={2.25} />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">Workspace board</TooltipContent>
    </Tooltip>
  )
}

function AddMenu({ onNewGroup }: { onNewGroup: (hostId: HostId) => void }) {
  const [distros, setDistros] = useState<string[] | null>(null)
  const [sshOpen, setSshOpen] = useState(false)
  const hosts = useStore((s) => s.hosts)

  return (
    <>
    <DropdownMenu
      onOpenChange={(o) => {
        if (o && distros === null && isTauri()) void invoke<string[]>('wsl_distros').then(setDistros, () => setDistros([]))
      }}
    >
      <DropdownMenuTrigger asChild>
        <Button size="icon-xs" variant="ghost" aria-label="Add" className="text-muted-foreground">
          <Plus className="size-3.5" strokeWidth={2.25} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuItem data-add="project" onSelect={() => openAddProjectDialog()}>
          <FolderPlus className="size-4" />
          Add project…
        </DropdownMenuItem>
        <DropdownMenuItem data-add="clone" onSelect={() => openAddProjectDialog({ step: 'clone' })}>
          <GitBranchPlus className="size-4" />
          Clone from URL…
        </DropdownMenuItem>
        <DropdownMenuItem data-add="create-repo" onSelect={() => openAddProjectDialog({ step: 'create' })}>
          <SquarePlus className="size-4" />
          Create new project…
        </DropdownMenuItem>
        <DropdownMenuItem data-add="orca-import" onSelect={() => setOrcaImportOpen(true)}>
          <Download className="size-4" />
          Import from Orca…
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem data-add="group" onSelect={() => onNewGroup(LOCAL_HOST)}>
          <Folders className="size-4" />
          New project group…
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem data-add="ssh" onSelect={() => setSshOpen(true)}>
          <TerminalSquare className="size-4" />
          Connect SSH host…
        </DropdownMenuItem>
        {distros && distros.length > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-xs text-muted-foreground">Connect WSL</DropdownMenuLabel>
            {distros.map((distro) => {
              const hostId = `wsl:${distro}`
              return (
                <DropdownMenuItem
                  key={distro}
                  data-add={`wsl:${distro}`}
                  disabled={hosts[hostId]?.connection.kind === 'connected'}
                  onSelect={() => void connectHost(hostId)}
                >
                  <Server className="size-4" />
                  {distro}
                </DropdownMenuItem>
              )
            })}
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
    <SshConnectDialog open={sshOpen} onClose={() => setSshOpen(false)} />
    </>
  )
}
