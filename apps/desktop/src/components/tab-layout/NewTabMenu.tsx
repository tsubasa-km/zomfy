import { useEffect, useMemo, useRef, useState } from 'react'
import { Bot, ChevronRight, FolderOpen, Globe, MessageSquarePlus, PanelsTopLeft, Pin, PinOff, Plus, RefreshCw, Search, Server, SquareTerminal } from 'lucide-react'
import { LOCAL_HOST, allWorkspaces, openEditorTab, useStore } from '@/session-store'
import { toast } from 'sonner'
import { defaultTerminalWorkspace } from '@/lib/new-tab-pins'
import { useAllHostSettings } from '@/stores/host-settings-store'
import { sortedHosts } from '@/components/settings/HostsPane'
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from '@/components/ui/context-menu'
import { openSshConnectionsDialog } from '@/lib/ssh-connections'
import { loadDetectedAgents } from '@/lib/detected-agents'
import { isImeOwnedKeyboardEvent } from '@/lib/ime-composition-keyboard-event'
import { defaultShellFirst, pushRecent, searchRows, treeKey, treeRows, type PickNode, type PickRow, type PickScope } from '@/lib/new-tab-pick'
import { cn } from '@/lib/utils'
import { createExternalStore } from '@/stores/external-store'
import { looksLikeSearchQuery, normalizeAddress } from '@/stores/browser-tab-store'
import { groupOfTab, layoutFor, useTabLayout } from '@/stores/tab-layout-store'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { FileIcon } from '@/components/FileIcon'
import { requestAgentLaunchDialog } from '@/components/terminal/AgentLaunchDialog'
import { TuiAgentIcon } from '@/components/terminal/TuiAgentIcon'
import { TabKindIcon } from './TabKindIcon'
import { focusGroup } from './tab-group-commands'
import { matchFiles, workspaceFiles } from './workspace-file-index'
import { activateTab, newTerminalTab, openBrowserTab, tabTitle, useWorkspaceTabs } from './workspace-tab-model'
import { requestNewTerminal } from './NewTabDialogs'
import {
  toggleNewTabPin,
  unpinNewTabItem,
  useBrowserItems,
  useChatItems,
  useCommandItems,
  useNewThreadItem,
  useNewTabPins,
  usePanelItems,
  useSshItems,
  useTerminalItems,
  useTuiAgentItems,
  useWorkflowItems,
  type NewTabItem
} from './new-tab-items'
import { t } from '@/i18n/i18n'

// The tab strip's "+": a quick pick shaped as a tree (docs/specs/panes-as-workspaces.md). New thread
// and the pins first, then Terminal, Agent (a branch per agent) and Panel; typing lists the
// matching leaves with their path. Every item opens in the pane's workspace. Pins are as in
// docs/specs/new-tab-menu-and-pins.md.

const SCOPE_ICON: Record<PickScope, typeof SquareTerminal> = { terminal: SquareTerminal, agent: Bot, panel: PanelsTopLeft }
const scopeName = (scope: PickScope) => (scope === 'terminal' ? t('Terminal') : scope === 'agent' ? t('Agent') : t('Panel'))

// ── Open branches ────────────────────────────────────────────────────────

const OPEN_KEY = 'zomfy.new-tab-open.v1'

function readOpen(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(OPEN_KEY) ?? '[]')
    return Array.isArray(raw) ? raw.filter((id): id is string => typeof id === 'string') : []
  } catch {
    return []
  }
}

/** The branches open in the tree, kept for the next "+". */
const openBranches = createExternalStore<string[]>(readOpen(), (list) => {
  try {
    localStorage.setItem(OPEN_KEY, JSON.stringify(list))
  } catch {
    // Storage can be unavailable; every branch then starts folded.
  }
})

// ── Recently run ─────────────────────────────────────────────────────────

const RECENT_KEY = 'zomfy.new-tab-recent.v1'

function readRecent(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]')
    return Array.isArray(raw) ? raw.filter((id): id is string => typeof id === 'string') : []
  } catch {
    return []
  }
}

const recentItems = createExternalStore<string[]>(readRecent(), (list) => {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(list))
  } catch {
    // Storage can be unavailable; the list then starts empty next time.
  }
})

// ── Items ────────────────────────────────────────────────────────────────

/** A node of the tree: an item to run, or a branch with an icon of its own. */
type Node = PickNode<NewTabItem> & { icon?: React.ReactNode }

const leaf = (item: NewTabItem, id = item.id, label = item.label): Node => ({ id, label, entry: item })

const failedTerminal = (error: unknown) =>
  toast.error(t("Couldn't open a terminal"), { description: error instanceof Error ? error.message : String(error) })

/**
 * The Terminal branch (docs/specs/panes-as-workspaces.md): each connected host's shells, the default
 * first (a branch per host when there are several, the pane's host first), then the quick commands,
 * the SSH logins, `SSH connections…` and `Other folder…`. A shell opens in the pane's workspace when
 * it is on that host, else in the host's default folder. `defaultShell` is the pane's host's default.
 */
function useTerminalBranch(workspaceId: string | null): { branch: Node[]; defaultShell: Node | null } {
  const hosts = useStore((s) => s.hosts)
  const workspaces = useStore((s) => allWorkspaces(s))
  const paneHost = workspaces.find((w) => w.id === workspaceId)?.hostId ?? null
  const connected = useMemo(() => {
    const list = sortedHosts(hosts).filter((h) => h.connection.kind === 'connected')
    return paneHost ? [...list.filter((h) => h.id === paneHost), ...list.filter((h) => h.id !== paneHost)] : list
  }, [hosts, paneHost])
  const settings = useAllHostSettings(connected.map((h) => h.id))
  const commands = useCommandItems(workspaceId)
  const ssh = useSshItems(workspaceId)
  return useMemo(() => {
    const several = connected.length > 1
    let defaultShell: Node | null = null
    const hostNodes: Node[] = []
    for (const host of connected) {
      const folder = host.id === paneHost && workspaceId ? workspaceId : defaultTerminalWorkspace(workspaces, host.id, workspaceId)
      if (!folder || host.shells.length === 0) continue
      const shells = defaultShellFirst(host.shells, settings[host.id]?.defaultShellId).map((shell) =>
        leaf({
          pin: null,
          id: `shell:${host.id}:${shell.id}`,
          scope: 'terminal',
          keywords: `terminal shell ${shell.label} ${host.label}`,
          icon: <SquareTerminal className="size-4" />,
          label: shell.label,
          run: () => void newTerminalTab(folder, shell.id).catch(failedTerminal)
        })
      )
      if (!defaultShell && (host.id === paneHost || !paneHost)) defaultShell = shells[0]!
      if (several) hostNodes.push({ id: `host:${host.id}`, label: host.label, icon: <Server className="size-4" />, children: shells })
      else hostNodes.push(...shells)
    }
    const rest: Node[] = [...commands, ...ssh].map((item) => leaf(item))
    if (workspaceId) {
      rest.push(
        leaf({
          pin: null,
          id: 'ssh-connections',
          scope: 'terminal',
          keywords: 'ssh connections remote',
          icon: <Server className="size-4" />,
          label: t('SSH connections…'),
          run: () => openSshConnectionsDialog(workspaceId)
        })
      )
    }
    rest.push(
      leaf({
        pin: null,
        id: 'terminal-dialog',
        scope: 'terminal',
        keywords: 'new terminal other folder host shell dialog',
        icon: <FolderOpen className="size-4" />,
        label: t('Other folder…'),
        run: () => requestNewTerminal(workspaceId)
      })
    )
    return { branch: [...hostNodes, ...rest], defaultShell }
  }, [connected, settings, workspaces, paneHost, workspaceId, commands, ssh])
}

/** The tree the pane's "+" offers: New thread, the pins, then Terminal, Agent and Panel. */
function useTree(workspaceId: string | null, pins: string[]): Node[] {
  const hostId = useStore((s) => allWorkspaces(s).find((w) => w.id === workspaceId)?.hostId ?? LOCAL_HOST)
  const newThread = useNewThreadItem(workspaceId)
  const chats = useChatItems(workspaceId)
  const terminal = useTerminalItems(workspaceId)
  const { branch: terminalChildren } = useTerminalBranch(workspaceId)
  const { items: tuiAgents } = useTuiAgentItems(workspaceId)
  const commands = useCommandItems(workspaceId)
  const workflows = useWorkflowItems(workspaceId, true)
  const ssh = useSshItems(workspaceId)
  const browser = useBrowserItems(workspaceId)
  const panels = usePanelItems(workspaceId)
  return useMemo(() => {
    // One branch per agent: its chat, its CLI in a terminal, the CLI with a first prompt.
    const providers = new Map<string, { label: string; children: Node[] }>()
    const under = (provider: { id: string; label: string }) => {
      const found = providers.get(provider.id) ?? { label: provider.label, children: [] }
      providers.set(provider.id, found)
      return found.children
    }
    for (const item of chats) if (item.provider) under(item.provider).push(leaf(item, item.id, item.treeLabel ?? item.label))
    for (const item of tuiAgents) {
      if (!item.provider || !workspaceId) continue
      const children = under(item.provider)
      children.push(leaf(item, item.id, item.treeLabel ?? item.label))
      const agent = item.provider.id
      children.push(
        leaf(
          {
            pin: null,
            id: `prompt:${agent}`,
            scope: 'agent',
            keywords: `${agent} launch agent with prompt`,
            icon: <MessageSquarePlus className="size-4" />,
            label: t('Launch {agent} with a prompt…', { agent: item.provider.label }),
            run: () => requestAgentLaunchDialog(workspaceId, agent as Parameters<typeof requestAgentLaunchDialog>[1])
          },
          `prompt:${agent}`,
          t('With a prompt…')
        )
      )
    }
    const agentChildren: Node[] = [...providers].map(([id, provider]) => ({
      id: `provider:${id}`,
      label: provider.label,
      icon: <TuiAgentIcon agent={id as Parameters<typeof TuiAgentIcon>[0]['agent']} size={14} />,
      children: provider.children
    }))
    agentChildren.push(...workflows.map((item) => leaf(item)))
    if (workspaceId) {
      agentChildren.push(
        leaf({
          pin: null,
          id: 'refresh-agents',
          scope: 'agent',
          keywords: 'refresh agents detect',
          icon: <RefreshCw className="size-4" />,
          label: t('Refresh Agents'),
          run: () => void loadDetectedAgents(hostId, true)
        })
      )
    }
    const panelChildren: Node[] = [...browser, ...panels].map((item) => leaf(item))
    const branch = (scope: PickScope, children: Node[]): Node[] => {
      const Icon = SCOPE_ICON[scope]
      return children.length > 0 ? [{ id: `scope:${scope}`, label: scopeName(scope), icon: <Icon className="size-4" />, children }] : []
    }
    const everything = [...terminal, ...commands, ...ssh, ...chats, ...tuiAgents, ...workflows, ...browser, ...panels]
    const pinned = pins.flatMap((pin) => {
      const item = everything.find((i) => i.pin === pin)
      return item && !item.disabled ? [leaf(item, `pin:${pin}`)] : []
    })
    return [leaf(newThread), ...pinned, ...branch('terminal', terminalChildren), ...branch('agent', agentChildren), ...branch('panel', panelChildren)]
  }, [workspaceId, hostId, pins, newThread, chats, terminal, terminalChildren, tuiAgents, commands, workflows, ssh, browser, panels])
}

const NO_EXTRA: { before: Row[]; after: Row[] } = { before: [], after: [] }

/** What the field's text itself can open (an open tab, a file, an address), as rows of their own. */
interface Row {
  item: NewTabItem
  /** Matched characters of the label, drawn in full contrast. */
  marks?: number[]
  /** Remembered among the recent ones when run. */
  remembered: boolean
}

/** With a query: matching open tabs (all only), files and the text as an address (Panel and all). */
function useQueryRows(layoutKey: string, workspaceId: string | null, query: string): { before: Row[]; after: Row[] } {
  const tabs = useWorkspaceTabs(layoutKey)
  const meta = useTabLayout((s) => s.meta)
  const [files, setFiles] = useState<string[]>([])
  useEffect(() => {
    if (!workspaceId) return setFiles([])
    let live = true
    void workspaceFiles(workspaceId).then((list) => live && setFiles(list))
    return () => {
      live = false
    }
  }, [workspaceId])
  return useMemo(() => {
    const q = query.trim()
    if (!q) return { before: [], after: [] }
    const lower = q.toLowerCase()
    const before: Row[] = []
    {
      for (const tab of tabs) {
        const title = tabTitle(tab, meta[tab.id])
        if (!title.toLowerCase().includes(lower) || before.length >= 3) continue
        before.push({
          remembered: false,
          item: {
            pin: null,
            id: `tab:${tab.id}`,
            scope: 'panel',
            icon: <TabKindIcon tab={tab} className="shrink-0" />,
            label: title,
            detail: t('Switch to tab'),
            run: () => {
              const group = groupOfTab(layoutFor(layoutKey), tab.id)
              if (group) activateTab(layoutKey, group.id, tab.id)
            }
          }
        })
      }
    }
    const after: Row[] = []
    if (workspaceId) {
      for (const path of matchFiles(files, q, 5)) {
        after.push({
          remembered: false,
          item: {
            pin: null,
            id: `file:${path}`,
            scope: 'panel',
            icon: <FileIcon name={path} className="size-3.5" />,
            label: path,
            detail: t('Open file'),
            run: () => openEditorTab({ workspaceId, kind: 'file', path, staged: false })
          }
        })
      }
      const search = looksLikeSearchQuery(q)
      const url = normalizeAddress(q)
      after.push({
        remembered: false,
        item: {
          pin: null,
          id: `url:${url}`,
          scope: 'panel',
          icon: search ? <Search className="size-3.5 shrink-0" /> : <Globe className="size-3.5 shrink-0" />,
          label: search ? q : url,
          detail: search ? t('Search Google') : t('Open URL'),
          run: () => openBrowserTab(workspaceId, url)
        }
      })
    }
    return { before, after }
  }, [query, tabs, meta, files, workspaceId, layoutKey])
}

// ── Rows ─────────────────────────────────────────────────────────────────

/** A pin button that does not run the row it sits in. */
function PinButton({ id, pinned, label, shown }: { id: string; pinned: boolean; label: string; shown: boolean }) {
  const name = pinned ? t('Unpin {label}', { label }) : t('Pin {label} to the tab bar', { label })
  return (
    <button
      type="button"
      tabIndex={-1}
      aria-label={name}
      title={name}
      data-new-tab-pin={id}
      data-pinned={pinned ? 'true' : 'false'}
      className={cn(
        'group/pin ml-auto flex size-5 shrink-0 items-center justify-center rounded-sm hover:bg-background/60 hover:text-foreground',
        pinned ? 'text-foreground' : 'text-muted-foreground',
        // Shown on the highlighted row; a pinned row keeps its pin in view.
        !pinned && !shown && 'opacity-0 group-hover/new-tab:opacity-100'
      )}
      onPointerDown={(e) => e.preventDefault()}
      onClick={(e) => {
        e.stopPropagation()
        toggleNewTabPin(id)
      }}
    >
      {/* Pinned shows a filled pin; hovering it shows what pressing does. */}
      {pinned ? (
        <>
          <Pin className="size-3.5 group-hover/pin:hidden" fill="currentColor" />
          <PinOff className="hidden size-3.5 group-hover/pin:block" />
        </>
      ) : (
        <Pin className="size-3.5" />
      )}
    </button>
  )
}

function Marked({ text, marks }: { text: string; marks?: number[] }) {
  if (!marks || marks.length === 0) return <>{text}</>
  const set = new Set(marks)
  return (
    <>
      {Array.from(text).map((char, i) =>
        set.has(i) ? (
          <span key={i} className="font-semibold text-foreground">
            {char}
          </span>
        ) : (
          char
        )
      )}
    </>
  )
}

/** A row of the list: a branch, a leaf of the tree, or (with a query) a match with its path. */
function TreeRow({
  node,
  icon,
  depth,
  path,
  marks,
  open,
  highlighted,
  pins,
  onHover,
  onRun
}: {
  node: { id: string; label: string; entry?: NewTabItem; children?: unknown[] }
  icon?: React.ReactNode
  depth: number
  /** The branches above a search result, shown before its name. */
  path?: string[]
  marks?: number[]
  open?: boolean
  highlighted: boolean
  pins: string[]
  onHover: () => void
  onRun: () => void
}) {
  const item = node.entry
  const branch = Boolean(node.children)
  const disabled = item ? item.disabled === true : (node as Node).children?.every((c) => c.entry?.disabled) === true
  const pinned = item?.pin != null && pins.includes(item.pin)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (highlighted) ref.current?.scrollIntoView({ block: 'nearest' })
  }, [highlighted])
  return (
    <div
      ref={ref}
      role="treeitem"
      aria-selected={highlighted}
      aria-expanded={branch ? open : undefined}
      aria-disabled={disabled || undefined}
      aria-level={depth + 1}
      data-new-tab={item ? (item.pin ?? item.id) : node.id}
      data-new-tab-branch={branch ? node.id : undefined}
      data-highlighted={highlighted || undefined}
      // Why an entry is off is its tooltip, never a line on the row.
      title={disabled && item?.detail ? item.detail : undefined}
      className={cn(
        'group/new-tab flex h-7 cursor-default items-center gap-2 rounded-[7px] pr-2 text-xs outline-none select-none [&_svg]:shrink-0',
        highlighted && 'bg-black/8 text-accent-foreground dark:bg-white/14',
        disabled ? 'text-muted-foreground/60' : 'text-foreground'
      )}
      style={{ paddingLeft: 8 + depth * 14 }}
      onMouseMove={() => !highlighted && onHover()}
      onClick={() => !disabled && onRun()}
    >
      {branch ? (
        <ChevronRight className={cn('size-3 text-muted-foreground transition-transform', open && 'rotate-90')} />
      ) : depth > 0 ? (
        <span className="w-3" aria-hidden />
      ) : null}
      <span className={cn('flex w-4 shrink-0 items-center justify-center text-muted-foreground [&_svg]:size-4', disabled && 'opacity-60')}>{icon ?? item?.icon}</span>
      <span className="min-w-0 flex-1 truncate">
        {path && path.length > 0 ? <span className="text-muted-foreground">{path.join(' › ')} › </span> : null}
        {marks ? <Marked text={item?.label ?? node.label} marks={marks} /> : node.label}
      </span>
      {item?.shortcut && !highlighted ? <span className="shrink-0 text-[11px] text-muted-foreground group-hover/new-tab:hidden">{item.shortcut}</span> : null}
      {item && item.pin !== null && !item.disabled ? <PinButton id={item.pin} pinned={pinned} label={item.short ?? item.label} shown={highlighted} /> : null}
    </div>
  )
}

// ── The quick pick ───────────────────────────────────────────────────────

function QuickPick({
  layoutKey,
  workspaceId,
  onClose,
  nodes,
  path = []
}: {
  layoutKey: string
  workspaceId: string | null
  onClose: () => void
  /** A subtree to show instead of the whole tree (the Terminal pin's menu), and the path above it. */
  nodes?: Node[]
  path?: string[]
}) {
  const [query, setQuery] = useState('')
  const [highlight, setHighlight] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  const pins = useNewTabPins()
  const recent = recentItems.use((list) => list)
  const openList = openBranches.use((list) => list)
  const open = useMemo(() => new Set(openList), [openList])
  const fullTree = useTree(workspaceId, pins)
  const tree = nodes ?? fullTree
  const typed = useQueryRows(layoutKey, workspaceId, query)
  const extra = nodes ? NO_EXTRA : typed
  const searching = query.trim() !== ''

  /** The rows on show: the tree, or with a query the open tabs, the matching leaves, then files and the address. */
  const rows = useMemo((): (PickRow<NewTabItem> & { extra?: Row })[] => {
    if (!searching) return treeRows(tree, open, 0, path)
    const asRow = (row: Row): PickRow<NewTabItem> & { extra: Row } => ({
      node: { id: row.item.id, label: row.item.label, entry: row.item },
      depth: 0,
      path: [],
      parentId: null,
      marks: row.marks,
      extra: row
    })
    const matches = searchRows(tree, query, { pins, recent, pinOf: (item) => item.pin }).map((row) => ({ ...row, path: [...path, ...row.path] }))
    return [...extra.before.map(asRow), ...matches, ...extra.after.map(asRow)]
  }, [searching, tree, open, query, pins, recent, extra, path])
  const active = Math.min(highlight, Math.max(0, rows.length - 1))

  useEffect(() => {
    const timer = setTimeout(() => input.current?.focus(), 0)
    return () => clearTimeout(timer)
  }, [])

  const setOpen = (next: ReadonlySet<string>) => openBranches.update(() => [...next])
  const toggleBranch = (id: string) => {
    const next = new Set(open)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setOpen(next)
  }

  const run = (row: (typeof rows)[number] | undefined) => {
    if (!row) return
    if (row.node.children) return toggleBranch(row.node.id)
    const item = row.node.entry
    if (!item || item.disabled) return
    const remembered = row.extra ? row.extra.remembered : true
    if (remembered && !item.lead && item.id !== 'refresh-agents') recentItems.update((list) => pushRecent(list, item.id))
    if (item.id === 'refresh-agents') {
      item.run()
      return
    }
    onClose()
    item.run()
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (isImeOwnedKeyboardEvent(e)) return
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      if (rows.length > 0) setHighlight((active + (e.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length)
    } else if ((e.key === 'ArrowRight' || e.key === 'ArrowLeft') && !searching) {
      e.preventDefault()
      const next = treeKey(rows, active, e.key, open)
      if (next.open !== open) setOpen(next.open)
      setHighlight(next.active)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      run(rows[active])
    } else if (e.altKey && e.code === 'KeyP') {
      e.preventDefault()
      const item = rows[active]?.node.entry
      if (item?.pin && !item.disabled) toggleNewTabPin(item.pin)
    }
  }

  // A subtree's menu is named by its branch; the whole tree also finds tabs, files and addresses.
  const placeholder = nodes && path.length > 0 ? path.join(' › ') : t('Search open tabs, files, URLs, agents…')
  return (
    <div data-new-tab-pick onKeyDown={(e) => e.key !== 'Escape' && e.stopPropagation()}>
      <div className="flex items-center gap-1 border-b border-border/70 px-2">
        <input
          ref={input}
          data-tab-omnibox
          value={query}
          role="combobox"
          aria-expanded
          aria-controls="new-tab-pick-list"
          aria-label={placeholder}
          placeholder={placeholder}
          className="h-9 min-w-0 flex-1 bg-transparent text-xs text-foreground outline-none placeholder:text-muted-foreground"
          onChange={(e) => {
            setQuery(e.target.value)
            setHighlight(0)
          }}
          onKeyDown={onKeyDown}
        />
      </div>
      <div id="new-tab-pick-list" role="tree" className="max-h-[min(380px,60vh)] overflow-y-auto p-1">
        {rows.map((row, at) => (
          <TreeRow
            key={`${row.parentId ?? ''}/${row.node.id}`}
            node={row.node}
            icon={(row.node as Node).icon}
            depth={searching ? 0 : row.depth}
            path={searching ? row.path : undefined}
            marks={searching ? row.marks : undefined}
            open={open.has(row.node.id)}
            highlighted={at === active}
            pins={pins}
            onHover={() => setHighlight(at)}
            onRun={() => run(row)}
          />
        ))}
      </div>
    </div>
  )
}

export function NewTabMenu({ layoutKey, workspaceId, groupId }: { layoutKey: string; workspaceId: string | null; groupId: string }) {
  const [open, setOpen] = useState(false)
  return (
    <Popover
      modal={false}
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        // New tabs join the focused group, so the group whose "+" was used takes focus first.
        if (next) focusGroup(layoutKey, groupId)
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={t('New tab')}
          title={t('New tab')}
          data-new-tab-button
          className="my-auto ml-2 flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent/50 hover:text-foreground focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
        >
          <Plus className="size-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={6}
        className="w-96 max-w-[calc(100vw-1rem)] gap-0 overflow-hidden rounded-[11px] border-border/80 p-0 shadow-[0_16px_36px_rgba(0,0,0,0.24)]"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <QuickPick layoutKey={layoutKey} workspaceId={workspaceId} onClose={() => setOpen(false)} />
      </PopoverContent>
    </Popover>
  )
}

/**
 * The pinned Terminal button (docs/specs/panes-as-workspaces.md): a click opens the Terminal branch
 * as a small menu, the default shell of the pane's host first and highlighted, so Enter opens it.
 */
export function TerminalPinMenu({ layoutKey, workspaceId, groupId }: { layoutKey: string; workspaceId: string | null; groupId: string }) {
  const [open, setOpen] = useState(false)
  const { branch, defaultShell } = useTerminalBranch(workspaceId)
  const nodes = useMemo(() => {
    if (!defaultShell) return branch
    // The default shell first; under a host branch it is listed there too.
    const top: Node = { ...defaultShell, id: `default:${defaultShell.id}` }
    return [top, ...branch.filter((n) => n.id !== defaultShell.id)]
  }, [branch, defaultShell])
  return (
    <Popover
      modal={false}
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (next) focusGroup(layoutKey, groupId)
      }}
    >
      <ContextMenu modal={false}>
        <ContextMenuTrigger asChild>
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label={t('New Terminal')}
              title={t('New Terminal')}
              data-pinned-tab="terminal"
              className="my-auto ml-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent/50 hover:text-foreground focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none [&_svg]:size-3.5"
            >
              <SquareTerminal />
            </button>
          </PopoverTrigger>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem data-unpin-tab="terminal" onSelect={() => unpinNewTabItem('terminal')}>
            <PinOff className="size-4" />
            {t('Unpin')}
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
      <PopoverContent
        align="start"
        sideOffset={6}
        className="w-80 max-w-[calc(100vw-1rem)] gap-0 overflow-hidden rounded-[11px] border-border/80 p-0 shadow-[0_16px_36px_rgba(0,0,0,0.24)]"
        onOpenAutoFocus={(e) => e.preventDefault()}
        data-terminal-pin-menu
      >
        <QuickPick layoutKey={layoutKey} workspaceId={workspaceId} nodes={nodes} path={[t('Terminal')]} onClose={() => setOpen(false)} />
      </PopoverContent>
    </Popover>
  )
}
