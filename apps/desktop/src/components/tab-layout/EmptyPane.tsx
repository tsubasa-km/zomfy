import { Globe, SquarePen, SquareTerminal } from 'lucide-react'
import { createSession } from '@/daemon-connection'
import { allWorkspaces, useStore } from '@/session-store'
import { defaultChatAgent } from '@/lib/default-chat-agent'
import { focusGroup } from './tab-group-commands'
import { newTerminalTab, openBrowserTab, openPanelTab } from './workspace-tab-model'
import { SurfaceList, type Surface } from './SurfaceList'
import { PANELS } from './workspace-panels'
import { t } from '@/i18n/i18n'

// What a pane with no tabs offers: the things a pane can show (SurfaceList). The + in the tab strip
// has the rest (other agents, shells, plugin panels).

export function EmptyPane({ workspaceId, groupId, hint }: { workspaceId: string; groupId: string; hint: string }) {
  // Changes and pull requests only exist for a git checkout.
  const git = useStore((s) => Boolean(allWorkspaces(s).find((w) => w.id === workspaceId)?.branch))
  // New tabs join the focused group, so this pane takes focus before one opens.
  const start = (open: () => void) => () => {
    focusGroup(workspaceId, groupId)
    open()
  }
  // The panels a pane most often starts from, under the names their icons carry elsewhere.
  const panel = (id: string, key: string, gitOnly = false): Surface[] =>
    PANELS.filter((p) => p.id === id).map(({ label, icon: Icon }) => ({
      id,
      key,
      label,
      icon: <Icon className="size-4" />,
      open: start(() => openPanelTab(workspaceId, id)),
      unavailable: gitOnly && !git
    }))
  const surfaces: Surface[] = [
    { id: 'thread', key: 'N', label: t('New thread'), icon: <SquarePen className="size-4" />, open: start(() => void createSession(workspaceId, defaultChatAgent())) },
    { id: 'terminal', key: 'T', label: t('Terminal'), icon: <SquareTerminal className="size-4" />, open: start(() => void newTerminalTab(workspaceId)) },
    { id: 'browser', key: 'B', label: t('Browser'), icon: <Globe className="size-4" />, open: start(() => openBrowserTab(workspaceId)) },
    ...panel('panel:explorer', 'F'),
    ...panel('panel:search', '/'),
    ...panel('panel:source-control', 'D', true),
    ...panel('panel:checks', 'P', true)
  ]
  return (
    <div data-empty-pane className="flex min-h-0 flex-1 flex-col">
      <SurfaceList surfaces={surfaces} title={hint} />
    </div>
  )
}
