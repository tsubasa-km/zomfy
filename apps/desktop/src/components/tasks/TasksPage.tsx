import { useEffect, useMemo, useState } from 'react'
import { CircleDot, List, LoaderCircle, RefreshCw, Search, X } from 'lucide-react'
import type { HostedWorkItem, HostingProviderId, WorkItemKind, WorkItemPreset } from '@acp-harness/protocol'
import { allProjects, allWorkspaces, getState, useStore, type HostedProject } from '@/session-store'
import { openNewWorkspace, rememberProjectProvider, setTasks, useTasks } from '@/stores/tasks-store'
import { projectLabel } from '@/components/sidebar/workspace-visibility'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import {
  CHECK_COLOR,
  CHECK_ICON,
  HostedReviewIcon,
  REVIEW_DECISION_LABEL,
  ReviewStateBadge,
  providerName,
  relativeTime,
  reviewDecisionClass
} from '@/components/right-sidebar/checks/review-presentation'
import { cn } from '@/lib/utils'
import { useWorkItems } from './use-work-items'
import { WorkItemDetail } from './WorkItemDetail'

// Orca's Tasks page (task-page/*) for the GitHub and GitLab sources: a project's issues or
// PRs/MRs under Orca's presets, a detail page, and "Start" into a new workspace.

const PAGE = 30
const MAX = 100

/** Orca's task-page-localized-options presets per source and kind. */
export function presetsFor(provider: HostingProviderId, kind: WorkItemKind): { id: WorkItemPreset; label: string }[] {
  if (kind === 'issue') {
    return [
      { id: 'open', label: 'Open' },
      { id: 'assigned', label: 'Assigned to me' }
    ]
  }
  return provider === 'gitlab'
    ? [
        { id: 'open', label: 'Open' },
        { id: 'merged', label: 'Merged' },
        { id: 'closed', label: 'Closed' },
        { id: 'all', label: 'All' }
      ]
    : [
        { id: 'open', label: 'Open' },
        { id: 'mine', label: 'Mine' },
        { id: 'review-requested', label: 'Needs review' }
      ]
}

const GRID = 'grid grid-cols-[64px_minmax(0,1fr)_150px_84px_72px] gap-3'

function defaultProject(projects: HostedProject[]): HostedProject | null {
  const active = allWorkspaces().find((w) => w.id === getState().activeWorkspaceId)
  return projects.find((p) => p.id === active?.projectId) ?? projects[0] ?? null
}

export function TasksPage() {
  const tasks = useTasks((s) => s)
  const hosts = useStore((s) => s.hosts)
  const projects = useMemo(() => allProjects(hosts).filter((p) => p.kind === 'git'), [hosts])
  const project = projects.find((p) => p.id === tasks.projectId) ?? defaultProject(projects)
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [limit, setLimit] = useState(PAGE)
  const [selected, setSelected] = useState<HostedWorkItem | null>(null)
  const { items, availability, loading, error, reload } = useWorkItems({
    projectId: project?.id ?? null,
    hostId: project?.hostId ?? null,
    kind: tasks.kind,
    preset: tasks.preset,
    search,
    limit
  })
  const provider = availability?.provider ?? 'github'
  useEffect(() => {
    if (project && availability?.provider) rememberProjectProvider(project.id, availability.provider)
  }, [project, availability?.provider])
  const presets = presetsFor(provider, tasks.kind)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented && !document.querySelector('[role="dialog"]')) {
        if (selected) setSelected(null)
        else setTasks({ open: false })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selected])

  // A preset the other source lacks (GitHub's Mine on GitLab) falls back to Open.
  useEffect(() => {
    if (availability && !presets.some((p) => p.id === tasks.preset)) setTasks({ preset: 'open' })
  }, [availability, presets, tasks.preset])

  const start = (item: HostedWorkItem) => project && openNewWorkspace({ project, workItem: item })
  const reviewWord = provider === 'gitlab' ? 'Merge requests' : 'Pull requests'

  return (
    <div className="relative flex min-h-0 min-w-0 flex-1 flex-col bg-background text-foreground" data-tasks-page>
      <div className="mx-auto flex min-h-0 w-full min-w-0 flex-1 flex-col px-5 pt-2 pb-4 md:px-8">
        <div className="flex shrink-0 flex-wrap items-center gap-2 py-1.5">
          <List className="size-4 text-muted-foreground" />
          <h1 className="text-[13px] font-semibold">Tasks</h1>
          <Select
            value={project?.id ?? ''}
            onValueChange={(projectId) => {
              setSelected(null)
              setLimit(PAGE)
              setTasks({ projectId })
            }}
          >
            <SelectTrigger size="sm" className="h-7 min-w-40 text-xs" data-tasks-project>
              <SelectValue placeholder="Pick a project" />
            </SelectTrigger>
            <SelectContent>
              {projects.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {projectLabel(p)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {availability?.state === 'ready' && (
            <span className="text-[11px] text-muted-foreground">
              {providerName(provider)} · {availability.repo}
            </span>
          )}
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            className="ml-2"
            value={tasks.kind}
            onValueChange={(v) => {
              if (!v) return
              setSelected(null)
              setLimit(PAGE)
              setTasks({ kind: v === 'review' ? 'review' : 'issue', preset: 'open' })
            }}
          >
            <ToggleGroupItem value="issue" className="px-3 text-xs" data-tasks-kind="issue">
              Issues
            </ToggleGroupItem>
            <ToggleGroupItem value="review" className="px-3 text-xs" data-tasks-kind="review">
              {reviewWord}
            </ToggleGroupItem>
          </ToggleGroup>
          <div className="flex-1" />
          <Button size="xs" variant="ghost" className="text-muted-foreground" aria-label="Close tasks" onClick={() => setTasks({ open: false })}>
            <X />
            Close · Esc
          </Button>
        </div>

        {!project ? (
          <Empty title="No git projects" description="Add a git project with a GitHub or GitLab remote to browse its issues and reviews." />
        ) : selected ? (
          <WorkItemDetail project={project} item={selected} onBack={() => setSelected(null)} onStart={start} />
        ) : availability && availability.state !== 'ready' ? (
          <Empty title={unavailableTitle(availability.state, availability.provider)} description={availability.message ?? ''}>
            <Button size="xs" variant="outline" className="mt-3" onClick={reload}>
              Retry
            </Button>
          </Empty>
        ) : (
          <>
            <div className="mt-2 flex min-w-0 flex-col gap-2.5 rounded-md rounded-b-none border border-border/50 bg-muted/35 px-3 py-2.5">
              <div className="flex flex-wrap gap-1.5">
                {presets.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => {
                      setLimit(PAGE)
                      setTasks({ preset: option.id })
                    }}
                    data-tasks-preset={option.id}
                    className={cn(
                      'rounded-md border px-2.5 py-1 text-xs font-medium transition',
                      tasks.preset === option.id
                        ? 'border-border/50 bg-foreground/90 text-background shadow-xs'
                        : 'border-border/60 bg-background text-foreground shadow-xs hover:bg-muted/60'
                    )}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
              <div className="flex min-w-0 items-center gap-2">
                <div className="flex h-7 min-w-0 flex-1 items-center gap-1.5 rounded-md border border-input bg-background px-2">
                  <Search className="size-3.5 shrink-0 text-muted-foreground" />
                  <input
                    className="min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground"
                    placeholder={`Search ${providerName(provider)} ${tasks.kind === 'issue' ? 'issues' : provider === 'gitlab' ? 'MRs' : 'PRs'}...`}
                    value={searchInput}
                    onChange={(e) => setSearchInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        setLimit(PAGE)
                        setSearch(searchInput.trim())
                      }
                    }}
                    data-tasks-search
                  />
                  {searchInput && (
                    <button
                      type="button"
                      aria-label="Clear search"
                      className="text-muted-foreground hover:text-foreground"
                      onClick={() => {
                        setSearchInput('')
                        setSearch('')
                      }}
                    >
                      <X className="size-3.5" />
                    </button>
                  )}
                </div>
                <Button size="xs" variant="outline" disabled={loading} onClick={reload} aria-label={`Refresh ${providerName(provider)} work`}>
                  <RefreshCw className={cn(loading && 'animate-spin')} />
                  Refresh
                </Button>
              </div>
            </div>

            <div className="flex min-h-0 flex-col overflow-hidden rounded-md rounded-t-none border border-t-0 border-border/50 bg-background shadow-sm">
              <div className="scrollbar-sleek min-h-0 overflow-auto">
                <div
                  className={cn(
                    GRID,
                    'sticky top-0 z-10 h-8 items-center border-b border-border/50 bg-background px-3 text-[11px] font-semibold tracking-[0.05em] text-muted-foreground uppercase'
                  )}
                >
                  <span>ID</span>
                  <span>Title / Context</span>
                  <span>{tasks.kind === 'issue' ? 'Status' : 'Checks / Review'}</span>
                  <span>Updated</span>
                  <span />
                </div>
                {error && <div className="border-b border-border px-4 py-4 text-sm text-destructive">{error}</div>}
                {!items && loading && (
                  <div className="flex justify-center py-10">
                    <LoaderCircle className="size-5 animate-spin text-muted-foreground" />
                  </div>
                )}
                {items && items.length === 0 && !error && <div className="px-4 py-8 text-center text-sm text-muted-foreground">Nothing matches this view.</div>}
                {items?.map((item) => (
                  <WorkItemRow key={`${item.kind}-${item.number}`} item={item} onOpen={() => setSelected(item)} onStart={() => start(item)} />
                ))}
                {items && items.length >= limit && limit < MAX && (
                  <div className="flex justify-center border-t border-border/50 py-2">
                    <Button size="xs" variant="ghost" disabled={loading} onClick={() => setLimit((l) => Math.min(MAX, l + PAGE))}>
                      {loading ? 'Loading…' : 'Load more'}
                    </Button>
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function unavailableTitle(state: string, provider: HostingProviderId | null): string {
  const name = provider ? providerName(provider) : 'GitHub or GitLab'
  if (state === 'cli-missing') return `${name} CLI is not installed`
  if (state === 'unauthenticated') return `Not signed in to ${name}`
  return `No ${name} source detected`
}

function Empty({ title, description, children }: { title: string; description: string; children?: React.ReactNode }) {
  return (
    <div className="mt-3 rounded-md border border-border/50 bg-muted/20 px-5 py-8" data-tasks-empty>
      <div className="text-sm font-medium">{title}</div>
      <div className="mt-1 text-xs break-words text-muted-foreground">{description}</div>
      {children}
    </div>
  )
}

function WorkItemRow({ item, onOpen, onStart }: { item: HostedWorkItem; onOpen: () => void; onStart: () => void }) {
  const checks = item.checksStatus && item.checksStatus !== 'none' ? item.checksStatus : null
  const ChecksIcon = checks ? (CHECK_ICON[checks] ?? CHECK_ICON.neutral!) : null
  return (
    <div
      role="button"
      tabIndex={0}
      className={cn(GRID, 'group min-h-11 cursor-pointer items-center border-b border-border/40 px-3 py-1.5 text-left hover:bg-muted/40')}
      onClick={onOpen}
      onKeyDown={(e) => e.key === 'Enter' && onOpen()}
      data-work-item={item.number}
    >
      <span className="flex items-center gap-1.5 text-xs text-muted-foreground tabular-nums">
        {item.kind === 'review' ? (
          <HostedReviewIcon review={{ provider: item.provider, state: item.state, checksStatus: item.checksStatus ?? 'none' }} className="size-3.5 shrink-0" />
        ) : (
          <CircleDot className={cn('size-3.5 shrink-0', item.state === 'open' ? 'text-emerald-500' : 'text-purple-500')} />
        )}
        {item.provider === 'gitlab' && item.kind === 'review' ? '!' : '#'}
        {item.number}
      </span>
      <span className="min-w-0">
        <span className="block truncate text-[13px] font-medium text-foreground">{item.title}</span>
        <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground">
          {item.author && <span className="shrink-0">{item.author}</span>}
          {item.kind === 'review' && item.headRefName && <span className="min-w-0 truncate font-mono">{item.headRefName}</span>}
          {item.labels.slice(0, 3).map((label) => (
            <span key={label} className="shrink-0 rounded-full border border-border px-1.5 text-[10px]">
              {label}
            </span>
          ))}
        </span>
      </span>
      <span className="flex min-w-0 items-center gap-1.5 text-[11px]">
        {item.kind === 'issue' || !ChecksIcon ? (
          <ReviewStateBadge state={item.state} />
        ) : (
          <ChecksIcon className={cn('size-3.5 shrink-0', CHECK_COLOR[checks!], checks === 'pending' && 'animate-spin')} />
        )}
        {item.reviewDecision && <span className={cn('truncate', reviewDecisionClass(item.reviewDecision))}>{REVIEW_DECISION_LABEL[item.reviewDecision]}</span>}
      </span>
      <span className="text-[11px] text-muted-foreground">{relativeTime(item.updatedAt)}</span>
      <span className="flex justify-end">
        <Button
          size="xs"
          variant="outline"
          className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
          onClick={(e) => {
            e.stopPropagation()
            onStart()
          }}
          title={item.kind === 'issue' ? 'Start workspace from issue' : `Start workspace from ${item.provider === 'gitlab' ? 'MR' : 'PR'}`}
          data-work-item-start
        >
          Start
        </Button>
      </span>
    </div>
  )
}
