import type { ReactNode } from 'react'
import { GitBranch, PanelsTopLeft, Settings, ZoomIn } from 'lucide-react'
import {
  findWorkspace,
  floatingWorkspaceId,
  getState,
  setDashboardOpen,
  setFloating,
  setRightSidebar,
  useStore
} from '@/session-store'
import { openSettings } from '@/stores/app-overlay-store'
import { setSetting, useSetting } from '@/stores/settings-store'
import { FloatingWorkspaceTriggerMenu } from '@/components/floating-workspace/FloatingWorkspaceTriggerMenu'
import { useFloatingWorkspaceTrigger } from '@/components/floating-workspace/use-floating-workspace-trigger'
import { useShortcutLabel } from '@/keybindings/keybinding-registry'
import { jumpToAgentNeedingYou } from '@/lib/workspace-navigation'
import { zoomPercent } from '@/lib/ui-zoom'
import { AgentQuestionIcon } from '@/components/AgentQuestionIcon'
import { AgentWorkingSpinner } from '@/components/AgentWorkingSpinner'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { HostsMenu } from './HostsMenu'
import { cn } from '@/lib/utils'
import { registerStatusBarItem } from './status-bar-registry'

// Built-in segments, styled like Orca's (SshStatusSegment, the floating-terminal toggle):
// compact text-xs buttons with a hover wash, each with a tooltip.

export function Segment({
  label,
  tooltip,
  onClick,
  children,
  className
}: {
  label: string
  tooltip: ReactNode
  onClick?: () => void
  children: ReactNode
  className?: string
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          onClick={onClick}
          className={cn('inline-flex cursor-pointer items-center gap-1.5 rounded px-1 py-0.5 text-muted-foreground hover:bg-accent/70 hover:text-foreground', className)}
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" sideOffset={6}>
        {tooltip}
      </TooltipContent>
    </Tooltip>
  )
}

function BranchSegment() {
  const workspaceId = useStore((s) => (s.dashboardOpen ? null : s.activeWorkspaceId))
  useStore((s) => s.hosts)
  const workspace = workspaceId ? findWorkspace(workspaceId) : null
  const label = useShortcutLabel('sidebar.sourceControl.toggle')
  if (!workspace) return null
  const text = workspace.branch ?? (workspace.projectId ? 'detached' : 'folder')
  return (
    <Segment
      label={`Branch ${text}`}
      tooltip={`${workspace.displayName ?? workspace.name} · Source Control${label ? ` (${label})` : ''}`}
      onClick={() => setRightSidebar({ open: true, tab: 'source-control' })}
    >
      <GitBranch className="size-3" />
      <span className="max-w-48 truncate" data-status-branch>
        {text}
      </span>
    </Segment>
  )
}

function AgentsSegment() {
  const working = useStore((s) => s.sessions.filter((x) => x.status === 'working').length)
  const waiting = useStore((s) => s.sessions.filter((x) => x.status === 'needs-you').length)
  const total = useStore((s) => s.sessions.length)
  const jump = useShortcutLabel('agent.jumpToNeedsYou')
  const dashboard = useShortcutLabel('dashboard.toggle')
  if (total === 0) return null
  return (
    <Segment
      label="Agents"
      tooltip={
        waiting > 0
          ? `${waiting} waiting on you · click to jump${jump ? ` (${jump})` : ''}`
          : `${total} agent session${total === 1 ? '' : 's'} · open dashboard${dashboard ? ` (${dashboard})` : ''}`
      }
      onClick={() => {
        if (!jumpToAgentNeedingYou()) setDashboardOpen(!getState().dashboardOpen)
      }}
    >
      <span data-status-agents className="inline-flex items-center gap-2">
        {waiting > 0 ? (
          <span className="inline-flex items-center gap-1 text-agent-question">
            <AgentQuestionIcon className="size-3" />
            {waiting}
          </span>
        ) : null}
        <span className="inline-flex items-center gap-1">
          {working > 0 ? <AgentWorkingSpinner className="size-2.5" /> : <span className="inline-block size-2 rounded-full bg-muted-foreground/40" />}
          {working > 0 ? `${working} working` : `${total} idle`}
        </span>
      </span>
    </Segment>
  )
}

function ZoomSegment() {
  const level = useSetting('uiZoomLevel')
  const reset = useShortcutLabel('zoom.reset')
  if (level === 0) return null
  return (
    <Segment label="UI zoom" tooltip={`Reset zoom${reset ? ` (${reset})` : ''}`} onClick={() => setSetting('uiZoomLevel', 0)}>
      <ZoomIn className="size-3" />
      {zoomPercent(level)}%
    </Segment>
  )
}

function FloatingWorkspaceSegment() {
  const floatingId = useStore((s) => floatingWorkspaceId(s))
  const open = useStore((s) => s.floating.open)
  const waiting = useStore((s) => s.sessions.some((x) => x.workspaceId === floatingId && x.status === 'needs-you'))
  const unread = useStore((s) => s.sessions.some((x) => x.workspaceId === floatingId && s.unread[x.id] === true))
  const label = useShortcutLabel('floatingWorkspace.toggle')
  const { statusBar } = useFloatingWorkspaceTrigger()
  // Orca shows this only when the toggle lives in the status bar; otherwise it is the floating button.
  if (!floatingId || !statusBar) return null
  const attention = !open && (waiting || unread)
  return (
    <FloatingWorkspaceTriggerMenu currentLocation="status-bar" className="inline-flex">
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label={attention ? 'Floating workspace, new activity' : 'Floating workspace'}
            aria-pressed={open}
            onClick={() => setFloating({ open: !open })}
            className="relative inline-flex size-5 cursor-pointer items-center justify-center rounded border border-border bg-secondary text-secondary-foreground shadow-xs transition-colors hover:bg-accent hover:text-accent-foreground"
          >
            <PanelsTopLeft className="size-3.5" />
            {attention ? <span aria-hidden className="pointer-events-none absolute top-0.5 right-0.5 size-1.5 rounded-full bg-amber-500 ring-1 ring-secondary" /> : null}
          </button>
        </TooltipTrigger>
        <TooltipContent side="top" sideOffset={6}>
          Floating workspace{label ? ` (${label})` : ''}
        </TooltipContent>
      </Tooltip>
    </FloatingWorkspaceTriggerMenu>
  )
}

function SettingsSegment() {
  const label = useShortcutLabel('app.settings')
  return (
    <Segment label="Settings" tooltip={`Settings${label ? ` (${label})` : ''}`} onClick={() => openSettings()}>
      <Settings className="size-3.5" />
    </Segment>
  )
}

registerStatusBarItem({ id: 'hosts', label: 'Hosts', side: 'left', order: 0, render: () => <HostsMenu /> })
registerStatusBarItem({ id: 'branch', label: 'Branch', side: 'left', order: 10, render: () => <BranchSegment /> })
registerStatusBarItem({ id: 'agents', label: 'Agent activity', side: 'left', order: 20, render: () => <AgentsSegment /> })
registerStatusBarItem({ id: 'zoom', label: 'UI zoom', side: 'right', order: 80, render: () => <ZoomSegment /> })
registerStatusBarItem({ id: 'floating-workspace', label: 'Floating workspace', side: 'right', order: 90, render: () => <FloatingWorkspaceSegment /> })
registerStatusBarItem({ id: 'settings', label: 'Settings', side: 'right', order: 100, pinned: true, render: () => <SettingsSegment /> })
