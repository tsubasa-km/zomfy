import { useEffect } from 'react'
import { connectAllHosts } from '@/daemon-connection'
import { useStore } from '@/session-store'
import { useAppOverlays } from '@/stores/app-overlay-store'
import { Sidebar } from '@/components/Sidebar'
import { WorkspaceTabs } from '@/components/WorkspaceTabs'
import { FloatingWorkspace } from '@/components/FloatingWorkspace'
import { RightSidebar } from '@/components/right-sidebar/RightSidebar'
import { AgentDashboard } from '@/components/AgentDashboard'
import { SettingsPage } from '@/components/settings/SettingsPage'
import { QuickOpen } from '@/components/QuickOpen'
import { CommandPalette } from '@/components/CommandPalette'
import { StatusBar } from '@/components/status-bar/StatusBar'
import { WorkspaceBoard } from '@/components/sidebar/WorkspaceBoard'
import { TasksPage } from '@/components/tasks/TasksPage'
import { useTasks } from '@/stores/tasks-store'
import { useSidebarStore } from '@/stores/sidebar-store'
import { installAgentNotifications } from '@/agent-notifications'
import { installAppCommands } from '@/keybindings/app-commands'
import { installKeybindingDispatcher } from '@/keybindings/keybinding-registry'
import { TooltipProvider } from '@/components/ui/tooltip'
import { installTheme } from '@/lib/theme'
import { installUiZoom } from '@/lib/ui-zoom'
import '@/assets/main.css'

installTheme()
installUiZoom()
installAgentNotifications()
installAppCommands()

export default function App() {
  const activeWorkspaceId = useStore((s) => s.activeWorkspaceId)
  const dashboardOpen = useStore((s) => s.dashboardOpen)
  const settingsOpen = useAppOverlays((s) => s.settings.open)
  const boardOpen = useSidebarStore((s) => s.boardOpen)
  const tasksOpen = useTasks((s) => s.open)

  useEffect(() => {
    connectAllHosts()
    return installKeybindingDispatcher()
  }, [])

  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex h-full w-full flex-col overflow-hidden bg-background text-foreground">
        <div className="relative flex min-h-0 flex-1 overflow-hidden">
          <Sidebar />
          <main className="flex min-w-0 flex-1">
            {dashboardOpen ? (
              <AgentDashboard />
            ) : boardOpen ? (
              <WorkspaceBoard />
            ) : tasksOpen ? (
              <TasksPage />
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
          {activeWorkspaceId && !dashboardOpen && !boardOpen && !tasksOpen && <RightSidebar workspaceId={activeWorkspaceId} />}
          {/* Orca's settings replace the app view; the views stay mounted underneath to keep their state. */}
          {settingsOpen && (
            <div className="absolute inset-0 z-30 flex">
              <SettingsPage />
            </div>
          )}
        </div>
        <StatusBar />
      </div>
      <FloatingWorkspace />
      <QuickOpen />
      <CommandPalette />
    </TooltipProvider>
  )
}
