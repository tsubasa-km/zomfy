import { Files, GitCompare, PanelRightClose, Plug, Search } from 'lucide-react'
import { allWorkspaces, setRightSidebar, useStore } from '@/session-store'
import { useShortcutLabel } from '@/keybindings/keybinding-registry'
import { useGitStatus } from '@/hooks/use-git-status'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { FileExplorer } from './FileExplorer'
import { SourceControl } from './SourceControl'
import { SearchPanel } from './SearchPanel'
import { PortsPanel } from './PortsPanel'
import { cn } from '@/lib/utils'

// Frame and top activity bar follow Orca's right sidebar (right-sidebar/index.tsx,
// right-sidebar-top-activity-bar.tsx, activity-bar-buttons.tsx).

// Shortcuts (sidebar.explorer.toggle etc.) live in the keybinding registry.
function withShortcut(label: string, shortcut: string | null): string {
  return shortcut ? `${label} (${shortcut})` : label
}

export function RightSidebar({ workspaceId }: { workspaceId: string }) {
  const { open, tab } = useStore((s) => s.rightSidebar)
  const workspaceName = useStore((s) => allWorkspaces(s).find((w) => w.id === workspaceId)?.name ?? '')
  const { status } = useGitStatus(open ? null : workspaceId)
  const changeCount = (status?.staged.length ?? 0) + (status?.unstaged.length ?? 0)

  const explorerLabel = withShortcut('Explorer', useShortcutLabel('sidebar.explorer.toggle'))
  const searchLabel = withShortcut('Search', useShortcutLabel('sidebar.search.toggle'))
  const sourceControlLabel = withShortcut('Source Control', useShortcutLabel('sidebar.sourceControl.toggle'))
  const portsLabel = withShortcut('Ports', useShortcutLabel('sidebar.ports.toggle'))

  if (!open) {
    return (
      <div className="flex w-10 shrink-0 flex-col items-center border-l border-sidebar-border bg-sidebar pt-1">
        <ActivityButton icon={Files} label={explorerLabel} onClick={() => setRightSidebar({ open: true, tab: 'explorer' })} />
        <ActivityButton icon={Search} label={searchLabel} onClick={() => setRightSidebar({ open: true, tab: 'search' })} />
        <ActivityButton
          icon={GitCompare}
          label={sourceControlLabel}
          badge={changeCount > 0}
          onClick={() => setRightSidebar({ open: true, tab: 'source-control' })}
        />
        <ActivityButton icon={Plug} label={portsLabel} onClick={() => setRightSidebar({ open: true, tab: 'ports' })} />
      </div>
    )
  }

  return (
    <aside
      data-right-sidebar
      className="flex w-[300px] shrink-0 flex-col overflow-hidden border-l border-sidebar-border bg-sidebar text-sidebar-foreground"
    >
      <div className="flex h-[36px] min-h-[36px] items-center overflow-hidden border-b border-border">
        <ActivityButton
          top
          icon={Files}
          label={explorerLabel}
          active={tab === 'explorer'}
          onClick={() => setRightSidebar({ tab: 'explorer' })}
        />
        <ActivityButton
          top
          icon={Search}
          label={searchLabel}
          active={tab === 'search'}
          onClick={() => setRightSidebar({ tab: 'search' })}
        />
        <ActivityButton
          top
          icon={GitCompare}
          label={sourceControlLabel}
          active={tab === 'source-control'}
          onClick={() => setRightSidebar({ tab: 'source-control' })}
        />
        <ActivityButton top icon={Plug} label={portsLabel} active={tab === 'ports'} onClick={() => setRightSidebar({ tab: 'ports' })} />
        <div className="ml-auto pr-1">
          <ActivityButton top icon={PanelRightClose} label="Close sidebar" onClick={() => setRightSidebar({ open: false })} />
        </div>
      </div>
      {tab === 'explorer' ? (
        <FileExplorer key={workspaceId} workspaceId={workspaceId} rootName={workspaceName} />
      ) : tab === 'search' ? (
        <SearchPanel key={workspaceId} workspaceId={workspaceId} />
      ) : tab === 'ports' ? (
        <PortsPanel key={workspaceId} workspaceId={workspaceId} />
      ) : (
        <SourceControl key={workspaceId} workspaceId={workspaceId} />
      )}
    </aside>
  )
}

function ActivityButton({
  icon: Icon,
  label,
  active,
  top,
  badge,
  onClick
}: {
  icon: React.ComponentType<{ size?: number }>
  label: string
  active?: boolean
  top?: boolean
  badge?: boolean
  onClick: () => void
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          onClick={onClick}
          className={cn(
            'relative flex shrink-0 items-center justify-center transition-colors',
            top ? 'h-[36px] w-9' : 'h-10 w-10',
            active ? 'text-foreground' : 'text-muted-foreground/60 hover:text-muted-foreground'
          )}
        >
          <Icon size={top ? 16 : 18} />
          {badge && <div className="absolute top-[7px] right-[7px] size-[7px] rounded-full bg-agent-question ring-1 ring-sidebar" />}
          {active && top && <div className="absolute right-[25%] bottom-0 left-[25%] h-[2px] rounded-t bg-foreground" />}
        </button>
      </TooltipTrigger>
      <TooltipContent side={top ? 'bottom' : 'left'} sideOffset={6}>
        {label}
      </TooltipContent>
    </Tooltip>
  )
}
