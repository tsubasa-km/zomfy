import { AgentLaunchDialog } from '@/components/terminal/AgentLaunchDialog'
import { QuickCommandDialog } from '@/components/terminal/QuickCommandDialog'
import { QuickCommandsButton } from '@/components/terminal/QuickCommandsButton'

/** The tab strip's terminal extras: the quick-commands button and the dialogs its menus open. */
export function TerminalTabStripActions({ workspaceId }: { workspaceId: string }) {
  return (
    <>
      <QuickCommandsButton workspaceId={workspaceId} />
      <AgentLaunchDialog workspaceId={workspaceId} />
      <QuickCommandDialog workspaceId={workspaceId} />
    </>
  )
}
