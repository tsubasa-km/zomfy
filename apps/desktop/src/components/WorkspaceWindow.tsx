import { useEffect } from 'react'
import { isTauri } from '@tauri-apps/api/core'
import { Window, getCurrentWindow } from '@tauri-apps/api/window'
import { PanelRightOpen, Undo2 } from 'lucide-react'
import { connectAllHosts } from '@/daemon-connection'
import { getState, selectWorkspace, setRightSidebar, useStore } from '@/session-store'
import { WorkspaceTabs } from '@/components/WorkspaceTabs'
import { RightSidebar } from '@/components/right-sidebar/RightSidebar'
import { PointerDragLayer } from '@/components/PointerDragLayer'
import { Toaster } from '@/components/ui/sonner'
import { Button } from '@/components/ui/button'
import { TooltipProvider } from '@/components/ui/tooltip'
import { installKeybindingDispatcher } from '@/keybindings/keybinding-registry'
import { installChatCommands } from '@/components/native-chat/native-chat-commands'
import { WINDOW_WORKSPACE_ID } from '@/lib/window-role'
import { returnToMainWindow, workspaceWindowTitle } from '@/lib/workspace-window'
import { installTheme } from '@/lib/theme'
import { installUiZoom } from '@/lib/ui-zoom'
import '@/assets/main.css'

installTheme()
installUiZoom()
installChatCommands()
if (WINDOW_WORKSPACE_ID) selectWorkspace(WINDOW_WORKSPACE_ID)

/** Root of a workspace popped out into its own window: its tabs and right sidebar, no app chrome. */
export default function WorkspaceWindow() {
  const workspaceId = WINDOW_WORKSPACE_ID
  const known = useStore((s) => Object.values(s.hosts).some((h) => h.harness?.workspaces.some((w) => w.id === workspaceId)))
  const rightOpen = useStore((s) => s.rightSidebar.open)

  useEffect(() => {
    document.getElementById('boot')?.remove()
    connectAllHosts()
    const stopKeys = installKeybindingDispatcher()
    if (!isTauri()) return stopKeys
    // Closing the app's main window takes its pop-outs with it.
    const unlisten = Window.getByLabel('main').then((main) =>
      main?.once('tauri://destroyed', () => void getCurrentWindow().close())
    )
    return () => {
      stopKeys()
      void unlisten.then((stop) => stop?.())
    }
  }, [])

  useEffect(() => {
    if (!workspaceId || !known) return
    // The store drops an active workspace its host has not listed yet; take it back once listed.
    if (getState().activeWorkspaceId !== workspaceId) selectWorkspace(workspaceId)
    if (isTauri()) void getCurrentWindow().setTitle(workspaceWindowTitle(workspaceId))
  }, [workspaceId, known])

  if (!workspaceId) return null
  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex h-full w-full overflow-hidden bg-background text-foreground">
        <main className="flex min-w-0 flex-1">
          {known ? (
            <WorkspaceTabs
              workspaceId={workspaceId}
              emptyHint="No tabs yet. Use + in the tab bar to start Claude in this workspace."
              trailing={
                <div className="flex items-center gap-0.5 pr-1">
                  {!rightOpen && (
                    <Button size="icon-xs" variant="ghost" aria-label="Show right sidebar" onClick={() => setRightSidebar({ open: true })}>
                      <PanelRightOpen className="size-3.5" />
                    </Button>
                  )}
                  {isTauri() && (
                    <Button
                      size="icon-xs"
                      variant="ghost"
                      aria-label="Back to the main window"
                      title="Back to the main window"
                      onClick={() => void returnToMainWindow(workspaceId)}
                    >
                      <Undo2 className="size-3.5" />
                    </Button>
                  )}
                </div>
              }
            />
          ) : (
            <div className="m-auto text-sm text-muted-foreground">Connecting…</div>
          )}
        </main>
        {known && <RightSidebar workspaceId={workspaceId} />}
      </div>
      <PointerDragLayer />
      <Toaster />
    </TooltipProvider>
  )
}
