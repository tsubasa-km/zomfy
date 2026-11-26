import { useState } from 'react'
import { MessageSquarePlus, Pin, PinOff, Plus, RefreshCw, Server } from 'lucide-react'
import { LOCAL_HOST, allWorkspaces, useStore } from '@/session-store'
import { openSshConnectionsDialog } from '@/lib/ssh-connections'
import { loadDetectedAgents } from '@/lib/detected-agents'
import { cn } from '@/lib/utils'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { requestAgentLaunchDialog } from '@/components/terminal/AgentLaunchDialog'
import { TabOmnibox } from './TabOmnibox'
import { focusGroup } from './tab-group-commands'
import {
  toggleNewTabPin,
  useBrowserItems,
  useChatItems,
  useCommandItems,
  useNewTabPins,
  usePanelItems,
  useSshItems,
  useTerminalItems,
  useTuiAgentItems,
  useWorkflowItems,
  type NewTabItem
} from './new-tab-items'
import { t } from '@/i18n/i18n'

// The tab strip's "+" menu (docs/specs/new-tab-menu-and-pins.md), from Orca's
// tab-bar-static-create-menu.tsx. One section per kind of tab, each from its hook in
// new-tab-items.tsx; any item with a pin id can be pinned beside "+" from its row.

const sectionLabel = 'text-xs text-muted-foreground'

/** A pin button that does not select the row it sits in, nor close the menu. */
function PinButton({ id, pinned, label }: { id: string; pinned: boolean; label: string }) {
  const stop = (e: React.SyntheticEvent) => {
    e.preventDefault()
    e.stopPropagation()
  }
  const name = pinned ? t('Unpin {label}', { label }) : t('Pin {label} to the tab bar', { label })
  return (
    <button
      type="button"
      aria-label={name}
      title={name}
      data-new-tab-pin={id}
      data-pinned={pinned ? 'true' : 'false'}
      className={cn(
        'ml-auto flex size-5 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:bg-background/60 hover:text-foreground',
        // Shown on the highlighted row; a pinned row keeps its pin in view.
        !pinned && 'opacity-0 group-hover/new-tab:opacity-100 group-data-[highlighted]/new-tab:opacity-100'
      )}
      onPointerDown={stop}
      onPointerUp={stop}
      onClick={(e) => {
        stop(e)
        toggleNewTabPin(id)
      }}
    >
      {pinned ? <PinOff className="size-3.5" /> : <Pin className="size-3.5" />}
    </button>
  )
}

function ItemRow({ item, pins }: { item: NewTabItem; pins: string[] }) {
  const pinned = item.pin !== null && pins.includes(item.pin)
  return (
    <DropdownMenuItem
      data-new-tab={item.pin ?? undefined}
      disabled={item.disabled}
      title={item.detail}
      className="group/new-tab"
      onSelect={item.run}
    >
      {item.icon}
      {item.detail ? (
        <span className="flex min-w-0 flex-col">
          <span>{item.label}</span>
          <span className="truncate text-xs text-muted-foreground">{item.detail}</span>
        </span>
      ) : (
        <span className="min-w-0 flex-1 truncate">{item.label}</span>
      )}
      {item.shortcut ? <DropdownMenuShortcut className="group-hover/new-tab:hidden group-data-[highlighted]/new-tab:hidden">{item.shortcut}</DropdownMenuShortcut> : null}
      {item.pin !== null && !item.disabled ? <PinButton id={item.pin} pinned={pinned} label={item.short ?? item.label} /> : null}
    </DropdownMenuItem>
  )
}

function Rows({ items, pins }: { items: NewTabItem[]; pins: string[] }) {
  return (
    <>
      {items.map((item, index) => (
        <ItemRow key={item.pin ?? index} item={item} pins={pins} />
      ))}
    </>
  )
}

function AgentSection({ workspaceId, pins }: { workspaceId: string; pins: string[] }) {
  const hostId = useStore((s) => allWorkspaces(s).find((w) => w.id === workspaceId)?.hostId ?? LOCAL_HOST)
  const { detected, items } = useTuiAgentItems(workspaceId)
  return (
    <>
      <DropdownMenuSeparator />
      <DropdownMenuLabel className={sectionLabel}>{t('Agents')}</DropdownMenuLabel>
      {items.length === 0 && (
        <DropdownMenuItem disabled className="text-muted-foreground">
          {detected.kind === 'loading'
            ? t('Looking for agents…')
            : detected.kind === 'failed'
              ? t('Can’t reach this workspace’s host to list its agents')
              : t('No agents detected')}
        </DropdownMenuItem>
      )}
      <Rows items={items} pins={pins} />
      {items.length > 0 && (
        <DropdownMenuItem data-launch-agent-prompt onSelect={() => requestAgentLaunchDialog(workspaceId)}>
          <MessageSquarePlus />
          {t('Launch Agent with Prompt…')}
        </DropdownMenuItem>
      )}
      <DropdownMenuItem
        className="text-muted-foreground"
        onSelect={(event) => {
          // Keep the menu open so the refreshed list shows in place.
          event.preventDefault()
          void loadDetectedAgents(hostId, true)
        }}
      >
        <RefreshCw />
        {t('Refresh Agents')}
      </DropdownMenuItem>
    </>
  )
}

function CommandSection({ workspaceId, pins }: { workspaceId: string; pins: string[] }) {
  const items = useCommandItems(workspaceId)
  if (items.length === 0) return null
  return (
    <>
      <DropdownMenuSeparator />
      <DropdownMenuLabel className={sectionLabel}>{t('Commands')}</DropdownMenuLabel>
      <Rows items={items} pins={pins} />
    </>
  )
}

function WorkflowSection({ workspaceId, pins }: { workspaceId: string; pins: string[] }) {
  const items = useWorkflowItems(workspaceId, true)
  if (items.length === 0) return null
  return (
    <>
      <DropdownMenuSeparator />
      <DropdownMenuLabel className={sectionLabel}>{t('Workflows')}</DropdownMenuLabel>
      <Rows items={items} pins={pins} />
    </>
  )
}

/** The host's saved SSH logins, each a tab in one click, and the list that manages them. */
function SshSection({ workspaceId, pins }: { workspaceId: string; pins: string[] }) {
  const items = useSshItems(workspaceId)
  return (
    <>
      {items.length > 0 ? <DropdownMenuLabel className={sectionLabel}>{t('SSH')}</DropdownMenuLabel> : null}
      <Rows items={items.slice(0, 8)} pins={pins} />
      <DropdownMenuItem data-new-tab="ssh-connections" onSelect={() => openSshConnectionsDialog(workspaceId)}>
        <Server className="size-4" />
        {t('SSH connections…')}
      </DropdownMenuItem>
    </>
  )
}

function MenuSections({ workspaceId }: { workspaceId: string }) {
  const pins = useNewTabPins()
  const chats = useChatItems(workspaceId)
  const terminal = useTerminalItems(workspaceId)
  const browser = useBrowserItems(workspaceId)
  const panels = usePanelItems(workspaceId)
  return (
    <>
      <DropdownMenuSeparator />
      <Rows items={chats} pins={pins} />
      <DropdownMenuSeparator />
      <DropdownMenuLabel className={sectionLabel}>{t('Terminal')}</DropdownMenuLabel>
      <Rows items={terminal} pins={pins} />
      <AgentSection workspaceId={workspaceId} pins={pins} />
      <CommandSection workspaceId={workspaceId} pins={pins} />
      <WorkflowSection workspaceId={workspaceId} pins={pins} />
      <DropdownMenuSeparator />
      <SshSection workspaceId={workspaceId} pins={pins} />
      <DropdownMenuSeparator />
      <Rows items={browser} pins={pins} />
      <DropdownMenuSeparator />
      <DropdownMenuLabel className={sectionLabel}>{t('Panels')}</DropdownMenuLabel>
      <Rows items={panels} pins={pins} />
    </>
  )
}

export function NewTabMenu({ workspaceId, groupId }: { workspaceId: string; groupId: string }) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  return (
    <DropdownMenu
      modal={false}
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        setQuery('')
        // New tabs join the focused group, so the group whose "+" was used takes focus first.
        if (next) focusGroup(workspaceId, groupId)
      }}
    >
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={t('New tab')}
          title={t('New tab')}
          className="my-auto ml-2 flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent/50 hover:text-foreground"
        >
          <Plus className="size-3.5" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        sideOffset={6}
        className="w-72 max-w-[calc(100vw-1rem)] rounded-[11px] border-border/80 p-1 shadow-[0_16px_36px_rgba(0,0,0,0.24)]"
      >
        <TabOmnibox workspaceId={workspaceId} query={query} onQueryChange={setQuery} onDone={() => setOpen(false)} />
        {/* While the omnibox has a query its results replace the fixed items, as in Orca. */}
        {query.trim() === '' && <MenuSections workspaceId={workspaceId} />}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
