import { useState } from 'react'
import { Check, ChevronsUpDown, FolderGit2, FolderPlus } from 'lucide-react'
import { allProjects, useStore, type HostedProject } from '@/session-store'
import { projectLabel } from '@/components/sidebar/workspace-visibility'
import { Button } from '@/components/ui/button'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator } from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'

// Orca's ProjectCombobox: every project, by host when there are several, and "Add project…" last.

export function ProjectCombobox({
  value,
  onChange,
  onAddProject
}: {
  value: HostedProject | null
  onChange: (project: HostedProject) => void
  onAddProject: () => void
}) {
  const hosts = useStore((s) => s.hosts)
  const [open, setOpen] = useState(false)
  const projects = allProjects(hosts)
  const byHost = Object.values(hosts)
    .map((host) => ({ host, projects: projects.filter((p) => p.hostId === host.id) }))
    .filter((g) => g.projects.length > 0)
  const isSelected = (p: HostedProject) => p.id === value?.id && p.hostId === value.hostId

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-between font-normal"
          data-project-combobox
        >
          <span className="flex min-w-0 items-center gap-1.5">
            <FolderGit2 className="size-3.5 shrink-0 text-muted-foreground" />
            <span className={cn('truncate text-sm', !value && 'text-muted-foreground')}>{value ? projectLabel(value) : 'Choose project'}</span>
            {value && byHost.length > 1 ? (
              <span className="shrink-0 truncate text-xs text-muted-foreground">{hosts[value.hostId]?.label}</span>
            ) : null}
          </span>
          <ChevronsUpDown className="size-3.5 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
        <Command>
          <CommandInput placeholder="Search projects..." className="h-8 text-xs" />
          <CommandList className="max-h-60">
            <CommandEmpty className="py-4 text-xs">No projects match</CommandEmpty>
            {byHost.map(({ host, projects: list }) => (
              <CommandGroup key={host.id} heading={byHost.length > 1 ? host.label : undefined}>
                {list.map((p) => (
                  <CommandItem
                    key={`${p.hostId}|${p.id}`}
                    value={`${projectLabel(p)} ${host.label} ${p.id}`}
                    data-project-option={p.id}
                    onSelect={() => {
                      onChange(p)
                      setOpen(false)
                    }}
                    className="text-xs"
                  >
                    <span className="min-w-0 flex-1 truncate">{projectLabel(p)}</span>
                    {p.kind === 'folder' ? <span className="shrink-0 text-[10px] text-muted-foreground">folder</span> : null}
                    {isSelected(p) ? <Check className="size-3 shrink-0" /> : null}
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
            <CommandSeparator />
            <CommandGroup>
              <CommandItem
                value="Add project"
                data-project-option="add"
                onSelect={() => {
                  setOpen(false)
                  onAddProject()
                }}
                className="text-xs text-muted-foreground"
              >
                <FolderPlus className="size-3.5" />
                Add project…
              </CommandItem>
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
