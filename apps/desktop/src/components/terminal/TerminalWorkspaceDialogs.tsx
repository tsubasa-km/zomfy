import { AgentLaunchDialog } from '@/components/terminal/AgentLaunchDialog'
import { QuickCommandDialog } from '@/components/terminal/QuickCommandDialog'

/** Dialogs the terminal menus open; mounted once per workspace, since every split group has menus. */
export function TerminalWorkspaceDialogs({ workspaceId }: { workspaceId: string }) {
  return (
    <>
      <AgentLaunchDialog workspaceId={workspaceId} />
      <QuickCommandDialog workspaceId={workspaceId} />
    </>
  )
}
