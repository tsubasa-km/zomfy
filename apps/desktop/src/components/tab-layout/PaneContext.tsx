import { useEffect, useMemo, useRef, useState } from 'react'
import { Check } from 'lucide-react'
import { allProjects, allWorkspaces, inWindowTabs, useStore } from '@/session-store'
import { setGroupContext, tabScope, useTabLayout, WINDOW_TABS } from '@/stores/tab-layout-store'
import { letterAvatar } from '@/lib/connector-icons'
import { resolvePaneContext, type PaneContext } from '@/lib/pane-context'
import { matchLabel } from '@/lib/new-tab-pick'
import { isImeOwnedKeyboardEvent } from '@/lib/ime-composition-keyboard-event'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Input } from '@/components/ui/input'
import { projectLabel, workspaceLabel } from '@/components/sidebar/workspace-visibility'
import { useProjectCatalog } from '@/stores/project-catalog-store'
import { cn } from '@/lib/utils'
import { tabWorkspaceId, useWorkspacePlace, type WorkspaceTab } from './workspace-tab-model'
import { t } from '@/i18n/i18n'

// The workspace a split pane works in (docs/specs/panes-as-workspaces.md): how it is worked out,
// and the mark at the start of the pane's tab strip that shows it and changes it.

/** The window's workspaces, by id, as a string so a fresh list of the same ones re-renders nothing. */
function useWindowWorkspaceIds(): Set<string> {
  const known = useStore((s) =>
    allWorkspaces(s)
      .filter((w) => inWindowTabs(w.id, s))
      .map((w) => w.id)
      .join(' ')
  )
  return useMemo(() => new Set(known.split(' ').filter(Boolean)), [known])
}

/**
 * The pane's context. `layoutKey` is the tab layout's workspace argument: WINDOW_TABS (or any
 * workspace of the window) for the main window, whose panes each have their own; a pop-out's or the
 * floating panel's workspace, which is every one of its panes' context.
 */
export function usePaneContext(layoutKey: string, groupId: string, tabs: WorkspaceTab[], activeId: string | null): PaneContext {
  const scope = tabScope(layoutKey)
  const stored = useTabLayout((s) => s.layouts[scope]?.groups[groupId]?.context)
  const hasStart = tabs.some((tab) => tab.kind === 'start')
  const startWorkspace = useStore((s) => (hasStart ? s.startTab.workspaceId : null))
  const live = useWindowWorkspaceIds()
  return useMemo(() => {
    if (scope !== WINDOW_TABS) return { context: layoutKey, settle: null }
    const active = tabs.find((tab) => tab.id === activeId)
    const candidates = [active ? tabWorkspaceId(active) : null, ...tabs.map(tabWorkspaceId), startWorkspace]
    return resolvePaneContext(stored, candidates, (id) => live.has(id))
  }, [scope, layoutKey, stored, tabs, activeId, startWorkspace, live])
}

/** A workspace as the picker lists it: `project · branch`, and the project's name for its mark. */
interface Place {
  id: string
  label: string
  project: string
}

function useWindowPlaces(): Place[] {
  useProjectCatalog()
  const live = useWindowWorkspaceIds()
  const hosts = useStore((s) => s.hosts)
  const workspaces = useStore((s) => allWorkspaces(s))
  return useMemo(() => {
    const projects = allProjects(hosts)
    return workspaces
      .filter((w) => live.has(w.id))
      .map((w) => {
        const project = projects.find((p) => p.hostId === w.hostId && p.id === w.projectId)
        const name = project ? projectLabel(project) : workspaceLabel(w)
        const label = project ? (w.isPrimary ? name : `${name} · ${(w.branch ?? workspaceLabel(w)).split('/').pop()}`) : w.scratch ? t('Quick thread') : name
        return { id: w.id, label, project: name }
      })
      .sort((a, b) => a.label.localeCompare(b.label))
  }, [workspaces, hosts, live])
}

/** The project's square: its colour and first letter, or a hollow dashed one for no project. */
function ContextSquare({ project, className }: { project: string | null; className?: string }) {
  if (!project) {
    return <span aria-hidden data-pane-context-none className={cn('size-4 shrink-0 rounded-[4px] border border-dashed border-muted-foreground/70', className)} />
  }
  const { letter, hue } = letterAvatar(project)
  return (
    <span
      aria-hidden
      data-pane-context-letter
      className={cn('flex size-4 shrink-0 items-center justify-center rounded-[4px] text-[10px] leading-none font-semibold text-white', className)}
      style={{ backgroundColor: `hsl(${hue} 50% 45%)` }}
    >
      {letter}
    </span>
  )
}

/** The pane's context at the start of its strip; with the window split, its name beside it. */
export function PaneContextMark({
  layoutKey,
  groupId,
  context,
  named
}: {
  layoutKey: string
  groupId: string
  context: string | null
  named: boolean
}) {
  const [open, setOpen] = useState(false)
  const place = useWorkspacePlace(context)
  const project = useStore((s) => {
    const w = context ? allWorkspaces(s).find((x) => x.id === context) : undefined
    if (!w) return null
    const p = w.projectId ? allProjects(s.hosts).find((x) => x.hostId === w.hostId && x.id === w.projectId) : undefined
    return p ? projectLabel(p) : workspaceLabel(w)
  })
  const name = context ? place : t('No project')
  return (
    <Popover open={open} onOpenChange={setOpen} modal={false}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={name}
          title={name}
          data-pane-context={context ?? ''}
          className={cn(
            'my-auto ml-1.5 flex h-7 shrink-0 items-center gap-1.5 rounded-md text-muted-foreground hover:bg-accent/50 hover:text-foreground focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none',
            named ? 'max-w-[160px] px-1.5' : 'w-7 justify-center'
          )}
        >
          <ContextSquare project={project} />
          {named && context ? <span className="min-w-0 truncate text-[12px]">{place}</span> : null}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" sideOffset={6} className="w-72 p-1" onOpenAutoFocus={(e) => e.preventDefault()}>
        <ContextPicker
          context={context}
          onPick={(next) => {
            setGroupContext(layoutKey, groupId, next)
            setOpen(false)
          }}
        />
      </PopoverContent>
    </Popover>
  )
}

function ContextPicker({ context, onPick }: { context: string | null; onPick: (context: string | null) => void }) {
  const places = useWindowPlaces()
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => {
    const timer = setTimeout(() => input.current?.focus(), 0)
    return () => clearTimeout(timer)
  }, [])
  const rows = useMemo(() => {
    const all: { id: string | null; label: string; project: string | null }[] = [
      { id: null, label: t('No project'), project: null },
      ...places
    ]
    return query.trim() ? all.filter((row) => matchLabel(row.label, query)) : all
  }, [places, query])
  const active = Math.min(selected, Math.max(0, rows.length - 1))
  return (
    <div data-pane-context-picker>
      <Input
        ref={input}
        value={query}
        aria-label={t('Filter workspaces')}
        placeholder={t('Filter workspaces')}
        className="h-8 border-0 bg-transparent px-2 text-xs shadow-none focus-visible:ring-0 dark:bg-transparent"
        onChange={(e) => {
          setQuery(e.target.value)
          setSelected(0)
        }}
        onKeyDown={(e) => {
          if (isImeOwnedKeyboardEvent(e)) return
          if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && rows.length > 0) {
            e.preventDefault()
            setSelected((active + (e.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length)
          } else if (e.key === 'Enter' && rows[active]) {
            e.preventDefault()
            onPick(rows[active]!.id)
          }
        }}
      />
      <div role="listbox" className="mt-1 max-h-72 space-y-0.5 overflow-y-auto">
        {rows.map((row, index) => (
          <button
            key={row.id ?? ''}
            type="button"
            role="option"
            aria-selected={index === active}
            data-pane-context-option={row.id ?? ''}
            className={cn(
              'flex h-7 w-full items-center gap-2 rounded-[7px] px-2 text-left text-xs outline-none',
              index === active ? 'bg-black/8 text-accent-foreground dark:bg-white/14' : 'text-foreground'
            )}
            onMouseEnter={() => setSelected(index)}
            onClick={() => onPick(row.id)}
          >
            <ContextSquare project={row.project} />
            <span className="min-w-0 flex-1 truncate">{row.label}</span>
            {row.id === context ? <Check className="size-3.5 shrink-0" /> : null}
          </button>
        ))}
      </div>
    </div>
  )
}
