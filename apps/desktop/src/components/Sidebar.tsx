import { useMemo, useState } from 'react'
import { HARNESS_METHODS, type Workspace } from '@acp-harness/protocol'
import { harnessRequest } from '@/daemon-connection'
import { LOCAL_HOST, useStore, type HostEntry, type HostedProject } from '@/session-store'
import { useSidebarStore } from '@/stores/sidebar-store'
import { DeleteWorkspaceDialog, UpdateWorkspaceDialog } from '@/components/workspace-dialogs'
import { OrcaImportDialog } from '@/components/OrcaImportDialog'
import { SidebarHeader } from '@/components/sidebar/SidebarHeader'
import { SidebarSearch } from '@/components/sidebar/SidebarSearch'
import { SessionRow } from '@/components/sidebar/SessionRow'
import { HostSection, hasActiveFilters } from '@/components/sidebar/HostSection'
import type { SidebarActions } from '@/components/sidebar/ProjectSection'
import { BulkActionBar } from '@/components/sidebar/BulkActionBar'
import { NewWorkspaceDialog, type NewWorkspaceRequest } from '@/components/sidebar/NewWorkspaceDialog'
import { ProjectSettingsDialog } from '@/components/sidebar/ProjectSettingsDialog'
import { AddRepoDialog, type AddRepoMode } from '@/components/sidebar/AddRepoDialog'
import { ProjectGroupNameDialog, type GroupNameRequest } from '@/components/sidebar/ProjectGroupNameDialog'
import { CleanupMergedDialog } from '@/components/sidebar/CleanupMergedDialog'
import { useWorkspaceSummaries } from '@/components/sidebar/use-workspace-summaries'
import { projectLabel, workspaceMatches } from '@/components/sidebar/workspace-visibility'

// Markup and classes follow Orca's sidebar (sidebar/index.tsx, SidebarHeader, WorktreeList); the
// sections, cards and dialogs live in components/sidebar/.

function orderHosts(hosts: Record<string, HostEntry>): HostEntry[] {
  return Object.values(hosts).sort((a, b) =>
    a.id === LOCAL_HOST ? -1 : b.id === LOCAL_HOST ? 1 : a.label.localeCompare(b.label)
  )
}

export function Sidebar() {
  const hosts = useStore((s) => s.hosts)
  const sessions = useStore((s) => s.sessions)
  const unread = useStore((s) => s.unread)
  const filters = useSidebarStore((s) => s.filters)
  const [newWorkspace, setNewWorkspace] = useState<NewWorkspaceRequest | null>(null)
  const [deleting, setDeleting] = useState<Workspace | null>(null)
  const [updating, setUpdating] = useState<Workspace | null>(null)
  const [importing, setImporting] = useState(false)
  const [settingsFor, setSettingsFor] = useState<HostedProject | null>(null)
  const [addRepo, setAddRepo] = useState<AddRepoMode | null>(null)
  const [groupName, setGroupName] = useState<GroupNameRequest | null>(null)
  const [cleanUp, setCleanUp] = useState<HostedProject | null>(null)
  useWorkspaceSummaries()

  const orderedHosts = orderHosts(hosts)
  const waiting = sessions.filter((s) => s.status === 'needs-you')

  // "n / total" for the search field, over every host's project workspaces.
  const counts = useMemo(() => {
    let total = 0
    let matched = 0
    for (const host of Object.values(hosts)) {
      const projects = host.harness?.projects ?? []
      const name = (id: string | null) => {
        const p = projects.find((x) => x.id === id)
        return p ? projectLabel(p) : ''
      }
      for (const w of host.harness?.workspaces ?? []) {
        if (w.projectId === null) continue
        total++
        if (workspaceMatches(w, filters, { hostId: host.id, sessions, unread, projectName: name })) matched++
      }
    }
    return { total, matched }
  }, [hosts, filters, sessions, unread])

  const actions: SidebarActions = {
    newWorkspace: (project, parent) => setNewWorkspace({ project, parent }),
    update: setUpdating,
    remove: setDeleting,
    projectSettings: setSettingsFor,
    newGroup: (hostId, projectIds) => setGroupName({ mode: 'create', hostId, projectIds }),
    renameGroup: (hostId, group) => setGroupName({ mode: 'rename', hostId, group }),
    cleanUp: setCleanUp,
    removeProject: (project) => {
      if (window.confirm(`Remove ${projectLabel(project)} from acp-harness? Its folders and worktrees on disk are kept.`)) {
        void harnessRequest(HARNESS_METHODS.projectRemove, { projectId: project.id }, project.hostId)
      }
    }
  }

  return (
    <aside className="relative flex min-h-0 w-[280px] flex-shrink-0 flex-col overflow-hidden border-r border-worktree-sidebar-border bg-worktree-sidebar text-worktree-sidebar-foreground">
      <SidebarHeader
        onImportOrca={() => setImporting(true)}
        onAddRepo={setAddRepo}
        onNewGroup={(hostId) => setGroupName({ mode: 'create', hostId })}
      />
      <SidebarSearch matchCount={counts.matched} totalCount={counts.total} />

      <div
        className="worktree-sidebar-scrollbar mt-1 min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-1 pb-3"
        data-workspace-list
      >
        {waiting.length > 0 && (
          <section className="mb-2">
            <div className="flex h-7 min-w-0 items-center gap-1.5 pt-1 pr-1 pl-2">
              <span className="block size-1.5 shrink-0 rounded-full bg-agent-question" />
              <div className="min-w-0 truncate text-[13px] leading-none font-semibold text-agent-question-text">
                Waiting for you
              </div>
              <span className="text-[11px] text-muted-foreground tabular-nums">{waiting.length}</span>
            </div>
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
            actions={actions}
          />
        ))}
        {hasActiveFilters(filters) && counts.matched === 0 && counts.total > 0 && (
          <p className="px-3 pt-3 text-center text-xs text-muted-foreground" data-no-matches>
            No workspaces match the filters.
          </p>
        )}
      </div>

      <BulkActionBar />

      <NewWorkspaceDialog request={newWorkspace} onClose={() => setNewWorkspace(null)} />
      <DeleteWorkspaceDialog workspace={deleting} onClose={() => setDeleting(null)} />
      <UpdateWorkspaceDialog workspace={updating} onClose={() => setUpdating(null)} />
      <OrcaImportDialog open={importing} onClose={() => setImporting(false)} />
      <ProjectSettingsDialog project={settingsFor} onClose={() => setSettingsFor(null)} />
      <AddRepoDialog mode={addRepo} onClose={() => setAddRepo(null)} />
      <ProjectGroupNameDialog request={groupName} onClose={() => setGroupName(null)} />
      <CleanupMergedDialog project={cleanUp} onClose={() => setCleanUp(null)} />
    </aside>
  )
}
