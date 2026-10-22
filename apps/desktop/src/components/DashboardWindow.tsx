import { useEffect } from 'react'
import { isTauri } from '@tauri-apps/api/core'
import { Window, getCurrentWindow } from '@tauri-apps/api/window'
import { connectAllHosts } from '@/daemon-connection'
import { handleSessionPicks, setDashboardOpen, useStore } from '@/session-store'
import { pickSessionInMainWindow } from '@/lib/dashboard-window'
import { AgentDashboard } from '@/components/AgentDashboard'
import { TooltipProvider } from '@/components/ui/tooltip'
import { installTheme } from '@/lib/theme'
import { installUiZoom } from '@/lib/ui-zoom'
import '@/assets/main.css'

installTheme()
installUiZoom()
// Cards open their session in the main window; this one only watches.
handleSessionPicks(pickSessionInMainWindow)
setDashboardOpen(true)

/** Root of the popped-out dashboard window: its own daemon connections, the dashboard and nothing else. */
export default function DashboardWindow() {
  const open = useStore((s) => s.dashboardOpen)

  useEffect(() => {
    connectAllHosts()
    if (!isTauri()) return
    // Closing the app's main window takes its pop-out with it.
    const unlisten = Window.getByLabel('main').then((main) =>
      main?.once('tauri://destroyed', () => void getCurrentWindow().close())
    )
    return () => void unlisten.then((stop) => stop?.())
  }, [])

  useEffect(() => {
    // The dashboard's own close (button, Escape) closes this window.
    if (!open && isTauri()) void getCurrentWindow().close()
  }, [open])

  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex h-full w-full overflow-hidden bg-background text-foreground">
        <AgentDashboard />
      </div>
    </TooltipProvider>
  )
}
