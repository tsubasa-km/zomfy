import type React from 'react'
import { LoaderCircle, MessageSquare, Monitor, RotateCw, Server, TriangleAlert, Unplug } from 'lucide-react'
import { HARNESS_METHODS, type ProjectGroup, type Workspace } from '@acp-harness/protocol'
import { connectHost, disconnectHost, harnessRequest } from '@/daemon-connection'
import { LOCAL_HOST, findWorkspace, setSidebarView, useStore, type HostEntry, type HostedProject } from '@/session-store'
import { useSidebarStore, type SidebarFilters } from '@/stores/sidebar-store'
import { ProjectSection, type SidebarActions } from '@/components/sidebar/ProjectSection'
import { WorkspaceCard, type WorkspaceDropHandlers } from '@/components/sidebar/WorkspaceCard'
import { WorkspaceStatusIcon } from '@/components/sidebar/WorkspaceStatusIcon'
import { GroupHeader } from '@/components/sidebar/GroupHeader'
import { updateWorkspace } from '@/components/sidebar/WorkspaceMenu'
import { useSidebarDropTarget } from '@/components/sidebar/sidebar-drag'
import {
  projectLabel,
  reorderIds,
  sortGroups,
  sortProjects,
  sortWorkspaces,
  workspaceMatches
} from '@/components/sidebar/workspace-visibility'
import { Button } from '@/components/ui/button'
import { hostConnectionLabel, hostDotClass } from '@/components/settings/HostsPane'
import { cn } from '@/lib/utils'
import { claudeCliWarning, updateClaudeCliOn, useClaudeCliStatus, useClaudeCliUpdating } from '@/stores/claude-cli-store'

const STATUS_GROUPS = [
  { id: 'in-progress', label: 'In progress' },
  { id: 'in-review', label: 'In review' },
  { id: 'todo', label: 'Todo' },
  { id: 'completed', label: 'Done' },
  { id: 'none', label: 'No status' }
] as const

export function hasActiveFilters(f: SidebarFilters): boolean {
  return (
    f.query.trim() !== '' ||
    f.statuses.length > 0 ||
    f.agentRunning ||
    f.needsYou ||
    f.unread ||
    f.hidePrimary ||
    f.hostIds.length > 0 ||
    f.projectIds.length > 0
  )
}

/** Workspaces of one host that pass the sidebar filters. */
export function useVisibleWorkspaces(host: HostEntry): Workspace[] {
  const filters = useSidebarStore((s) => s.filters)
  const sessions = useStore((s) => s.sessions)
  const unread = useStore((s) => s.unread)
  const projects = host.harness?.projects ?? []
  const name = (id: string | null) => {
    const p = projects.find((x) => x.id === id)
    return p ? projectLabel(p) : ''
  }
  return (host.harness?.workspaces ?? []).filter(
    (w) => w.projectId !== null && workspaceMatches(w, filters, { hostId: host.id, sessions, unread, projectName: name })
  )
}

export function HostSection({
  host,
  showHeader,
  actions
}: {
  host: HostEntry
  showHeader: boolean
  actions: SidebarActions
}) {
  const view = useStore((s) => s.sidebarView)
  const sessions = useStore((s) => s.sessions)
  const activeWorkspaceId = useStore((s) => s.activeWorkspaceId)
  const filters = useSidebarStore((s) => s.filters)
  const filtering = hasActiveFilters(filters)
  const projects = sortProjects(host.harness?.projects ?? [])
  const groups = sortGroups(host.harness?.projectGroups ?? [])
  const visible = useVisibleWorkspaces(host)
  // Quick chats (components/QuickStart) sit above the projects until their agent files them under one.
  const quickChats = filtering ? [] : (host.harness?.workspaces ?? []).filter((w) => w.scratch)
  const kind = host.connection.kind
  const hosted = (p: (typeof projects)[number]): HostedProject => ({ ...p, hostId: host.id })

  // Filters hide projects left with nothing to show (Orca's empty-project rows), but never when unfiltered.
  const projectVisible = (projectId: string) =>
    !filtering || (visible.some((w) => w.projectId === projectId) && (filters.projectIds.length === 0 || filters.projectIds.includes(projectId)))

  const projectDrop = (projectId: string, groupId: string | undefined) => (item: { id: string }, position: 'before' | 'after') => {
    const order = reorderIds(projects.map((p) => p.id), item.id, projectId, position)
    const dragged = projects.find((p) => p.id === item.id)
    if (dragged && dragged.groupId !== groupId) {
      void harnessRequest(HARNESS_METHODS.projectUpdate, { projectId: item.id, patch: { groupId: groupId ?? null } }, host.id)
    }
    if (order) void harnessRequest(HARNESS_METHODS.projectsReorder, { projectIds: order }, host.id)
  }

  const renderProject = (project: (typeof projects)[number]) =>
    projectVisible(project.id) ? (
      <ProjectSection
        key={project.id}
        project={hosted(project)}
        groups={groups}
        workspaces={visible.filter((w) => w.projectId === project.id)}
        sessions={sessions}
        activeWorkspaceId={activeWorkspaceId}
        actions={actions}
        onProjectDrop={projectDrop(project.id, project.groupId)}
      />
    ) : null

  return (
    <div className="mb-1" data-host-id={host.id}>
      {showHeader && <HostHeader host={host} />}
      {host.notice && kind === 'connected' && (
        <p className="mx-2 mt-1 mb-2 rounded-lg border border-border bg-card p-2 text-xs text-muted-foreground">{host.notice}</p>
      )}
      {kind === 'connecting' && !host.harness && (
        <p className="px-3 py-1 text-xs text-muted-foreground">Starting the daemon on {host.label}…</p>
      )}
      {host.connection.kind === 'offline' && (
        <div className="mx-2 mt-1 mb-2 space-y-2 rounded-lg border border-border bg-card p-3 text-xs">
          <p className="break-words text-foreground">{hostConnectionLabel(host)}</p>
          <Button size="sm" variant="outline" onClick={() => void connectHost(host.id)}>
            <RotateCw className="size-3.5" />
            Retry
          </Button>
        </div>
      )}
      {quickChats.length > 0 && (
        <section className="mb-2" data-quick-chats>
          <div className="flex h-7 min-w-0 items-center gap-1 pt-1 pr-1 pl-4 select-none">
            <MessageSquare className="size-3.5 shrink-0 text-muted-foreground" />
            <div className="min-w-0 truncate pl-0.5 text-[13px] leading-none font-semibold">Quick chats</div>
            <span className="text-[11px] text-muted-foreground tabular-nums">{quickChats.length}</span>
          </div>
          {quickChats.map((w) => (
            <WorkspaceCard
              key={w.id}
              workspace={w}
              hostId={host.id}
              sessions={sessions.filter((s) => s.workspaceId === w.id)}
              active={w.id === activeWorkspaceId}
              onUpdate={() => actions.update(w)}
              onDelete={() => actions.remove(w)}
            />
          ))}
        </section>
      )}
      {view.groupBy === 'project' ? (
        <>
          {groups.map((group) => {
            const members = projects.filter((p) => p.groupId === group.id)
            if (filtering && !members.some((p) => projectVisible(p.id))) return null
            return (
              <ProjectGroupSection
                key={group.id}
                group={group}
                count={members.length}
                hostId={host.id}
                actions={actions}
                onDropProject={(projectId) => {
                  void harnessRequest(HARNESS_METHODS.projectUpdate, { projectId, patch: { groupId: group.id } }, host.id)
                }}
              >
                {members.map(renderProject)}
              </ProjectGroupSection>
            )
          })}
          {projects.filter((p) => !p.groupId || !groups.some((g) => g.id === p.groupId)).map(renderProject)}
        </>
      ) : (
        STATUS_GROUPS.map((group) => {
          const list = sortWorkspaces(
            visible.filter((w) => (w.status ?? 'none') === group.id),
            view,
            sessions
          )
          if (list.length === 0) return null
          const status = group.id === 'none' ? undefined : group.id
          const accept: WorkspaceDropHandlers['accept'] = (item) =>
            item.kind === 'workspace' && item.hostId === host.id && 'order'
          const projectName = (id: string | null) => {
            const p = projects.find((x) => x.id === id)
            return p ? projectLabel(p) : undefined
          }
          return (
            <section key={group.id} className="mb-2" data-status-group={group.id}>
              <StatusGroupHeader
                id={group.id}
                hostId={host.id}
                onDrop={(workspaceId) => void updateWorkspace(workspaceId, { status: status ?? null })}
              >
                <WorkspaceStatusIcon status={status} />
                <div className="min-w-0 truncate text-[13px] leading-none font-semibold">{group.label}</div>
                <span className="text-[11px] text-muted-foreground tabular-nums">{list.length}</span>
              </StatusGroupHeader>
              {list.map((w) => (
                <WorkspaceCard
                  key={w.id}
                  workspace={w}
                  hostId={host.id}
                  projectName={projectName(w.projectId)}
                  sessions={sessions.filter((s) => s.workspaceId === w.id)}
                  active={w.id === activeWorkspaceId}
                  drop={{ accept, onDrop: (item, position) => moveToStatus(item.id, status, list, w.id, position) }}
                  onUpdate={() => actions.update(w)}
                  onDelete={() => actions.remove(w)}
                />
              ))}
            </section>
          )
        })
      )}
      {kind === 'connected' && projects.length === 0 && (
        <p className="px-3 pt-3 text-center text-xs text-muted-foreground">
          No projects yet. Use + to add a folder or import from Orca.
        </p>
      )}
    </div>
  )
}

/** A drop in a status group sets that status and the manual order there (Orca's status lanes). */
/** A status group's header: workspaces dropped on it take that status. */
function StatusGroupHeader({
  id,
  hostId,
  onDrop,
  children
}: {
  id: string
  hostId: string
  onDrop: (workspaceId: string) => void
  children: React.ReactNode
}) {
  const dropRef = useSidebarDropTarget(
    `status:${id}`,
    (item) => (item.kind === 'workspace' && item.hostId === hostId ? 'inside' : false),
    (item) => onDrop(item.id)
  )
  return (
    <div ref={dropRef} className="flex h-7 min-w-0 items-center gap-1.5 pt-1 pr-1 pl-2">
      {children}
    </div>
  )
}

function moveToStatus(
  workspaceId: string,
  status: Workspace['status'],
  list: Workspace[],
  targetId: string,
  position: 'before' | 'after' | 'inside'
): void {
  if (findWorkspace(workspaceId)?.status !== status) void updateWorkspace(workspaceId, { status: status ?? null })
  if (position === 'inside') return
  const order = reorderIds(list.map((w) => w.id), workspaceId, targetId, position)
  if (!order) return
  void harnessRequest(HARNESS_METHODS.workspacesReorder, { workspaceIds: order })
  setSidebarView({ sortBy: 'manual' })
}

function ClaudeCliWarning({ hostId }: { hostId: string }) {
  const status = useClaudeCliStatus(hostId)
  const busy = useClaudeCliUpdating(hostId)
  if (!status?.outdated) return null
  return (
    <button
      type="button"
      title={busy ? 'Updating Claude Code…' : `${claudeCliWarning(status)} Click to run \`claude update\`.`}
      aria-label="Update Claude Code"
      data-claude-cli-outdated
      disabled={busy}
      className="flex size-5 shrink-0 items-center justify-center rounded text-amber-500 hover:bg-accent"
      onClick={() => void updateClaudeCliOn(hostId)}
    >
      {busy ? <LoaderCircle className="size-3.5 animate-spin" /> : <TriangleAlert className="size-3.5" />}
    </button>
  )
}

function HostHeader({ host }: { host: HostEntry }) {
  const kind = host.connection.kind
  return (
    <div className="group/host flex h-7 items-center gap-1.5 pt-2 pr-1 pl-2 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
      {host.id === LOCAL_HOST ? <Monitor className="size-3.5" /> : <Server className="size-3.5" />}
      <span className="min-w-0 truncate">{host.label}</span>
      <span
        title={hostConnectionLabel(host)}
        data-host-dot={kind === 'offline' ? (host.connection.kind === 'offline' && host.connection.daemon) || 'offline' : kind}
        className={cn('block size-1.5 shrink-0 rounded-full', hostDotClass(host), kind === 'connecting' && 'animate-pulse')}
      />
      <ClaudeCliWarning hostId={host.id} />
      {host.id !== LOCAL_HOST && (
        <span className="ml-auto flex items-center opacity-0 group-hover/host:opacity-100 focus-within:opacity-100">
          {kind === 'offline' && (
            <button
              type="button"
              aria-label={`Reconnect ${host.label}`}
              className="flex size-5 items-center justify-center rounded text-muted-foreground hover:text-foreground"
              onClick={() => void connectHost(host.id)}
            >
              <RotateCw className="size-3.5" />
            </button>
          )}
          <button
            type="button"
            aria-label={`Disconnect ${host.label}`}
            className="flex size-5 items-center justify-center rounded text-muted-foreground hover:text-foreground"
            onClick={() => disconnectHost(host.id)}
          >
            <Unplug className="size-3.5" />
          </button>
        </span>
      )}
    </div>
  )
}

function ProjectGroupSection({
  group,
  count,
  hostId,
  actions,
  onDropProject,
  children
}: {
  group: ProjectGroup
  count: number
  hostId: string
  actions: SidebarActions
  onDropProject: (projectId: string) => void
  children: React.ReactNode
}) {
  return (
    <section className="mb-1" data-project-group-id={group.id}>
      <GroupHeader group={group} count={count} hostId={hostId} actions={actions} onDropProject={onDropProject} />
      {!group.collapsed && (
        <div className="ml-2 border-l border-worktree-sidebar-border/70 pl-0.5">{children}</div>
      )}
    </section>
  )
}
