import { useState } from 'react'
import { invoke, isTauri } from '@tauri-apps/api/core'
import { open } from '@tauri-apps/plugin-dialog'
import {
  BookOpen,
  Download,
  FolderInput,
  FolderPlus,
  GitBranchPlus,
  Kanban,
  LayoutDashboard,
  Plus,
  Server,
  SquarePlus,
  Folders,
  TerminalSquare
} from 'lucide-react'
import { addProject, connectHost } from '@/daemon-connection'
import { LOCAL_HOST, setDashboardOpen, useStore, type HostId } from '@/session-store'
import { setBoardOpen, useSidebarStore } from '@/stores/sidebar-store'
import { setSkillsPageOpen, useAppOverlays } from '@/stores/app-overlay-store'
import { useSetting } from '@/stores/settings-store'
import { SidebarFilterMenu } from '@/components/sidebar/SidebarFilterMenu'
import { WorkspaceOptionsMenu } from '@/components/sidebar/WorkspaceOptionsMenu'
import type { AddRepoMode } from '@/components/sidebar/AddRepoDialog'
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

// Orca's SidebarHeader / sidebar-header-actions / SidebarToolbar: title, then board, dashboard,
// filter, options and add.

const isMac = navigator.userAgent.includes('Mac')

export function SidebarHeader({
  onImportOrca,
  onAddRepo,
  onNewGroup
}: {
  onImportOrca: () => void
  onAddRepo: (mode: AddRepoMode) => void
  onNewGroup: (hostId: HostId) => void
}) {
  const groupBy = useStore((s) => s.sidebarView.groupBy)
  return (
    <div className="mt-2 flex h-8 min-w-0 items-center justify-between gap-1.5 px-2">
      <span className="min-w-0 truncate pr-0.5 pl-2 text-xs font-semibold text-muted-foreground/80 select-none">
        {groupBy === 'project' ? 'Projects' : 'Workspaces'}
      </span>
      <div className="flex shrink-0 items-center gap-0.5">
        <SkillsButton />
        <BoardButton />
        <DashboardButton />
        <SidebarFilterMenu />
        <WorkspaceOptionsMenu />
        <AddMenu onImportOrca={onImportOrca} onAddRepo={onAddRepo} onNewGroup={onNewGroup} />
      </div>
    </div>
  )
}

/** Orca's opt-in sidebar Skills entry (showSkillsButton). */
function SkillsButton() {
  const shown = useSetting('showSkillsButton')
  const open = useAppOverlays((s) => s.skills)
  if (!shown) return null
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          size="icon-xs"
          variant="ghost"
          aria-label="Skills"
          aria-pressed={open}
          className={cn('text-muted-foreground', open && 'bg-accent text-accent-foreground')}
          onClick={() => setSkillsPageOpen(!open)}
        >
          <BookOpen className="size-3.5" />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">Skills</TooltipContent>
    </Tooltip>
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

function DashboardButton() {
  const open = useStore((s) => s.dashboardOpen)
  const attention = useStore((s) => s.sessions.filter((x) => x.status === 'needs-you' || s.unread[x.id]).length)
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          size="icon-xs"
          variant="ghost"
          aria-label="Agent dashboard"
          className={cn('relative text-muted-foreground', open && 'bg-accent text-accent-foreground')}
          onClick={() => {
            if (!open) setBoardOpen(false)
            setDashboardOpen(!open)
          }}
        >
          <LayoutDashboard className="size-3.5" />
          {attention > 0 && <span className="absolute top-0.5 right-0.5 size-1.5 rounded-full bg-agent-question" />}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">Agent dashboard ({isMac ? '⌘⇧D' : 'Ctrl+Shift+D'})</TooltipContent>
    </Tooltip>
  )
}

function AddMenu({
  onImportOrca,
  onAddRepo,
  onNewGroup
}: {
  onImportOrca: () => void
  onAddRepo: (mode: AddRepoMode) => void
  onNewGroup: (hostId: HostId) => void
}) {
  const [distros, setDistros] = useState<string[] | null>(null)
  const [sshOpen, setSshOpen] = useState(false)
  const hosts = useStore((s) => s.hosts)
  const remoteConnected = Object.values(hosts).some((h) => h.id !== LOCAL_HOST && h.connection.kind === 'connected')

  async function pickFolder() {
    const folder = await open({ directory: true, title: 'Add a project folder or git repository' })
    if (typeof folder === 'string') await addProject(folder)
  }

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
        <DropdownMenuItem data-add="project" onSelect={() => void pickFolder()}>
          <FolderPlus className="size-4" />
          Add project…
        </DropdownMenuItem>
        {remoteConnected && (
          <DropdownMenuItem data-add="path" onSelect={() => onAddRepo('path')}>
            <FolderInput className="size-4" />
            Add project on host…
          </DropdownMenuItem>
        )}
        <DropdownMenuItem data-add="clone" onSelect={() => onAddRepo('clone')}>
          <GitBranchPlus className="size-4" />
          Clone repository…
        </DropdownMenuItem>
        <DropdownMenuItem data-add="create-repo" onSelect={() => onAddRepo('create')}>
          <SquarePlus className="size-4" />
          Create new repository…
        </DropdownMenuItem>
        <DropdownMenuItem data-add="orca-import" onSelect={onImportOrca}>
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
