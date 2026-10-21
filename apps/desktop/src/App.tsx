import { useEffect } from 'react'
import { connectAllHosts } from '@/daemon-connection'
import { setDashboardOpen, useStore } from '@/session-store'
import { Sidebar } from '@/components/Sidebar'
import { WorkspaceTabs } from '@/components/WorkspaceTabs'
import { FloatingWorkspace } from '@/components/FloatingWorkspace'
import { RightSidebar } from '@/components/right-sidebar/RightSidebar'
import { AgentDashboard } from '@/components/AgentDashboard'
import { installAgentNotifications } from '@/agent-notifications'
import { TooltipProvider } from '@/components/ui/tooltip'
import { installSystemTheme } from '@/lib/theme'
import '@/assets/main.css'

installSystemTheme()
installAgentNotifications()

const isMac = navigator.userAgent.includes('Mac')

export default function App() {
  const activeWorkspaceId = useStore((s) => s.activeWorkspaceId)
  const dashboardOpen = useStore((s) => s.dashboardOpen)

  useEffect(() => {
    connectAllHosts()
    function onKey(e: KeyboardEvent) {
      if ((isMac ? e.metaKey : e.ctrlKey) && e.shiftKey && e.code === 'KeyD') {
        e.preventDefault()
        setDashboardOpen(!document.querySelector('[data-dashboard]'))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex h-full w-full overflow-hidden bg-background text-foreground">
        <Sidebar />
        <main className="flex min-w-0 flex-1">
          {dashboardOpen ? (
            <AgentDashboard />
          ) : activeWorkspaceId ? (
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
        {activeWorkspaceId && !dashboardOpen && <RightSidebar workspaceId={activeWorkspaceId} />}
      </div>
      <FloatingWorkspace />
    </TooltipProvider>
  )
}
