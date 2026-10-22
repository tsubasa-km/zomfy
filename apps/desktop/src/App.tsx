import { useEffect } from 'react'
import { connectAllHosts } from '@/daemon-connection'
import { useStore } from '@/session-store'
import { useAppOverlays } from '@/stores/app-overlay-store'
import { Sidebar } from '@/components/Sidebar'
import { FloatingWorkspace } from '@/components/FloatingWorkspace'
import { PointerDragLayer } from '@/components/PointerDragLayer'
import { Toaster } from '@/components/ui/sonner'
import { RightSidebar } from '@/components/right-sidebar/RightSidebar'
import { AgentDashboard } from '@/components/AgentDashboard'
import { SettingsPage } from '@/components/settings/SettingsPage'
import { AutomationsPage } from '@/components/automations/AutomationsPage'
import { useAutomationState } from '@/stores/automation-store'
import { SkillsPage } from '@/components/skills/SkillsPage'
import { installSkillsCommands } from '@/components/skills/skills-commands'
import { installChatCommands } from '@/components/native-chat/native-chat-commands'
import { usePluginBootstrap } from '@/plugins/plugin-registry'
import { OnboardingGate, installOnboardingCommands } from '@/components/onboarding/OnboardingFlow'
import { QuickOpen } from '@/components/QuickOpen'
import { CommandPalette } from '@/components/CommandPalette'
import { StatusBar } from '@/components/status-bar/StatusBar'
import { WorkspaceBoard } from '@/components/sidebar/WorkspaceBoard'
import { TasksPage } from '@/components/tasks/TasksPage'
import { WorkspaceMain } from '@/components/WorkspaceColumns'
import { installWorkspaceWindows } from '@/lib/workspace-window'
import { useTasks } from '@/stores/tasks-store'
import { useSidebarStore } from '@/stores/sidebar-store'
import { installAgentNotifications } from '@/agent-notifications'
import { installAppCommands } from '@/keybindings/app-commands'
import { InboxPanel } from '@/components/inbox/InboxPanel'
import { installInbox } from '@/components/inbox/inbox-registrations'
import { installKeybindingDispatcher } from '@/keybindings/keybinding-registry'
import { TooltipProvider } from '@/components/ui/tooltip'
import { installTheme } from '@/lib/theme'
import { listenForDashboardPicks } from '@/lib/dashboard-window'
import { installTraySync } from '@/lib/tray-sync'
import { installUiZoom } from '@/lib/ui-zoom'
import '@/assets/main.css'

installTheme()
installUiZoom()
installAgentNotifications()
installAppCommands()
installInbox()
installSkillsCommands()
installChatCommands()
installOnboardingCommands()
installTraySync()

export default function App() {
  const activeWorkspaceId = useStore((s) => s.activeWorkspaceId)
  const dashboardOpen = useStore((s) => s.dashboardOpen)
  const settingsOpen = useAppOverlays((s) => s.settings.open)
  const automationsOpen = useAutomationState((s) => s.pageOpen)
  const skillsOpen = useAppOverlays((s) => s.skills)
  usePluginBootstrap()
  const boardOpen = useSidebarStore((s) => s.boardOpen)
  const tasksOpen = useTasks((s) => s.open)

  useEffect(() => {
    // index.html shows a themed boot screen until the shell mounts.
    document.getElementById('boot')?.remove()
    connectAllHosts()
    const stopPicks = listenForDashboardPicks()
    const stopKeys = installKeybindingDispatcher()
    const stopWindows = installWorkspaceWindows()
    return () => {
      stopPicks()
      stopKeys()
      stopWindows()
    }
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
            ) : (
              <WorkspaceMain />
            )}
          </main>
          {activeWorkspaceId && !dashboardOpen && !boardOpen && !tasksOpen && <RightSidebar workspaceId={activeWorkspaceId} />}
          {/* Orca's settings replace the app view; the views stay mounted underneath to keep their state. */}
          {automationsOpen && (
            <div className="absolute inset-0 z-20 flex">
              <AutomationsPage />
            </div>
          )}
          {settingsOpen && (
            <div className="absolute inset-0 z-30 flex">
              <SettingsPage />
            </div>
          )}
          {skillsOpen && (
            <div className="absolute inset-0 z-30 flex">
              <SkillsPage />
            </div>
          )}
        </div>
        <StatusBar />
      </div>
      <FloatingWorkspace />
      <Toaster />
      <InboxPanel />
      <QuickOpen />
      <CommandPalette />
      <OnboardingGate />
      <PointerDragLayer />
    </TooltipProvider>
  )
}
