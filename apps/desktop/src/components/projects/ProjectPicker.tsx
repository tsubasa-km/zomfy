import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, ChevronsUpDown, Folder, FolderPlus, GitBranch, Plus } from 'lucide-react'
import { useStore, type HostedProject, type HostId } from '@/session-store'
import { openAddProjectDialog, type AddProjectStep } from '@/lib/project-dialogs'
import { projectLabel } from '@/components/sidebar/workspace-visibility'
import { sortedHosts } from '@/components/settings/HostsPane'
import { shortHostNames } from '@/components/sidebar/project-entries'
import { listedProjects, type ListedProject } from '@/lib/catalog-projects'
import { useProjectCatalog } from '@/stores/project-catalog-store'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator } from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import { t } from '@/i18n/i18n'

// Where a thread starts, chosen and created in one place: every project on a connected host, then
// adding a folder, cloning a repository or creating a project. A project is one row whatever hosts
// it lives on; the picked one's hosts show beside it to choose from. A project added from here is
// picked once it appears.

export const projectKey = (p: Pick<HostedProject, 'hostId' | 'id'>) => `${p.hostId}:${p.id}`

export function ProjectPicker({
  value,
  onChange,
  hostId,
  allowNone = true,
  className
}: {
  /** The picked project's key (projectKey), or null for none. */
  value: string | null
  onChange: (key: string | null) => void
  /** The host new projects are added to unless the dialog picks another. */
  hostId: HostId
  /** Offers "No project" (a quick chat in a scratch folder). */
  allowNone?: boolean
  className?: string
}) {
  const hosts = useStore((s) => s.hosts)
  const catalog = useProjectCatalog()
  const [open, setOpen] = useState(false)
  const { listed, names } = useMemo(() => {
    const connected = sortedHosts(hosts).filter((h) => h.connection.kind === 'connected')
    return { listed: listedProjects(connected, catalog), names: shortHostNames(connected) }
  }, [hosts, catalog])
  const all = listed.flatMap((p) => p.locations)
  const picked = all.find((p) => projectKey(p) === value) ?? null
  const pickedProject = picked ? listed.find((p) => p.locations.includes(picked)) : undefined
  /** A project keeps the host already picked, else takes the host new projects go to, else its main one. */
  const locationFor = (project: ListedProject) =>
    project.locations.find((l) => projectKey(l) === value) ?? project.locations.find((l) => l.hostId === hostId) ?? project.locations[0]!

  // A project added through the dialog this picker opened is picked as soon as its host lists it.
  const waiting = useRef<Set<string> | null>(null)
  const keys = all.map(projectKey).join('\n')
  useEffect(() => {
    const before = waiting.current
    if (!before) return
    const added = all.find((p) => !before.has(projectKey(p)))
    if (added) {
      waiting.current = null
      onChange(projectKey(added))
    }
    // `keys` stands for the project list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keys])

  const add = (step: AddProjectStep) => {
    setOpen(false)
    waiting.current = new Set(all.map(projectKey))
    openAddProjectDialog({ hostId, step })
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        // A dialog closed without adding leaves nothing to wait for.
        if (next) waiting.current = null
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          role="combobox"
          aria-expanded={open}
          aria-label={t('Project')}
          data-project-picker
          className={cn(
            'inline-flex h-7 max-w-64 min-w-0 items-center gap-1.5 rounded-md px-2 text-xs text-foreground outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring',
            className
          )}
        >
          <Folder className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="min-w-0 truncate">{picked ? projectLabel(picked) : t('No project')}</span>
          {picked && (pickedProject?.locations.length ?? 0) < 2 ? (
            <span className="shrink-0 text-[10px] text-muted-foreground/70">{names[picked.hostId] ?? picked.hostId}</span>
          ) : null}
          <ChevronsUpDown className="size-3 shrink-0 opacity-50" />
        </button>
      </PopoverTrigger>
      {picked && pickedProject && pickedProject.locations.length > 1 ? (
        <span className="inline-flex shrink-0 items-center gap-0.5" role="radiogroup" aria-label={t('Host')} data-project-hosts>
          {pickedProject.locations.map((l) => (
            <button
              key={projectKey(l)}
              type="button"
              role="radio"
              aria-checked={l === picked}
              onClick={() => onChange(projectKey(l))}
              className={cn(
                'h-5 rounded px-1.5 text-[10px] outline-none focus-visible:ring-2 focus-visible:ring-ring',
                l === picked ? 'bg-accent text-foreground' : 'text-muted-foreground/70 hover:text-foreground'
              )}
              data-project-host={l.hostId}
            >
              {names[l.hostId] ?? l.hostId}
            </button>
          ))}
        </span>
      ) : null}
      <PopoverContent align="start" className="w-80 p-0" data-project-picker-list>
        <Command>
          <CommandInput placeholder={t('Search projects...')} className="h-8 text-xs" />
          <CommandList className="max-h-72">
            <CommandEmpty className="py-4 text-xs">{t('No projects match')}</CommandEmpty>
            {allowNone ? (
              <CommandGroup>
                <CommandItem
                  value="__none__ no project"
                  onSelect={() => {
                    onChange(null)
                    setOpen(false)
                  }}
                  className="text-xs"
                  data-project-option="none"
                >
                  <span className="min-w-0 flex-1 truncate">{t('No project')}</span>
                  {value === null ? <Check className="size-3 shrink-0" /> : null}
                </CommandItem>
              </CommandGroup>
            ) : null}
            {listed.length > 0 ? (
              <CommandGroup>
                {listed.map((project) => {
                  const main = project.locations[0]!
                  return (
                    <CommandItem
                      key={project.id}
                      value={`${project.id} ${projectLabel(main)} ${project.locations.map((l) => `${names[l.hostId] ?? ''} ${l.path}`).join(' ')}`}
                      onSelect={() => {
                        onChange(projectKey(locationFor(project)))
                        setOpen(false)
                      }}
                      className="text-xs"
                      data-project-option={project.id}
                    >
                      <span className="min-w-0 flex-1 truncate">{projectLabel(main)}</span>
                      <span className="shrink-0 text-[10px] text-muted-foreground/70">
                        {project.locations.map((l) => names[l.hostId] ?? l.hostId).join(' · ')}
                      </span>
                      {project === pickedProject ? <Check className="size-3 shrink-0" /> : null}
                    </CommandItem>
                  )
                })}
              </CommandGroup>
            ) : null}
            <CommandSeparator />
            <CommandGroup>
              <CommandItem value="__add__ add a project folder" onSelect={() => add('start')} className="text-xs text-muted-foreground" data-project-option="add">
                <FolderPlus className="size-3.5" />
                {t('Add a project…')}
              </CommandItem>
              <CommandItem value="__clone__ clone a repository" onSelect={() => add('clone')} className="text-xs text-muted-foreground" data-project-option="clone">
                <GitBranch className="size-3.5" />
                {t('Clone a repository…')}
              </CommandItem>
              <CommandItem value="__create__ create a new project" onSelect={() => add('create')} className="text-xs text-muted-foreground" data-project-option="create">
                <Plus className="size-3.5" />
                {t('Create a new project…')}
              </CommandItem>
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
