import { Bot, Files, GitCompare, ListChecks, MessagesSquare, Plug, PlugZap, Search, Workflow, type LucideIcon } from 'lucide-react'
import { allWorkspaces, useStore } from '@/session-store'
import { FileExplorer } from '@/components/right-sidebar/FileExplorer'
import { SearchPanel } from '@/components/right-sidebar/SearchPanel'
import { SourceControl } from '@/components/right-sidebar/SourceControl'
import { ChecksPanel } from '@/components/right-sidebar/checks/ChecksPanel'
import { PortsPanel } from '@/components/right-sidebar/PortsPanel'
import { SideChatPanel } from '@/components/right-sidebar/SideChatPanel'
import { AgentPanel } from '@/components/right-sidebar/AgentPanel'
import { WorkflowsPanel } from '@/components/right-sidebar/WorkflowsPanel'
import { PluginPanel } from '@/components/right-sidebar/PluginPanel'
import { useActivePluginPanels } from '@/plugins/plugin-registry'
import { resolvePluginPanelIcon } from '@/plugins/plugin-panel-icons'
import { t } from '@/i18n/i18n'

// A workspace's panels (once the right sidebar's): shown in a pane's pull-down drawer, or as a tab of
// their own. A panel id is `panel:<name>` for a built-in one, `plugin:<tab>` for a plugin's.

export interface WorkspacePanel {
  id: string
  label: string
  icon: LucideIcon
}

export const PANELS: WorkspacePanel[] = [
  { id: 'panel:explorer', label: t('Explorer'), icon: Files },
  { id: 'panel:search', label: t('Search'), icon: Search },
  { id: 'panel:source-control', label: t('Source Control'), icon: GitCompare },
  { id: 'panel:checks', label: t('Checks'), icon: ListChecks },
  { id: 'panel:ports', label: t('Ports'), icon: Plug },
  { id: 'panel:side-chat', label: t('Side chat'), icon: MessagesSquare },
  { id: 'panel:agent', label: t('Agent'), icon: Bot },
  { id: 'panel:workflows', label: t('Workflows'), icon: Workflow }
]

/** The built-in panels, then the enabled plugins' ones. */
export function useWorkspacePanels(): WorkspacePanel[] {
  const plugins = useActivePluginPanels()
  return [
    ...PANELS,
    ...plugins.map((p) => ({ id: `plugin:${p.tab}`, label: `${p.title} · ${p.pluginName}`, icon: resolvePluginPanelIcon(p.icon) }))
  ]
}

/** A panel's label and icon, also for a plugin panel that is gone (its tab can still be closed). */
export function useWorkspacePanel(id: string): WorkspacePanel {
  const found = useWorkspacePanels().find((p) => p.id === id)
  return found ?? { id, label: t('Panel'), icon: PlugZap }
}

/** Label for places outside React (a tab title): built-in names only, a plugin panel reads "Panel". */
export function panelLabel(id: string): string {
  return PANELS.find((p) => p.id === id)?.label ?? t('Panel')
}

export function WorkspacePanelView({ id, workspaceId }: { id: string; workspaceId: string }) {
  const name = useStore((s) => allWorkspaces(s).find((w) => w.id === workspaceId)?.name ?? '')
  const plugin = useActivePluginPanels().find((p) => `plugin:${p.tab}` === id)
  if (plugin) return <PluginPanel key={`${plugin.tab}:${workspaceId}`} panel={plugin} workspaceId={workspaceId} />
  switch (id) {
    case 'panel:explorer':
      return <FileExplorer key={workspaceId} workspaceId={workspaceId} rootName={name} />
    case 'panel:search':
      return <SearchPanel key={workspaceId} workspaceId={workspaceId} />
    case 'panel:source-control':
      return <SourceControl key={workspaceId} workspaceId={workspaceId} />
    case 'panel:checks':
      return <ChecksPanel key={workspaceId} workspaceId={workspaceId} />
    case 'panel:ports':
      return <PortsPanel key={workspaceId} workspaceId={workspaceId} />
    case 'panel:side-chat':
      return <SideChatPanel key={workspaceId} workspaceId={workspaceId} />
    case 'panel:agent':
      return <AgentPanel key={workspaceId} workspaceId={workspaceId} />
    case 'panel:workflows':
      return <WorkflowsPanel key={workspaceId} workspaceId={workspaceId} />
    default:
      return <div className="m-auto px-4 text-center text-sm text-muted-foreground">{t('This panel is no longer available.')}</div>
  }
}
