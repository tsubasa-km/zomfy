import { useEffect, useMemo, useState } from 'react'
import { FolderGit2, Folder, Settings2 } from 'lucide-react'
import { HARNESS_METHODS, type ProjectHookInfo } from '@acp-harness/protocol'
import { harnessRequest } from '@/daemon-connection'
import { allProjects, allWorkspaces, useStore, type HostedProject } from '@/session-store'
import { catalogEntryOf, useProjectCatalog } from '@/stores/project-catalog-store'
import { sidebarActions } from '@/components/sidebar/ProjectActionsMenu'
import { projectLabel, workspaceLabel } from '@/components/sidebar/workspace-visibility'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { t } from '@/i18n/i18n'

// The Project tab: what is known about the project the workspace in front belongs to (where it
// lives, this workspace's branch, how worktrees start and finish, what its agents may do on their
// own), with a way into its settings. Read-only: the settings dialog changes it.

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-1.5 border-b border-border px-3 py-3">
      <h3 className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">{title}</h3>
      <dl className="grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)] gap-x-3 gap-y-1">{children}</dl>
    </section>
  )
}

function Row({ label, value, mono, muted }: { label: string; value: React.ReactNode; mono?: boolean; muted?: boolean }) {
  return (
    <>
      <dt className="truncate text-muted-foreground">{label}</dt>
      <dd className={cn('min-w-0 break-all', mono && 'font-mono text-[11px]', muted && 'text-muted-foreground')}>{value}</dd>
    </>
  )
}

/** A script's first line, and how many more follow. */
function scriptSummary(script: string | undefined): string | null {
  const lines = script?.split('\n').filter((l) => l.trim()) ?? []
  if (lines.length === 0) return null
  return lines.length === 1 ? lines[0]! : t('{first} (+{n} more)', { first: lines[0], n: lines.length - 1 })
}

export function ProjectPanel({ workspaceId }: { workspaceId: string }) {
  // allWorkspaces and allProjects build new objects on every call: pick from the hosts, which only change with state.
  const hosts = useStore((s) => s.hosts)
  const sessions = useStore((s) => s.sessions)
  const catalog = useProjectCatalog()
  const workspace = useMemo(() => allWorkspaces({ hosts }).find((w) => w.id === workspaceId) ?? null, [hosts, workspaceId])
  const project: HostedProject | null = useMemo(
    () => (workspace?.projectId ? (allProjects(hosts).find((p) => p.hostId === workspace.hostId && p.id === workspace.projectId) ?? null) : null),
    [hosts, workspace]
  )
  const [hooks, setHooks] = useState<ProjectHookInfo | null>(null)

  const projectKey = project ? `${project.hostId}:${project.id}:${project.hooks?.setup ?? ''}:${project.hooks?.archive ?? ''}` : null
  useEffect(() => {
    setHooks(null)
    if (!project || project.kind !== 'git') return
    let live = true
    void harnessRequest(HARNESS_METHODS.projectHooks, { projectId: project.id }, project.hostId).then(
      (info) => live && setHooks(info),
      () => undefined
    )
    return () => {
      live = false
    }
    // Refetched when the project or its own scripts change, not on every state broadcast.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectKey])

  if (!workspace || !project) {
    return <p className="p-4 text-xs text-muted-foreground">{t("This thread's folder belongs to no project.")}</p>
  }

  const isGit = project.kind === 'git'
  const projectWorkspaces = allWorkspaces({ hosts }).filter((w) => w.hostId === project.hostId && w.projectId === project.id)
  const workspaceIds = new Set(projectWorkspaces.map((w) => w.id))
  const threads = sessions.filter((s) => s.hostId === project.hostId && workspaceIds.has(s.workspaceId) && s.role !== 'manager').length
  const otherHosts = catalogEntryOf({ hostId: project.hostId, projectId: project.id }, catalog)
    .locations.filter((l) => l.hostId !== project.hostId || l.projectId !== project.id)
    .map((l) => hosts[l.hostId]?.label ?? l.hostId)
  const setup = [scriptSummary(hooks?.fileHooks.setup), scriptSummary(project.hooks?.setup)].filter(Boolean).join(' · ')
  const archive = [scriptSummary(hooks?.fileHooks.archive), scriptSummary(project.hooks?.archive)].filter(Boolean).join(' · ')
  const actions = sidebarActions()
  const onOff = (on: boolean) => (on ? t('Allowed') : t('Turned off'))

  return (
    // Room at the bottom for the window's floating layout button.
    <div className="min-h-0 flex-1 overflow-y-auto pb-14 text-xs" data-project-panel>
      <div className="flex items-center gap-2 border-b border-border px-3 py-2.5">
        {isGit ? <FolderGit2 className="size-4 shrink-0 text-muted-foreground" /> : <Folder className="size-4 shrink-0 text-muted-foreground" />}
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium" data-project-panel-name>
            {projectLabel(project)}
          </div>
          <div className="truncate text-[11px] text-muted-foreground">
            {isGit ? t('Git repository') : t('Folder')} · {hosts[project.hostId]?.label ?? project.hostId}
          </div>
        </div>
        {actions && (
          <Button variant="outline" size="sm" className="h-7 gap-1 px-2 text-[11px]" onClick={() => actions.projectSettings(project)} data-project-panel-settings>
            <Settings2 className="size-3.5" />
            {t('Settings')}
          </Button>
        )}
      </div>

      <Section title={t('Project')}>
        <Row label={t('Path')} value={project.path} mono />
        <Row label={t('Host')} value={hosts[project.hostId]?.label ?? project.hostId} />
        {otherHosts.length > 0 && <Row label={t('Also on')} value={otherHosts.join(', ')} />}
        <Row label={t('Workspaces')} value={String(projectWorkspaces.length)} />
        <Row label={t('Threads')} value={String(threads)} />
      </Section>

      <Section title={t('This workspace')}>
        <Row label={t('Name')} value={workspaceLabel(workspace)} />
        <Row label={t('Kind')} value={workspace.isPrimary ? t('Main checkout') : t('Worktree')} />
        {isGit && <Row label={t('Branch')} value={workspace.branch ?? t('Detached HEAD')} mono={!!workspace.branch} muted={!workspace.branch} />}
        {!workspace.isPrimary && <Row label={t('Path')} value={workspace.path} mono />}
      </Section>

      {isGit && (
        <Section title={t('Worktrees')}>
          <Row label={t('Base branch')} value={project.defaultBaseRef ?? t('Automatic')} mono={!!project.defaultBaseRef} muted={!project.defaultBaseRef} />
          <Row
            label={t('When done')}
            value={(project.finishWith ?? 'merge') === 'pull-request' ? t('Open a pull request') : t('Merge into the main checkout')}
          />
          <Row label={t('Location')} value={project.worktreeRoot ?? t('Default')} mono={!!project.worktreeRoot} muted={!project.worktreeRoot} />
          <Row label={t('Setup script')} value={setup || t('None')} mono={!!setup} muted={!setup} />
          <Row label={t('Archive script')} value={archive || t('None')} mono={!!archive} muted={!archive} />
          {hooks?.file && <Row label={t('Scripts file')} value={hooks.file} mono />}
        </Section>
      )}

      <Section title={t('Agents on their own')}>
        <Row label={t('Workflows')} value={onOff(project.agentWorkflows !== false)} muted={project.agentWorkflows === false} />
        {isGit && <Row label={t('Split work')} value={onOff(project.agentSplitWork !== false)} muted={project.agentSplitWork === false} />}
      </Section>
    </div>
  )
}
