import { useMemo, useState, type ReactNode } from 'react'
import { Bell, Check, FolderGit2, GitBranch, ListFilter, Loader, Mail, Monitor, Server } from 'lucide-react'
import { WORKSPACE_STATUSES } from '@acp-harness/protocol'
import { LOCAL_HOST, allProjects, useStore } from '@/session-store'
import {
  activeFilterCount,
  resetFilters,
  setFilters,
  toggleIn,
  useSidebarStore,
  type StatusFilterId
} from '@/stores/sidebar-store'
import { WorkspaceStatusIcon } from '@/components/sidebar/WorkspaceStatusIcon'
import { projectLabel } from '@/components/sidebar/workspace-visibility'
import { Button } from '@/components/ui/button'
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { DropdownMenu, DropdownMenuContent, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { SwitchIndicator } from '@/components/ui/switch'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { t } from '@/i18n/i18n'

// Orca's SidebarFilter: switch rows, then a searchable project list, then Reset. Rows for agent
// state, unread, status and host stand in for Orca's sleeping/automation rows the harness lacks.

export const STATUS_FILTERS: { id: StatusFilterId; label: string }[] = [
  ...WORKSPACE_STATUSES.map((s) => ({ id: s.id, label: t(s.label) })),
  { id: 'none', label: t('No status') }
]

/** Orca's FilterToggleRow. */
export function FilterToggleRow({
  icon,
  label,
  checked,
  onChange,
  indented = false,
  filterId
}: {
  icon: ReactNode
  label: string
  checked: boolean
  onChange: (next: boolean) => void
  indented?: boolean
  filterId?: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      data-filter={filterId}
      onClick={() => onChange(!checked)}
      className={cn(
        'flex w-full items-center justify-between gap-2 rounded-[5px] py-1.5 pr-2 text-[12px] font-medium hover:bg-muted focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none',
        indented ? 'pl-7' : 'pl-2'
      )}
    >
      <span className={cn('inline-flex items-center gap-2', indented ? 'text-muted-foreground' : 'text-foreground')}>
        <span className="text-muted-foreground">{icon}</span>
        {label}
      </span>
      <SwitchIndicator checked={checked} size="compact" className="data-[state=checked]:bg-primary" />
    </button>
  )
}

function SectionLabel({ children, onClear }: { children: ReactNode; onClear?: () => void }) {
  return (
    <div className="flex items-center justify-between px-2 py-1">
      <span className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">{children}</span>
      {onClear && (
        <button
          type="button"
          onClick={onClear}
          className="rounded-full px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          {t('Clear')}
        </button>
      )}
    </div>
  )
}

export function SidebarFilterMenu() {
  const filters = useSidebarStore((s) => s.filters)
  const hosts = useStore((s) => s.hosts)
  const projects = useMemo(() => allProjects(hosts), [hosts])
  const [query, setQuery] = useState('')
  const count = activeFilterCount(filters)
  const hostList = Object.values(hosts).filter((h) => h.harness)
  const matching = projects.filter((p) => projectLabel(p).toLowerCase().includes(query.trim().toLowerCase()))

  return (
    <DropdownMenu modal={false} onOpenChange={(open) => !open && setQuery('')}>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={count > 0 ? t('Edit filters ({n} active)', { n: count }) : t('Filter workspaces')}
              className="relative text-muted-foreground"
              data-sidebar-filter-trigger
            >
              <ListFilter className="size-3.5" strokeWidth={2.25} />
              {count > 0 && (
                <span
                  aria-hidden
                  className="absolute -top-0.5 -right-0.5 flex h-3 min-w-3 items-center justify-center rounded-full bg-primary px-0.5 text-[9px] leading-none font-medium text-primary-foreground"
                >
                  {count > 9 ? '9+' : count}
                </span>
              )}
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom" sideOffset={6}>
          {count > 0 ? t('Edit filters') : t('Filter workspaces')}
        </TooltipContent>
      </Tooltip>
      <DropdownMenuContent side="right" align="start" sideOffset={8} className="w-72" data-sidebar-filter-menu>
        <FilterToggleRow
          filterId="agent-running"
          icon={<Loader className="size-3.5" />}
          label={t('Agent running')}
          checked={filters.agentRunning}
          onChange={(agentRunning) => setFilters({ agentRunning })}
        />
        <FilterToggleRow
          filterId="needs-you"
          icon={<Bell className="size-3.5" />}
          label={t('Needs you')}
          checked={filters.needsYou}
          onChange={(needsYou) => setFilters({ needsYou })}
        />
        <FilterToggleRow
          filterId="unread"
          icon={<Mail className="size-3.5" />}
          label={t('Unread')}
          checked={filters.unread}
          onChange={(unread) => setFilters({ unread })}
        />
        <FilterToggleRow
          filterId="hide-primary"
          icon={<GitBranch className="size-3.5" />}
          label={t('Hide default branch')}
          checked={filters.hidePrimary}
          onChange={(hidePrimary) => setFilters({ hidePrimary })}
        />

        <DropdownMenuSeparator />
        <SectionLabel onClear={filters.statuses.length > 0 ? () => setFilters({ statuses: [] }) : undefined}>
          {t('Status')}
        </SectionLabel>
        {STATUS_FILTERS.map((s) => (
          <FilterToggleRow
            key={s.id}
            filterId={`status:${s.id}`}
            icon={<WorkspaceStatusIcon status={s.id === 'none' ? undefined : s.id} />}
            label={s.label}
            checked={filters.statuses.includes(s.id)}
            onChange={() => setFilters({ statuses: toggleIn(filters.statuses, s.id) })}
          />
        ))}

        {hostList.length > 1 && (
          <>
            <DropdownMenuSeparator />
            <SectionLabel onClear={filters.hostIds.length > 0 ? () => setFilters({ hostIds: [] }) : undefined}>
              {t('Hosts')}
            </SectionLabel>
            {hostList.map((h) => (
              <FilterToggleRow
                key={h.id}
                filterId={`host:${h.id}`}
                icon={h.id === LOCAL_HOST ? <Monitor className="size-3.5" /> : <Server className="size-3.5" />}
                label={h.label}
                checked={filters.hostIds.includes(h.id)}
                onChange={() => setFilters({ hostIds: toggleIn(filters.hostIds, h.id) })}
              />
            ))}
          </>
        )}

        {projects.length > 1 && (
          <>
            <DropdownMenuSeparator />
            <SectionLabel onClear={filters.projectIds.length > 0 ? () => setFilters({ projectIds: [] }) : undefined}>
              {t('Projects')}
              {filters.projectIds.length > 0 && (
                <span className="ml-1.5 font-medium tracking-normal text-foreground normal-case">
                  · {filters.projectIds.length}
                </span>
              )}
            </SectionLabel>
            <Command shouldFilter={false} className="bg-transparent">
              <CommandInput
                placeholder={t('Search projects...')}
                value={query}
                onValueChange={setQuery}
                onKeyDown={(e) => e.stopPropagation()}
                className="h-8 py-2 text-xs"
                wrapperClassName="mx-1 rounded-[7px] border border-border/70 px-2"
                iconClassName="h-3.5 w-3.5"
              />
              <CommandList className="max-h-48 py-1">
                <CommandEmpty className="py-4 text-[11px]">{t('No projects match')}</CommandEmpty>
                {matching.map((p) => (
                  <CommandItem
                    key={p.id}
                    value={p.id}
                    data-filter={`project:${p.id}`}
                    onSelect={() => setFilters({ projectIds: toggleIn(filters.projectIds, p.id) })}
                    className="mx-1 my-0.5 items-center gap-2 rounded-[7px] px-2 py-1 text-[12px] leading-5 font-medium"
                  >
                    <FolderGit2 className="size-3.5 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate">{projectLabel(p)}</span>
                    {filters.projectIds.includes(p.id) && <Check className="size-3 shrink-0 text-primary" strokeWidth={3} />}
                  </CommandItem>
                ))}
              </CommandList>
            </Command>
          </>
        )}

        {count > 0 && (
          <>
            <DropdownMenuSeparator />
            <div className="flex items-center px-1 py-1">
              <button
                type="button"
                data-filter="reset"
                onClick={resetFilters}
                className="rounded-[5px] px-2 py-1 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                {t('Reset filters')}
              </button>
            </div>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
