import { useEffect, useMemo, useState } from 'react'
import { FolderGit2, FolderOpen, FolderPlus, Folders, GitBranch, Plus, Search, SquarePen } from 'lucide-react'
import { allWorkspaces, openStartTab, selectWorkspace, showQuickStart, useStore, type HostedProject, type HostId } from '@/session-store'
import { setStartProject } from '@/stores/sidebar-store'
import { setProjectsPageOpen } from '@/stores/app-overlay-store'
import { useProjectCatalog } from '@/stores/project-catalog-store'
import { openAddProjectDialog, type AddProjectStep } from '@/lib/project-dialogs'
import { listedProjects } from '@/lib/catalog-projects'
import { defaultHostId } from '@/lib/default-host'
import { openWorkspaceIn } from '@/components/sidebar/WorkspaceMenu'
import { projectLabel } from '@/components/sidebar/workspace-visibility'
import { shortHostNames } from '@/components/sidebar/project-entries'
import { sortedHosts } from '@/components/settings/HostsPane'
import { PageCloseButton } from '@/components/PageCloseButton'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { projectKey } from './ProjectPicker'
import { t } from '@/i18n/i18n'

// Every project in one list, whatever hosts it lives on: each host it is on is a line of its own,
// with what it holds there and the way into it. The same page adds, clones and creates projects, so
// finding one and making one are in one place.

const COLUMN = 'w-full px-5 md:px-8'

export function ProjectsPage() {
  const hosts = useStore((s) => s.hosts)
  const catalog = useProjectCatalog()
  // allWorkspaces builds a new list each call: derived from hosts, not selected, so the store's snapshot stays stable.
  const workspaces = useMemo(() => allWorkspaces({ hosts }), [hosts])
  const [query, setQuery] = useState('')
  const close = () => setProjectsPageOpen(false)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !e.defaultPrevented && close()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const { projects, names } = useMemo(() => {
    const ordered = sortedHosts(hosts)
    return { projects: listedProjects(ordered, catalog), names: shortHostNames(ordered) }
  }, [hosts, catalog])
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return projects
    return projects.filter((p) => p.locations.some((l) => `${projectLabel(l)} ${l.path} ${names[l.hostId] ?? ''}`.toLowerCase().includes(q)))
  }, [projects, names, query])

  const connected = (hostId: HostId) => hosts[hostId]?.connection.kind === 'connected'
  const add = (step: AddProjectStep, hostId: HostId = defaultHostId()) => openAddProjectDialog({ hostId, step })
  const primaryOf = (p: HostedProject) => workspaces.find((w) => w.hostId === p.hostId && w.projectId === p.id && w.isPrimary)
  const open = (p: HostedProject) => {
    const primary = primaryOf(p)
    if (!primary) return
    close()
    selectWorkspace(primary.id)
  }
  const newThread = (p: HostedProject) => {
    close()
    setStartProject(projectKey(p))
    openStartTab()
    showQuickStart()
  }

  return (
    <main className="flex min-h-0 flex-1 flex-col bg-background" data-projects-page>
      <header className="shrink-0 border-b border-border">
        <div className={`${COLUMN} flex flex-wrap items-center gap-2 py-3`}>
          <PageCloseButton label={t('Close projects')} onClick={close} />
          <div className="mx-1 h-5 w-px bg-border/50" aria-hidden />
          <Folders className="size-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-sm font-semibold">{t('Projects')}</h1>
            <p className="text-xs text-muted-foreground">{t('{n} projects', { n: projects.length })}</p>
          </div>
          <Button type="button" size="sm" onClick={() => add('start')} data-projects-add>
            <FolderPlus className="size-3.5" />
            {t('Add a project…')}
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={() => add('clone')} data-projects-clone>
            <GitBranch className="size-3.5" />
            {t('Clone a repository…')}
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={() => add('create')} data-projects-create>
            <Plus className="size-3.5" />
            {t('Create a new project…')}
          </Button>
        </div>
        <div className={`${COLUMN} pb-3`}>
          <div className="relative max-w-md">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('Search projects...')} className="h-8 pl-8 text-sm" data-projects-search />
          </div>
        </div>
      </header>
      <div className="scrollbar-sleek min-h-0 flex-1 overflow-y-auto">
        <div className={`${COLUMN} py-5`}>
          {shown.length === 0 ? (
            <p className="text-sm text-muted-foreground">{query ? t('No projects match') : t('No projects yet. Add a folder, clone a repository or create one.')}</p>
          ) : (
            <ul className="divide-y divide-border/50 rounded-lg border border-border/60">
              {shown.map((project) => (
                <li key={project.id} className="px-3 py-2.5" data-project-row={project.id}>
                  <div className="flex items-center gap-2">
                    <FolderGit2 className="size-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">{projectLabel(project.locations[0]!)}</span>
                  </div>
                  {/* Where the project lives: a line per host, each its own way in. */}
                  <ul className="mt-1.5 space-y-1 pl-6">
                    {project.locations.map((l) => {
                      const online = connected(l.hostId)
                      const count = workspaces.filter((w) => w.hostId === l.hostId && w.projectId === l.id).length
                      return (
                        <li key={projectKey(l)} className="flex items-center gap-3" data-project-location={projectKey(l)}>
                          <span className="w-16 shrink-0 truncate text-[11px] font-medium text-muted-foreground">{names[l.hostId] ?? l.hostId}</span>
                          <button
                            type="button"
                            className="min-w-0 flex-1 truncate text-left font-mono text-[11px] text-muted-foreground enabled:hover:text-foreground"
                            onClick={() => open(l)}
                            disabled={!online || !primaryOf(l)}
                            title={l.path}
                          >
                            {l.path}
                          </button>
                          <span className="shrink-0 text-xs text-muted-foreground">
                            {!online ? t('Not connected') : l.kind === 'git' ? t('{n} worktrees', { n: count }) : t('Folder')}
                          </span>
                          <Button type="button" size="xs" variant="outline" onClick={() => newThread(l)} disabled={!online} data-project-new-thread>
                            <SquarePen className="size-3" />
                            {t('New thread')}
                          </Button>
                          <Button
                            type="button"
                            size="icon-xs"
                            variant="ghost"
                            aria-label={t('Reveal in File Explorer')}
                            title={t('Reveal in File Explorer')}
                            onClick={() => openWorkspaceIn('reveal', l.hostId, l.path)}
                            disabled={!online}
                          >
                            <FolderOpen className="size-3.5" />
                          </Button>
                        </li>
                      )
                    })}
                  </ul>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </main>
  )
}
