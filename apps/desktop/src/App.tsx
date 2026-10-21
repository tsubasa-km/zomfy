import { useEffect } from 'react'
import { connectLocalDaemon } from '@/daemon-connection'
import { useStore } from '@/session-store'
import { Sidebar } from '@/components/Sidebar'
import { WorkspaceTabs } from '@/components/WorkspaceTabs'
import { FloatingWorkspace } from '@/components/FloatingWorkspace'
import { RightSidebar } from '@/components/right-sidebar/RightSidebar'
import { TooltipProvider } from '@/components/ui/tooltip'
import { installSystemTheme } from '@/lib/theme'
import '@/assets/main.css'

installSystemTheme()

export default function App() {
  const activeWorkspaceId = useStore((s) => s.activeWorkspaceId)

  useEffect(() => {
    void connectLocalDaemon()
  }, [])

  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex h-full w-full overflow-hidden bg-background text-foreground">
        <Sidebar />
        <main className="flex min-w-0 flex-1">
          {activeWorkspaceId ? (
            <WorkspaceTabs
              key={activeWorkspaceId}
              workspaceId={activeWorkspaceId}
              emptyHint="No tabs yet. Use + in the tab bar to start Claude in this workspace."
            />
          ) : (
            <div className="m-auto text-sm text-muted-foreground">
              Select a workspace, or add a project with + in the sidebar.
            </div>
          )}
        </main>
        {activeWorkspaceId && <RightSidebar workspaceId={activeWorkspaceId} />}
      </div>
      <FloatingWorkspace />
    </TooltipProvider>
  )
}
