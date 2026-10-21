import { Globe, Plus, SquareTerminal } from 'lucide-react'
import { createSession } from '@/daemon-connection'
import { LOCAL_HOST, allWorkspaces, useStore } from '@/session-store'
import { ClaudeIcon } from '@/components/agent-icons'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { focusGroup } from './tab-group-commands'
import { shortcutLabel } from './tab-shortcuts'
import { newTerminalTab, openBrowserTab } from './workspace-tab-model'

// Orca's "+" menu (tab-bar-static-create-menu.tsx). One section per kind of tab; add a new kind as
// its own section so the menu stays easy to extend.

function AgentSection({ workspaceId }: { workspaceId: string }) {
  return (
    <DropdownMenuItem data-new-tab="claude" onSelect={() => void createSession(workspaceId)}>
      <ClaudeIcon size={14} />
      New Claude Chat
    </DropdownMenuItem>
  )
}

function TerminalSection({ workspaceId }: { workspaceId: string }) {
  const hostId = useStore((s) => allWorkspaces(s).find((w) => w.id === workspaceId)?.hostId ?? LOCAL_HOST)
  const shells = useStore((s) => s.hosts[hostId]?.shells) ?? []
  return (
    <>
      <DropdownMenuLabel className="text-xs text-muted-foreground">Terminal</DropdownMenuLabel>
      {shells.map((shell) => (
        <DropdownMenuItem
          key={shell.id}
          data-new-tab={`terminal:${shell.id}`}
          onSelect={() => void newTerminalTab(workspaceId, shell.id)}
        >
          <SquareTerminal className="size-4" />
          New Terminal ({shell.label})
        </DropdownMenuItem>
      ))}
    </>
  )
}

function BrowserSection({ workspaceId }: { workspaceId: string }) {
  return (
    <DropdownMenuItem data-new-tab="browser" onSelect={() => openBrowserTab(workspaceId)}>
      <Globe className="size-4" />
      New Browser Tab
      <DropdownMenuShortcut>{shortcutLabel('tab.newBrowser')}</DropdownMenuShortcut>
    </DropdownMenuItem>
  )
}

export function NewTabMenu({ workspaceId, groupId }: { workspaceId: string; groupId: string }) {
  return (
    <DropdownMenu
      modal={false}
      // New tabs join the focused group, so the group whose "+" was used takes focus first.
      onOpenChange={(open) => open && focusGroup(workspaceId, groupId)}
    >
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="New tab"
          title="New tab"
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
        <AgentSection workspaceId={workspaceId} />
        <DropdownMenuSeparator />
        <TerminalSection workspaceId={workspaceId} />
        <DropdownMenuSeparator />
        <BrowserSection workspaceId={workspaceId} />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
