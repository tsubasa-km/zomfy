import { useMemo } from 'react'
import type React from 'react'
import { MessageSquare } from 'lucide-react'
import { HARNESS_METHODS, type HarnessState, type ProjectGroup, type ProjectLink, type Workspace } from '@acp-harness/protocol'
import { harnessRequest } from '@/daemon-connection'
import { findWorkspace, setSidebarView, useStore, type HostEntry, type HostedProject, type HostId } from '@/session-store'
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
import { sortedHosts } from '@/components/settings/HostsPane'
import { hostSnapshot } from '@/lib/host-snapshots'
import { cn } from '@/lib/utils'
import { useProjectLinks } from '@/stores/project-links-store'
import { defaultHostId } from '@/lib/default-host'
import { useSetting } from '@/stores/settings-store'

// One list of projects across every host: where a project lives is its badge, not a section, so
// the person picks work rather than machines. Host controls live in the status bar (HostsMenu).

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

type HostedWorkspace = Workspace & { hostId: HostId }

interface Source {
  host: HostEntry
  harness: HarnessState
  /** Drawn from the last listing this window saw; the host is not connected now. */
  stale: boolean
}

/** Short host names: "WSL" (the distro when there are several), the SSH alias, "Windows". */
function shortHostNames(hosts: HostEntry[]): Record<HostId, string> {
  const wslCount = hosts.filter((h) => h.id.startsWith('wsl:')).length
  const short = (h: HostEntry) =>
    h.id.startsWith('wsl:') ? (wslCount > 1 ? h.id.slice(4) : 'WSL') : h.id.startsWith('ssh:') ? h.id.slice(4) : h.label
  return Object.fromEntries(hosts.map((h) => [h.id, short(h)]))
}

interface LinkedEntry {
  /** The link's main member present here (its first), or the project itself when unlinked. */
  primary: HostedProject
  copies: HostedProject[]
}

/** Projects in display order, each link folded into the place of its first member listed. */
function linkedEntries(projects: HostedProject[], links: ProjectLink[]): LinkedEntry[] {
  const key = (hostId: HostId, projectId: string) => `${hostId}:${projectId}`
  const byKey = new Map(projects.map((p) => [key(p.hostId, p.id), p]))
  const linkOfKey = new Map(links.flatMap((l) => l.members.map((m) => [key(m.hostId, m.projectId), l] as const)))
  const done = new Set<string>()
  const entries: LinkedEntry[] = []
  for (const project of projects) {
    const link = linkOfKey.get(key(project.hostId, project.id))
    if (!link) {
      entries.push({ primary: project, copies: [] })
      continue
    }
    if (done.has(link.id)) continue
    done.add(link.id)
    const present = link.members.flatMap((m) => byKey.get(key(m.hostId, m.projectId)) ?? [])
    entries.push({ primary: present[0]!, copies: present.slice(1) })
  }
  return entries
}

export function ProjectList({ actions }: { actions: SidebarActions }) {
  const hosts = useStore((s) => s.hosts)
  const view = useStore((s) => s.sidebarView)
  const allSessions = useStore((s) => s.sessions)
  // Archived chats leave the list unless the person asked to see them (Workspace options).
  const sessions = useMemo(
    () => (view.showArchived ? allSessions : allSessions.filter((s) => !s.archived)),
    [allSessions, view.showArchived]
  )
  const unread = useStore((s) => s.unread)
  const activeWorkspaceId = useStore((s) => s.activeWorkspaceId)
  const filters = useSidebarStore((s) => s.filters)
  const filtering = hasActiveFilters(filters)

  const ordered = sortedHosts(hosts)
  const sources: Source[] = ordered.flatMap((host) => {
    const live = host.connection.kind === 'connected' && host.harness
    const harness = host.harness ?? hostSnapshot(host.id)
    return harness ? [{ host, harness, stale: !live }] : []
  })
  useSetting('defaultHost')
  const defaultHost = defaultHostId()
  const names = shortHostNames(ordered)
  // The default host's projects, most of them, carry no badge.
  const badges: Record<HostId, string | null> = Object.fromEntries(ordered.map((h) => [h.id, h.id === defaultHost ? null : names[h.id]!]))
  const links = useProjectLinks()
  const stale = new Set(sources.filter((s) => s.stale).map((s) => s.host.id))
  const offline = new Set(sources.filter((s) => s.host.connection.kind === 'offline').map((s) => s.host.id))

  const projects: HostedProject[] = sources.flatMap((s) => sortProjects(s.harness.projects).map((p) => ({ ...p, hostId: s.host.id })))
  const nameOf = (id: string | null) => {
    const p = projects.find((x) => x.id === id)
    return p ? projectLabel(p) : ''
  }
  const visible: HostedWorkspace[] = sources.flatMap((s) =>
    s.harness.workspaces
      .filter((w) => w.projectId !== null)
      .filter((w) => workspaceMatches(w, filters, { hostId: s.host.id, sessions, unread, projectName: nameOf }))
      .map((w) => ({ ...w, hostId: s.host.id }))
  )
  // Quick chats (components/QuickStart) sit above the projects until their agent files them under one.
  const quickChats: HostedWorkspace[] = filtering
    ? []
    : sources.flatMap((s) => s.harness.workspaces.filter((w) => w.scratch).map((w) => ({ ...w, hostId: s.host.id })))
  const groups = sources.flatMap((s) => sortGroups(s.harness.projectGroups ?? []).map((group) => ({ group, hostId: s.host.id })))
  // A project linked across hosts lists once, under its main member.
  const entries = linkedEntries(projects, links)

  // Filters hide projects left with nothing to show (Orca's empty-project rows), but never when unfiltered.
  const projectVisible = (projectId: string) =>
    !filtering || (visible.some((w) => w.projectId === projectId) && (filters.projectIds.length === 0 || filters.projectIds.includes(projectId)))

  const projectDrop = (project: HostedProject) => (item: { id: string }, position: 'before' | 'after') => {
    // Order and groups are each host's own; ProjectSection only accepts drops from the same host.
    const siblings = projects.filter((p) => p.hostId === project.hostId)
    const order = reorderIds(siblings.map((p) => p.id), item.id, project.id, position)
    const dragged = siblings.find((p) => p.id === item.id)
    if (dragged && dragged.groupId !== project.groupId) {
      void harnessRequest(HARNESS_METHODS.projectUpdate, { projectId: item.id, patch: { groupId: project.groupId ?? null } }, project.hostId)
    }
    if (order) void harnessRequest(HARNESS_METHODS.projectsReorder, { projectIds: order }, project.hostId)
  }

  const badgeText = (hostId: HostId) => (badges[hostId] ? `${badges[hostId]}${offline.has(hostId) ? ' · offline' : ''}` : null)

  const renderProject = ({ primary: project, copies }: LinkedEntry) => {
    const members = [project, ...copies]
    if (!members.some((m) => projectVisible(m.id))) return null
    const allStale = members.every((m) => stale.has(m.hostId))
    // "+DGX": the project also has workspaces there.
    const hostBadge = [badgeText(project.hostId), ...copies.map((c) => `+${names[c.hostId] ?? c.hostId}`)].filter(Boolean).join(' ')
    return (
      <div key={project.id} className={cn(allStale && 'opacity-60')} data-host-stale={allStale || undefined}>
        <ProjectSection
          project={project}
          copies={copies}
          badgeFor={(hostId) => names[hostId] ?? hostId}
          groups={groups.filter((g) => g.hostId === project.hostId).map((g) => g.group)}
          workspaces={visible.filter((w) => members.some((m) => m.hostId === w.hostId && m.id === w.projectId))}
          sessions={sessions}
          activeWorkspaceId={activeWorkspaceId}
          actions={actions}
          onProjectDrop={projectDrop(project)}
          hostBadge={hostBadge || undefined}
        />
      </div>
    )
  }

  const loading = ordered.some((h) => h.connection.kind === 'connecting' && !h.harness && !hostSnapshot(h.id))

  return (
    <div data-project-list>
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
              hostId={w.hostId}
              projectName={badges[w.hostId] ?? undefined}
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
          {groups.map(({ group, hostId }) => {
            const members = entries.filter((e) => e.primary.hostId === hostId && e.primary.groupId === group.id)
            if (filtering && !members.some((e) => [e.primary, ...e.copies].some((p) => projectVisible(p.id)))) return null
            return (
              <ProjectGroupSection
                key={`${hostId}:${group.id}`}
                group={group}
                count={members.length}
                hostId={hostId}
                actions={actions}
                onDropProject={(projectId) => {
                  void harnessRequest(HARNESS_METHODS.projectUpdate, { projectId, patch: { groupId: group.id } }, hostId)
                }}
              >
                {members.map(renderProject)}
              </ProjectGroupSection>
            )
          })}
          {entries
            .filter(({ primary: p }) => !p.groupId || !groups.some((g) => g.hostId === p.hostId && g.group.id === p.groupId))
            .map(renderProject)}
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
          return (
            <section key={group.id} className="mb-2" data-status-group={group.id}>
              <StatusGroupHeader id={group.id} onDrop={(workspaceId) => void updateWorkspace(workspaceId, { status: status ?? null })}>
                <WorkspaceStatusIcon status={status} />
                <div className="min-w-0 truncate text-[13px] leading-none font-semibold">{group.label}</div>
                <span className="text-[11px] text-muted-foreground tabular-nums">{list.length}</span>
              </StatusGroupHeader>
              {list.map((w) => {
                const accept: WorkspaceDropHandlers['accept'] = (item) =>
                  item.kind === 'workspace' && item.hostId === w.hostId && 'order'
                const name = nameOf(w.projectId)
                const badge = badges[w.hostId]
                return (
                  <WorkspaceCard
                    key={w.id}
                    workspace={w}
                    hostId={w.hostId}
                    projectName={badge ? `${name} · ${badge}` : name}
                    sessions={sessions.filter((s) => s.workspaceId === w.id)}
                    active={w.id === activeWorkspaceId}
                    drop={{
                      accept,
                      onDrop: (item, position) =>
                        moveToStatus(item.id, status, list.filter((x) => x.hostId === w.hostId), w.id, position)
                    }}
                    onUpdate={() => actions.update(w)}
                    onDelete={() => actions.remove(w)}
                  />
                )
              })}
            </section>
          )
        })
      )}
      {projects.length === 0 && quickChats.length === 0 && (
        <p className="px-3 pt-3 text-center text-xs text-muted-foreground">
          {loading ? 'Connecting…' : 'No projects yet. Use + to add one, or start a chat with New chat.'}
        </p>
      )}
    </div>
  )
}

/** A status group's header: workspaces dropped on it take that status. */
function StatusGroupHeader({ id, onDrop, children }: { id: string; onDrop: (workspaceId: string) => void; children: React.ReactNode }) {
  const dropRef = useSidebarDropTarget(
    `status:${id}`,
    (item) => (item.kind === 'workspace' ? 'inside' : false),
    (item) => onDrop(item.id)
  )
  return (
    <div ref={dropRef} className="flex h-7 min-w-0 items-center gap-1.5 pt-1 pr-1 pl-2">
      {children}
    </div>
  )
}

/** A drop in a status group sets that status and the manual order there (Orca's status lanes). */
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
      {!group.collapsed && <div className="ml-2 border-l border-worktree-sidebar-border/70 pl-0.5">{children}</div>}
    </section>
  )
}
