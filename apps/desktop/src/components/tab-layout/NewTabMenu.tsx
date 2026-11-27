import { useEffect, useMemo, useRef, useState } from 'react'
import { Bot, Globe, MessageSquarePlus, PanelsTopLeft, Pin, PinOff, Plus, RefreshCw, Search, Server, SquareTerminal } from 'lucide-react'
import { LOCAL_HOST, allWorkspaces, openEditorTab, useStore } from '@/session-store'
import { openSshConnectionsDialog } from '@/lib/ssh-connections'
import { loadDetectedAgents } from '@/lib/detected-agents'
import { isImeOwnedKeyboardEvent } from '@/lib/ime-composition-keyboard-event'
import { nextScope, orderEntries, PICK_SCOPES, pushRecent, takeScopePrefix, type PickScope } from '@/lib/new-tab-pick'
import { cn } from '@/lib/utils'
import { createExternalStore } from '@/stores/external-store'
import { looksLikeSearchQuery, normalizeAddress } from '@/stores/browser-tab-store'
import { groupOfTab, layoutFor, useTabLayout } from '@/stores/tab-layout-store'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { FileIcon } from '@/components/FileIcon'
import { requestAgentLaunchDialog } from '@/components/terminal/AgentLaunchDialog'
import { TabKindIcon } from './TabKindIcon'
import { focusGroup } from './tab-group-commands'
import { matchFiles, workspaceFiles } from './workspace-file-index'
import { activateTab, openBrowserTab, tabTitle, useWorkspaceTabs } from './workspace-tab-model'
import {
  toggleNewTabPin,
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

// The tab strip's "+": a quick pick, as VS Code's (docs/specs/panes-as-workspaces.md). One field,
// three scopes to narrow by, pinned and recent items first; every item opens in the pane's
// workspace. Pins are as in docs/specs/new-tab-menu-and-pins.md.

const SCOPE_ICON: Record<PickScope, typeof SquareTerminal> = { terminal: SquareTerminal, agent: Bot, panel: PanelsTopLeft }
const scopeName = (scope: PickScope) => (scope === 'terminal' ? t('Terminal') : scope === 'agent' ? t('Agent') : t('Panel'))

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

/** A row: an item, or what the field's text itself can open (an open tab, a file, an address). */
interface Row {
  item: NewTabItem
  /** Matched characters of the label, drawn in full contrast. */
  marks?: number[]
  /** Remembered among the recent ones when run. */
  remembered: boolean
  /** Keeps the quick pick open when run. */
  keepOpen?: boolean
}

/** Every item the pane's "+" offers, each with its scope. */
function useAllItems(workspaceId: string | null): NewTabItem[] {
  const hostId = useStore((s) => allWorkspaces(s).find((w) => w.id === workspaceId)?.hostId ?? LOCAL_HOST)
  const newThread = useNewThreadItem(workspaceId)
  const chats = useChatItems(workspaceId)
  const terminal = useTerminalItems(workspaceId)
  const { detected, items: tuiAgents } = useTuiAgentItems(workspaceId)
  const commands = useCommandItems(workspaceId)
  const workflows = useWorkflowItems(workspaceId, true)
  const ssh = useSshItems(workspaceId)
  const browser = useBrowserItems(workspaceId)
  const panels = usePanelItems(workspaceId)
  return useMemo(() => {
    const agentActions: NewTabItem[] = []
    if (workspaceId) {
      if (tuiAgents.length === 0) {
        agentActions.push({
          pin: null,
          id: 'agents-status',
          scope: 'agent',
          disabled: true,
          icon: <Bot className="size-4" />,
          label:
            detected.kind === 'loading'
              ? t('Looking for agents…')
              : detected.kind === 'failed'
                ? t('Can’t reach this workspace’s host to list its agents')
                : t('No agents detected'),
          run: () => undefined
        })
      } else {
        agentActions.push({
          pin: null,
          id: 'launch-agent-prompt',
          scope: 'agent',
          keywords: 'launch agent with prompt',
          icon: <MessageSquarePlus className="size-4" />,
          label: t('Launch Agent with Prompt…'),
          run: () => requestAgentLaunchDialog(workspaceId)
        })
      }
      agentActions.push({
        pin: null,
        id: 'refresh-agents',
        scope: 'agent',
        keywords: 'refresh agents detect',
        icon: <RefreshCw className="size-4" />,
        label: t('Refresh Agents'),
        run: () => void loadDetectedAgents(hostId, true)
      })
    }
    const sshList: NewTabItem[] = workspaceId
      ? [
          ...ssh,
          {
            pin: null,
            id: 'ssh-connections',
            scope: 'terminal',
            keywords: 'ssh connections remote',
            icon: <Server className="size-4" />,
            label: t('SSH connections…'),
            run: () => openSshConnectionsDialog(workspaceId)
          }
        ]
      : []
    return [newThread, ...terminal, ...commands, ...sshList, ...chats, ...tuiAgents, ...workflows, ...agentActions, ...browser, ...panels]
  }, [workspaceId, hostId, newThread, chats, terminal, detected, tuiAgents, commands, workflows, ssh, browser, panels])
}

/** With a query: matching open tabs (all only), files and the text as an address (Panel and all). */
function useQueryRows(layoutKey: string, workspaceId: string | null, query: string, scope: PickScope | null): { before: Row[]; after: Row[] } {
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
    if (scope === null) {
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
    if (workspaceId && (scope === null || scope === 'panel')) {
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
  }, [query, scope, tabs, meta, files, workspaceId, layoutKey])
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

function PickRow({
  row,
  highlighted,
  pins,
  onHover,
  onRun
}: {
  row: Row
  highlighted: boolean
  pins: string[]
  onHover: () => void
  onRun: () => void
}) {
  const { item } = row
  const pinned = item.pin !== null && pins.includes(item.pin)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (highlighted) ref.current?.scrollIntoView({ block: 'nearest' })
  }, [highlighted])
  return (
    <div
      ref={ref}
      role="option"
      aria-selected={highlighted}
      aria-disabled={item.disabled || undefined}
      data-new-tab={item.pin ?? item.id}
      data-highlighted={highlighted || undefined}
      title={item.detail}
      className={cn(
        'group/new-tab flex min-h-7 cursor-default items-center gap-2 rounded-[7px] px-2 py-1 text-xs outline-none select-none [&_svg]:shrink-0',
        highlighted && 'bg-black/8 text-accent-foreground dark:bg-white/14',
        item.disabled ? 'text-muted-foreground' : 'text-foreground'
      )}
      onMouseMove={() => !highlighted && onHover()}
      onClick={() => !item.disabled && onRun()}
    >
      <span className="flex w-4 shrink-0 items-center justify-center text-muted-foreground [&_svg]:size-4">{item.icon}</span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate">
          <Marked text={item.label} marks={row.marks} />
        </span>
        {item.detail ? <span className="truncate text-[11px] text-muted-foreground">{item.detail}</span> : null}
      </span>
      {item.shortcut && !highlighted ? <span className="shrink-0 text-[11px] text-muted-foreground group-hover/new-tab:hidden">{item.shortcut}</span> : null}
      {item.pin !== null && !item.disabled ? <PinButton id={item.pin} pinned={pinned} label={item.short ?? item.label} shown={highlighted} /> : null}
    </div>
  )
}

// ── The quick pick ───────────────────────────────────────────────────────

function QuickPick({ layoutKey, workspaceId, onClose }: { layoutKey: string; workspaceId: string | null; onClose: () => void }) {
  const [query, setQuery] = useState('')
  const [scope, setScope] = useState<PickScope | null>(null)
  const [highlight, setHighlight] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  const pins = useNewTabPins()
  const recent = recentItems.use((list) => list)
  const items = useAllItems(workspaceId)
  const extra = useQueryRows(layoutKey, workspaceId, query, scope)

  const groups = useMemo((): Row[][] => {
    const { groups, matches } = orderEntries(items, { query, scope, pins, recent })
    const listed = groups.map((group) => group.map((item): Row => ({ item, marks: matches.get(item.id), remembered: true })))
    return [extra.before, ...listed, extra.after].filter((g) => g.length > 0)
  }, [items, query, scope, pins, recent, extra])
  const rows = useMemo(() => groups.flat(), [groups])
  const active = Math.min(highlight, Math.max(0, rows.length - 1))

  useEffect(() => {
    const timer = setTimeout(() => input.current?.focus(), 0)
    return () => clearTimeout(timer)
  }, [])

  const pickScope = (next: PickScope | null) => {
    setScope(next)
    setHighlight(0)
    input.current?.focus()
  }

  const run = (row: Row | undefined) => {
    if (!row || row.item.disabled) return
    if (row.remembered && !row.item.lead && row.item.id !== 'refresh-agents') recentItems.update((list) => pushRecent(list, row.item.id))
    if (row.item.id === 'refresh-agents') {
      row.item.run()
      return
    }
    onClose()
    row.item.run()
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (isImeOwnedKeyboardEvent(e)) return
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      if (rows.length > 0) setHighlight((active + (e.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      run(rows[active])
    } else if (e.key === 'Tab') {
      e.preventDefault()
      pickScope(nextScope(scope, e.shiftKey ? -1 : 1))
    } else if (e.key === 'Backspace' && query === '' && scope !== null) {
      e.preventDefault()
      pickScope(null)
    } else if (e.altKey && e.code === 'KeyP') {
      e.preventDefault()
      const pin = rows[active]?.item.pin
      if (pin && !rows[active]!.item.disabled) toggleNewTabPin(pin)
    }
  }

  const placeholder = scope ? scopeName(scope) : t('Search open tabs, files, URLs, agents…')
  let index = -1
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
            const value = e.target.value
            const prefixed = query === '' ? takeScopePrefix(value) : null
            if (prefixed) {
              setScope(prefixed.scope)
              setQuery(prefixed.query)
            } else setQuery(value)
            setHighlight(0)
          }}
          onKeyDown={onKeyDown}
        />
        <div role="radiogroup" aria-label={t('Scope')} className="flex shrink-0 items-center gap-0.5">
          {PICK_SCOPES.map((s) => {
            const Icon = SCOPE_ICON[s]
            const on = scope === s
            return (
              <button
                key={s}
                type="button"
                role="radio"
                tabIndex={-1}
                aria-checked={on}
                aria-label={scopeName(s)}
                title={scopeName(s)}
                data-new-tab-scope={s}
                data-on={on || undefined}
                className={cn(
                  'flex size-6 items-center justify-center rounded-md transition-colors',
                  on ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground'
                )}
                onPointerDown={(e) => e.preventDefault()}
                onClick={() => pickScope(on ? null : s)}
              >
                <Icon className="size-3.5" />
              </button>
            )
          })}
        </div>
      </div>
      <div id="new-tab-pick-list" role="listbox" className="max-h-[min(380px,60vh)] overflow-y-auto p-1">
        {groups.map((group, g) => (
          <div key={g} role="group" className={cn(g > 0 && 'mt-1 border-t border-border/60 pt-1')}>
            {group.map((row) => {
              index += 1
              const at = index
              return (
                <PickRow
                  key={row.item.id}
                  row={row}
                  highlighted={at === active}
                  pins={pins}
                  onHover={() => setHighlight(at)}
                  onRun={() => run(row)}
                />
              )
            })}
          </div>
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
