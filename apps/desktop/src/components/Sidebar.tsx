import { useState } from 'react'
import { open } from '@tauri-apps/plugin-dialog'
import { invoke } from '@tauri-apps/api/core'
import {
  Download,
  LayoutDashboard,
  FolderGit2,
  FolderOpen,
  FolderPlus,
  GitBranch,
  Monitor,
  MoreHorizontal,
  Pin,
  Plus,
  RotateCw,
  Server,
  SlidersHorizontal,
  Unplug
} from 'lucide-react'
import { HARNESS_METHODS, type Workspace, type WorkspaceStatusId } from '@acp-harness/protocol'
import { addProject, connectHost, disconnectHost, harnessRequest } from '@/daemon-connection'
import {
  LOCAL_HOST,
  allWorkspaces,
  selectSession,
  selectWorkspace,
  setDashboardOpen,
  useStore,
  workspaceStatus,
  setSidebarView,
  type HostEntry,
  type HostId,
  type HostedProject,
  type Session,
  type SidebarView
} from '@/session-store'
import StatusIndicator from '@/components/sidebar/StatusIndicator'
import { AgentStateDot, type AgentDotState } from '@/components/AgentStateDot'
import { ClaudeIcon } from '@/components/agent-icons'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { DeleteWorkspaceDialog, NewWorkspaceDialog, UpdateWorkspaceDialog } from '@/components/workspace-dialogs'
import { ProjectMenuItems, WorkspaceMenuItems } from '@/components/sidebar/WorkspaceMenu'
import { WorkspaceStatusIcon } from '@/components/sidebar/WorkspaceStatusIcon'
import { OrcaImportDialog } from '@/components/OrcaImportDialog'
import type { WorktreeStatus } from '@/lib/worktree-status'
import { cn } from '@/lib/utils'

// Markup and classes follow Orca's sidebar (sidebar/index.tsx, SidebarHeader, worktree-card-*,
// worktree-card-compact-agent-row, HostSectionHeader).

const CARD_STATUS: Record<ReturnType<typeof workspaceStatus>, WorktreeStatus> = {
  'needs-you': 'permission',
  working: 'working',
  error: 'failed',
  idle: 'done',
  none: 'inactive'
}

const SESSION_DOT: Record<Session['status'], AgentDotState> = {
  'needs-you': 'waiting',
  working: 'working',
  error: 'failed',
  idle: 'done'
}

export function Sidebar() {
  const hosts = useStore((s) => s.hosts)
  const sessions = useStore((s) => s.sessions)
  const activeWorkspaceId = useStore((s) => s.activeWorkspaceId)
  const [newWorkspaceFor, setNewWorkspaceFor] = useState<HostedProject | null>(null)
  const [deleting, setDeleting] = useState<Workspace | null>(null)
  const [updating, setUpdating] = useState<Workspace | null>(null)
  const [importing, setImporting] = useState(false)
  const waiting = sessions.filter((s) => s.status === 'needs-you')
  const orderedHosts = Object.values(hosts).sort((a, b) =>
    a.id === LOCAL_HOST ? -1 : b.id === LOCAL_HOST ? 1 : a.label.localeCompare(b.label)
  )

  return (
    <aside className="relative flex min-h-0 w-[280px] flex-shrink-0 flex-col overflow-hidden border-r border-worktree-sidebar-border bg-worktree-sidebar text-worktree-sidebar-foreground">
      <div className="mt-2 flex h-8 min-w-0 items-center justify-between gap-1.5 px-2">
        <span className="min-w-0 truncate pr-0.5 pl-2 text-xs font-semibold text-muted-foreground/80 select-none">
          Workspaces
        </span>
        <div className="flex items-center gap-0.5">
          <DashboardButton />
          <ViewOptionsMenu />
          <AddMenu onImportOrca={() => setImporting(true)} />
        </div>
      </div>

      <div className="worktree-sidebar-scrollbar mt-1 min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-1 pb-3">
        {waiting.length > 0 && (
          <section className="mb-2">
            <SectionHeader icon="attention" label="Waiting for you" count={waiting.length} />
            {waiting.map((s) => (
              <SessionRow key={`w-${s.id}`} session={s} showWorkspace />
            ))}
          </section>
        )}
        {orderedHosts.map((host) => (
          <HostSection
            key={host.id}
            host={host}
            showHeader={orderedHosts.length > 1 || host.connection.kind !== 'connected'}
            sessions={sessions}
            activeWorkspaceId={activeWorkspaceId}
            onNewWorkspace={setNewWorkspaceFor}
            onUpdate={setUpdating}
            onDelete={setDeleting}
          />
        ))}
      </div>

      <NewWorkspaceDialog project={newWorkspaceFor} onClose={() => setNewWorkspaceFor(null)} />
      <DeleteWorkspaceDialog workspace={deleting} onClose={() => setDeleting(null)} />
      <UpdateWorkspaceDialog workspace={updating} onClose={() => setUpdating(null)} />
      <OrcaImportDialog open={importing} onClose={() => setImporting(false)} />
    </aside>
  )
}

const STATUS_GROUPS: { id: WorkspaceStatusId | 'none'; label: string }[] = [
  { id: 'in-progress', label: 'In progress' },
  { id: 'in-review', label: 'In review' },
  { id: 'todo', label: 'Todo' },
  { id: 'completed', label: 'Done' },
  { id: 'none', label: 'No status' }
]

/** Pinned first (Orca's pin), then the project's own checkout, then the chosen order. */
function sortWorkspaces(list: Workspace[], view: SidebarView, sessions: Session[]): Workspace[] {
  const lastActivity = (w: Workspace) =>
    Math.max(w.createdAt, ...sessions.filter((s) => s.workspaceId === w.id).map((s) => s.turnStartedAt ?? s.createdAt))
  return [...list].sort((a, b) => {
    if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1
    if (view.groupBy === 'project' && a.isPrimary !== b.isPrimary) return a.isPrimary ? -1 : 1
    if (view.sortBy === 'name') return (a.displayName ?? a.name).localeCompare(b.displayName ?? b.name)
    if (view.sortBy === 'recent') return lastActivity(b) - lastActivity(a)
    return a.createdAt - b.createdAt
  })
}

function HostSection({
  host,
  showHeader,
  sessions,
  activeWorkspaceId,
  onNewWorkspace,
  onUpdate,
  onDelete
}: {
  host: HostEntry
  showHeader: boolean
  sessions: Session[]
  activeWorkspaceId: string | null
  onNewWorkspace: (project: HostedProject) => void
  onUpdate: (workspace: Workspace) => void
  onDelete: (workspace: Workspace) => void
}) {
  const view = useStore((s) => s.sidebarView)
  const projects = host.harness?.projects ?? []
  const workspaces = (host.harness?.workspaces ?? []).filter((w) => w.projectId !== null)
  const kind = host.connection.kind
  const projectName = (id: string | null) => projects.find((p) => p.id === id)?.name

  const card = (workspace: Workspace, showProject: boolean) => (
    <WorkspaceCard
      key={workspace.id}
      workspace={workspace}
      hostId={host.id}
      projectName={showProject ? projectName(workspace.projectId) : undefined}
      sessions={sessions.filter((s) => s.workspaceId === workspace.id)}
      active={workspace.id === activeWorkspaceId}
      onUpdate={() => onUpdate(workspace)}
      onDelete={() => onDelete(workspace)}
    />
  )

  return (
    <div className="mb-1" data-host-id={host.id}>
      {showHeader && (
        <div className="group/host flex h-7 items-center gap-1.5 pt-2 pr-1 pl-2 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
          {host.id === LOCAL_HOST ? <Monitor className="size-3.5" /> : <Server className="size-3.5" />}
          <span className="min-w-0 truncate">{host.label}</span>
          <span
            className={cn(
              'block size-1.5 shrink-0 rounded-full',
              kind === 'connected' && 'bg-emerald-500',
              kind === 'connecting' && 'animate-pulse bg-yellow-500',
              kind === 'offline' && 'bg-red-500'
            )}
          />
          {host.id !== LOCAL_HOST && (
            <button
              type="button"
              aria-label={`Disconnect ${host.label}`}
              className="ml-auto flex size-5 items-center justify-center rounded text-muted-foreground opacity-0 group-hover/host:opacity-100 hover:text-foreground"
              onClick={() => disconnectHost(host.id)}
            >
              <Unplug className="size-3.5" />
            </button>
          )}
        </div>
      )}
      {kind === 'connecting' && !host.harness && (
        <p className="px-3 py-1 text-xs text-muted-foreground">Starting the daemon on {host.label}…</p>
      )}
      {kind === 'offline' && host.connection.kind === 'offline' && (
        <div className="mx-2 mt-1 mb-2 space-y-2 rounded-lg border border-border bg-card p-3 text-xs">
          <p className="break-words text-foreground">{host.connection.reason}</p>
          <Button size="sm" variant="outline" onClick={() => void connectHost(host.id)}>
            <RotateCw className="size-3.5" />
            Retry
          </Button>
        </div>
      )}
      {view.groupBy === 'project'
        ? projects.map((project) => {
            const projectWorkspaces = sortWorkspaces(
              workspaces.filter((w) => w.projectId === project.id),
              view,
              sessions
            )
            const hosted = { ...project, hostId: host.id }
            return (
              <section key={project.id} className="group/project mb-2" data-project-id={project.id}>
                <SectionHeader
                  icon={project.kind === 'git' ? 'git' : 'folder'}
                  label={project.name}
                  title={project.path}
                  count={projectWorkspaces.length}
                  action={
                    <div className="flex items-center opacity-0 group-hover/project:opacity-100 has-[[data-state=open]]:opacity-100">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            size="icon-xs"
                            variant="ghost"
                            aria-label={`New workspace in ${project.name}`}
                            onClick={() => onNewWorkspace(hosted)}
                          >
                            <Plus className="size-3.5" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent side="right">New workspace…</TooltipContent>
                      </Tooltip>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button size="icon-xs" variant="ghost" aria-label={`Project actions for ${project.name}`}>
                            <MoreHorizontal className="size-3.5" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="start" className="w-56">
                          <ProjectMenuItems
                            hostId={host.id}
                            path={project.path}
                            onNewWorkspace={() => onNewWorkspace(hosted)}
                            onRemove={() => {
                              if (
                                window.confirm(
                                  `Remove ${project.name} from acp-harness? Its folders and worktrees on disk are kept.`
                                )
                              ) {
                                void harnessRequest(HARNESS_METHODS.projectRemove, { projectId: project.id }, host.id)
                              }
                            }}
                          />
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  }
                />
                {projectWorkspaces.map((w) => card(w, false))}
              </section>
            )
          })
        : STATUS_GROUPS.map((group) => {
            const list = sortWorkspaces(
              workspaces.filter((w) => (w.status ?? 'none') === group.id),
              view,
              sessions
            )
            if (list.length === 0) return null
            return (
              <section key={group.id} className="mb-2" data-status-group={group.id}>
                <div className="flex h-7 min-w-0 items-center gap-1.5 pt-1 pr-1 pl-2">
                  <WorkspaceStatusIcon status={group.id === 'none' ? undefined : group.id} />
                  <div className="min-w-0 truncate text-[13px] leading-none font-semibold">{group.label}</div>
                  <span className="text-[11px] text-muted-foreground tabular-nums">{list.length}</span>
                </div>
                {list.map((w) => card(w, true))}
              </section>
            )
          })}
      {kind === 'connected' && projects.length === 0 && (
        <p className="px-3 pt-3 text-center text-xs text-muted-foreground">
          No projects yet. Use + to add a folder or import from Orca.
        </p>
      )}
    </div>
  )
}

function SectionHeader({
  icon,
  label,
  title,
  count,
  action
}: {
  icon: 'git' | 'folder' | 'attention'
  label: string
  title?: string
  count: number
  action?: React.ReactNode
}) {
  return (
    <div className="flex h-7 min-w-0 items-center gap-1.5 pt-1 pr-1 pl-2" title={title}>
      {icon === 'attention' ? (
        <span className="block size-1.5 shrink-0 rounded-full bg-agent-question" />
      ) : icon === 'git' ? (
        <FolderGit2 className="size-3.5 shrink-0 text-muted-foreground" />
      ) : (
        <FolderOpen className="size-3.5 shrink-0 text-muted-foreground" />
      )}
      <div
        className={cn(
          'min-w-0 truncate text-[13px] leading-none font-semibold',
          icon === 'attention' && 'text-agent-question-text'
        )}
      >
        {label}
      </div>
      <span className="text-[11px] text-muted-foreground tabular-nums">{count}</span>
      <div className="ml-auto flex items-center">{action}</div>
    </div>
  )
}

function WorkspaceCard({
  workspace,
  hostId,
  projectName,
  sessions,
  active,
  onUpdate,
  onDelete
}: {
  workspace: Workspace
  hostId: HostId
  projectName?: string
  sessions: Session[]
  active: boolean
  onUpdate: () => void
  onDelete: () => void
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const sessionUnread = useStore((s) => sessions.some((x) => s.unread[x.id]))
  const unread = !!workspace.unread || sessionUnread
  const title = workspace.displayName ?? workspace.name

  return (
    <div
      className={cn(
        'group/card relative ml-1 flex cursor-pointer flex-col overflow-hidden rounded-lg border border-transparent pt-1.25 pr-1.5 pb-1.5 outline-none transition-[background-color,border-color,opacity,box-shadow] duration-200 select-none',
        !active && 'worktree-sidebar-card-hover'
      )}
      data-worktree-card-surface="true"
      data-worktree-card-active={active ? 'primary' : undefined}
      data-workspace-id={workspace.id}
      onClick={() => {
        selectWorkspace(workspace.id)
        if (workspace.unread) {
          void harnessRequest(HARNESS_METHODS.workspaceUpdate, { workspaceId: workspace.id, patch: { unread: false } }, hostId)
        }
      }}
      onContextMenu={(e) => {
        e.preventDefault()
        setMenuOpen(true)
      }}
      title={workspace.path}
    >
      <div className="flex min-w-0 items-center justify-between gap-2 pl-2">
        <div className="flex min-w-0 flex-1 items-center gap-1.5">
          <StatusIndicator status={CARD_STATUS[workspaceStatus(sessions)]} />
          <div className={cn('min-w-0 truncate text-[13px] leading-5', unread && 'font-semibold')}>{title}</div>
          {workspace.pinned && <Pin className="size-3 shrink-0 fill-amber-400 text-amber-400" aria-label="Pinned" />}
          {unread && <span className="size-1.5 shrink-0 rounded-full bg-agent-question" aria-label="Unread" />}
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          {workspace.status && <WorkspaceStatusIcon status={workspace.status} className="size-3" />}
          <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label={`Workspace actions for ${title}`}
                className={cn(
                  'flex size-5 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent/70 hover:text-foreground',
                  menuOpen ? 'opacity-100' : 'opacity-0 group-hover/card:opacity-100'
                )}
                onClick={(e) => e.stopPropagation()}
              >
                <MoreHorizontal className="size-3.5" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-56" onClick={(e) => e.stopPropagation()}>
              <WorkspaceMenuItems
                workspace={workspace}
                hostId={hostId}
                unread={unread}
                onUpdate={onUpdate}
                onDelete={onDelete}
              />
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      {(workspace.branch || projectName) && (
        <div className="mt-0.5 flex min-w-0 items-center gap-1 pl-[22px] text-[11px] text-muted-foreground">
          {projectName && <span className="shrink-0 truncate font-medium">{projectName}</span>}
          {projectName && workspace.branch && <span className="shrink-0">·</span>}
          {workspace.branch && (
            <>
              <GitBranch className="size-3 shrink-0" />
              <span className="truncate font-mono">{workspace.branch}</span>
            </>
          )}
        </div>
      )}
      {workspace.comment && (
        <div className="mt-0.5 line-clamp-2 pl-[22px] text-[11px] text-muted-foreground/90" data-workspace-comment>
          {workspace.comment}
        </div>
      )}
      {sessions.length > 0 && (
        <div className="mt-1 space-y-px">
          {sessions.map((s) => (
            <SessionRow key={s.id} session={s} />
          ))}
        </div>
      )}
    </div>
  )
}

function SessionRow({ session, showWorkspace }: { session: Session; showWorkspace?: boolean }) {
  const workspaceName = useStore((s) => allWorkspaces(s).find((w) => w.id === session.workspaceId)?.name ?? '')
  return (
    <div
      role="button"
      tabIndex={0}
      data-session-id={session.id}
      data-session-status={session.status}
      className="flex min-w-0 cursor-pointer items-center gap-1.5 rounded-md py-0.5 pr-1 pl-[22px] text-[12px] text-muted-foreground hover:bg-worktree-sidebar-accent/60 hover:text-foreground"
      onClick={(e) => {
        e.stopPropagation()
        selectSession(session.id)
      }}
    >
      <ClaudeIcon size={11} />
      <span className="min-w-0 flex-1 truncate">
        {showWorkspace ? `${workspaceName} · ` : ''}
        {session.title}
      </span>
      <AgentStateDot state={SESSION_DOT[session.status]} size="sm" />
    </div>
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
          className={cn('relative', open && 'bg-accent text-accent-foreground')}
          onClick={() => setDashboardOpen(!open)}
        >
          <LayoutDashboard className="size-3.5" />
          {attention > 0 && (
            <span className="absolute top-0.5 right-0.5 size-1.5 rounded-full bg-agent-question" />
          )}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="right">Agent dashboard ({navigator.userAgent.includes('Mac') ? '⌘⇧D' : 'Ctrl+Shift+D'})</TooltipContent>
    </Tooltip>
  )
}

function AddMenu({ onImportOrca }: { onImportOrca: () => void }) {
  const [distros, setDistros] = useState<string[] | null>(null)
  const hosts = useStore((s) => s.hosts)

  async function pickFolder() {
    const folder = await open({ directory: true, title: 'Add a project folder or git repository' })
    if (typeof folder === 'string') await addProject(folder)
  }

  return (
    <DropdownMenu
      onOpenChange={(open) => {
        if (open && distros === null) void invoke<string[]>('wsl_distros').then(setDistros, () => setDistros([]))
      }}
    >
      <DropdownMenuTrigger asChild>
        <Button size="icon-xs" variant="ghost" aria-label="Add">
          <Plus className="size-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuItem data-add="project" onSelect={() => void pickFolder()}>
          <FolderPlus className="size-4" />
          Add project…
        </DropdownMenuItem>
        <DropdownMenuItem data-add="orca-import" onSelect={onImportOrca}>
          <Download className="size-4" />
          Import from Orca…
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
  )
}

/** Orca's "Workspace options": group by and sort by. */
function ViewOptionsMenu() {
  const view = useStore((s) => s.sidebarView)
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="icon-xs" variant="ghost" aria-label="Workspace options">
          <SlidersHorizontal className="size-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-52">
        <DropdownMenuLabel className="text-xs text-muted-foreground">Group by</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={view.groupBy}
          onValueChange={(v) => setSidebarView({ groupBy: v as SidebarView['groupBy'] })}
        >
          <DropdownMenuRadioItem value="project">Project</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="status">Status</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-xs text-muted-foreground">Sort by</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={view.sortBy}
          onValueChange={(v) => setSidebarView({ sortBy: v as SidebarView['sortBy'] })}
        >
          <DropdownMenuRadioItem value="created">Created</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="recent">Recent activity</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="name">Name</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
