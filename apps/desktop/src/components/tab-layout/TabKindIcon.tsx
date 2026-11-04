import { FileCode2, GitCompare, Globe } from 'lucide-react'
import { TerminalTabIcon } from '@/components/terminal/TerminalTabIcon'
import { TuiAgentIcon } from '@/components/terminal/TuiAgentIcon'
import { sessionAgent } from '@/lib/chat-agents'
import { cn } from '@/lib/utils'
import type { WorkspaceTab } from './workspace-tab-model'
import { useWorkspacePanel } from './workspace-panels'

export function TabKindIcon({ tab, className }: { tab: WorkspaceTab; className?: string }) {
  switch (tab.kind) {
    case 'chat':
      return <TuiAgentIcon agent={sessionAgent(tab.session)} size={12} />
    case 'terminal':
      return <TerminalTabIcon terminal={tab.terminal} className={className} />
    case 'editor':
      return tab.editor.kind === 'diff' ? (
        <GitCompare className={cn('size-3.5', className)} />
      ) : (
        <FileCode2 className={cn('size-3.5', className)} />
      )
    case 'browser':
      // Orca colours the globe so browser tabs stand out in a crowded strip.
      return <Globe className={cn('size-3.5', className, 'text-blue-500')} />
    case 'panel':
      return <PanelIcon panel={tab.panel.panel} className={className} />
  }
}

function PanelIcon({ panel, className }: { panel: string; className?: string }) {
  const Icon = useWorkspacePanel(panel).icon
  return <Icon className={cn('size-3.5', className)} />
}
