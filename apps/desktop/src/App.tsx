import { useEffect } from 'react'
import { connectLocalDaemon } from '@/daemon-connection'
import { useStore } from '@/session-store'
import { Sidebar } from '@/components/Sidebar'
import { ThreadView } from '@/components/ThreadView'
import { TooltipProvider } from '@/components/ui/tooltip'
import { installSystemTheme } from '@/lib/theme'
import '@/assets/main.css'

installSystemTheme()

export default function App() {
  const activeSession = useStore((s) => s.sessions.find((x) => x.id === s.activeSessionId) ?? null)

  useEffect(() => {
    void connectLocalDaemon()
  }, [])

  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex h-full w-full overflow-hidden bg-background text-foreground">
        <Sidebar />
        <main className="flex min-w-0 flex-1">
          {activeSession ? (
            <ThreadView session={activeSession} />
          ) : (
            <div className="m-auto text-sm text-muted-foreground">
              Open a folder with + in the sidebar to start a session.
            </div>
          )}
        </main>
      </div>
    </TooltipProvider>
  )
}
