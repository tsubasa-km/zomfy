import { useRef, type ReactNode } from 'react'
import { Search, X } from 'lucide-react'
import { allProjects, useStore } from '@/session-store'
import { setFilters, toggleIn, useSidebarStore } from '@/stores/sidebar-store'
import { STATUS_FILTERS } from '@/components/sidebar/SidebarFilterMenu'
import { projectLabel } from '@/components/sidebar/workspace-visibility'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

// Orca's WorkspaceKanbanSearchField (counter + clear, Escape clears), with the active filters below
// it as removable chips so a narrowed list never looks complete.

export function SidebarSearch({ matchCount, totalCount }: { matchCount: number; totalCount: number }) {
  const query = useSidebarStore((s) => s.filters.query)
  const inputRef = useRef<HTMLInputElement>(null)
  const filtering = query.trim() !== ''

  return (
    <div className="px-2 pt-1">
      <div className="relative flex min-w-0 items-center">
        <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          ref={inputRef}
          value={query}
          aria-label="Search workspaces"
          placeholder="Search workspaces"
          data-sidebar-search
          className="h-7 border-worktree-sidebar-border bg-background pr-16 pl-7 text-xs"
          onChange={(e) => setFilters({ query: e.target.value })}
          onKeyDown={(e) => {
            if (e.key !== 'Escape' || e.nativeEvent.isComposing) return
            e.preventDefault()
            if (query) setFilters({ query: '' })
            else inputRef.current?.blur()
          }}
        />
        {query && (
          <div className="absolute right-1 flex items-center gap-0.5">
            {filtering && (
              <span aria-hidden className="text-[10px] text-muted-foreground tabular-nums" data-search-count>
                {matchCount} / {totalCount}
              </span>
            )}
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-label="Clear search"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                setFilters({ query: '' })
                inputRef.current?.focus()
              }}
            >
              <X className="size-3.5" />
            </Button>
          </div>
        )}
      </div>
      <ActiveFilterChips />
    </div>
  )
}

function Chip({ id, children, onRemove }: { id: string; children: ReactNode; onRemove: () => void }) {
  return (
    <span
      data-filter-chip={id}
      className="inline-flex h-5 max-w-full items-center gap-0.5 rounded-full border border-worktree-sidebar-border bg-worktree-sidebar-accent/55 pr-0.5 pl-2 text-[11px] text-foreground"
    >
      <span className="min-w-0 truncate">{children}</span>
      <button
        type="button"
        aria-label="Remove filter"
        onClick={onRemove}
        className="flex size-4 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        <X className="size-3" />
      </button>
    </span>
  )
}

function ActiveFilterChips() {
  const f = useSidebarStore((s) => s.filters)
  const hosts = useStore((s) => s.hosts)
  const chips: ReactNode[] = []
  if (f.agentRunning) chips.push(<Chip key="a" id="agent-running" onRemove={() => setFilters({ agentRunning: false })}>Agent running</Chip>)
  if (f.needsYou) chips.push(<Chip key="n" id="needs-you" onRemove={() => setFilters({ needsYou: false })}>Needs you</Chip>)
  if (f.unread) chips.push(<Chip key="u" id="unread" onRemove={() => setFilters({ unread: false })}>Unread</Chip>)
  if (f.hidePrimary) {
    chips.push(<Chip key="p" id="hide-primary" onRemove={() => setFilters({ hidePrimary: false })}>No default branch</Chip>)
  }
  for (const status of f.statuses) {
    const label = STATUS_FILTERS.find((s) => s.id === status)?.label ?? status
    chips.push(
      <Chip key={`s-${status}`} id={`status:${status}`} onRemove={() => setFilters({ statuses: toggleIn(f.statuses, status) })}>
        {label}
      </Chip>
    )
  }
  for (const hostId of f.hostIds) {
    chips.push(
      <Chip key={`h-${hostId}`} id={`host:${hostId}`} onRemove={() => setFilters({ hostIds: toggleIn(f.hostIds, hostId) })}>
        {hosts[hostId]?.label ?? hostId}
      </Chip>
    )
  }
  const projects = allProjects(hosts)
  for (const projectId of f.projectIds) {
    const project = projects.find((p) => p.id === projectId)
    if (!project) continue
    chips.push(
      <Chip
        key={`p-${projectId}`}
        id={`project:${projectId}`}
        onRemove={() => setFilters({ projectIds: toggleIn(f.projectIds, projectId) })}
      >
        {projectLabel(project)}
      </Chip>
    )
  }
  if (chips.length === 0) return null
  return <div className="mt-1.5 flex flex-wrap gap-1">{chips}</div>
}
