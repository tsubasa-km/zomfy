import { memo } from 'react'
import { AgentLaunchDialog } from '@/components/terminal/AgentLaunchDialog'
import { QuickCommandDialog } from '@/components/terminal/QuickCommandDialog'
import { NewTabDialogs } from '@/components/tab-layout/NewTabDialogs'

/** Dialogs the terminal menus open; mounted once per workspace, since every split group has menus. */
export const TerminalWorkspaceDialogs = memo(function TerminalWorkspaceDialogs({ workspaceId }: { workspaceId: string }) {
  return (
    <>
      <AgentLaunchDialog workspaceId={workspaceId} />
      <QuickCommandDialog workspaceId={workspaceId} />
      <NewTabDialogs workspaceId={workspaceId} />
    </>
  )
})
