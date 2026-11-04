import { useEffect } from 'react'
import { isTauri } from '@tauri-apps/api/core'
import { Window, getCurrentWindow } from '@tauri-apps/api/window'
import { AppWindow, Undo2 } from 'lucide-react'
import { connectAllHosts } from '@/daemon-connection'
import { getState, selectWorkspace, useStore } from '@/session-store'
import { WorkspaceTabs } from '@/components/WorkspaceTabs'
import { DragChip, PointerDragLayer } from '@/components/PointerDragLayer'
import { usePaneTitle } from '@/components/WorkspaceColumns'
import { paneDrag } from '@/components/pane-drop'
import { Toaster } from '@/components/ui/sonner'
import { WorkflowStartConfirmDialog } from '@/components/workflows/WorkflowStartConfirm'
import { Button } from '@/components/ui/button'
import { TooltipProvider } from '@/components/ui/tooltip'
import { installKeybindingDispatcher } from '@/keybindings/keybinding-registry'
import { installChatCommands } from '@/components/native-chat/native-chat-commands'
import { WINDOW_WORKSPACE_ID } from '@/lib/window-role'
import { returnByDrop, returnToMainWindow, workspaceWindowTitle } from '@/lib/workspace-window'
import { installTheme } from '@/lib/theme'
import { installUiZoom } from '@/lib/ui-zoom'
import '@/assets/main.css'
import { t } from '@/i18n/i18n'

installTheme()
installUiZoom()
installChatCommands()
if (WINDOW_WORKSPACE_ID) selectWorkspace(WINDOW_WORKSPACE_ID)

/** Root of a workspace popped out into its own window: its tabs, each with its drawer, and no app chrome. */
export default function WorkspaceWindow() {
  const workspaceId = WINDOW_WORKSPACE_ID
  const known = useStore((s) => Object.values(s.hosts).some((h) => h.harness?.workspaces.some((w) => w.id === workspaceId)))

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
        <main className="flex min-w-0 flex-1 flex-col">
          {known && <WindowPaneHeader workspaceId={workspaceId} />}
          {known ? (
            <WorkspaceTabs
              workspaceId={workspaceId}
              emptyHint={t('No tabs yet. Use + in the tab bar to start Claude in this workspace.')}
              trailing={
                <div className="flex items-center gap-0.5 pr-1">
                  {isTauri() && (
                    <Button
                      size="icon-xs"
                      variant="ghost"
                      aria-label={t('Back to the main window')}
                      title={t('Back to the main window')}
                      onClick={() => void returnToMainWindow(workspaceId)}
                    >
                      <Undo2 className="size-3.5" />
                    </Button>
                  )}
                </div>
              }
            />
          ) : (
            <div className="m-auto text-sm text-muted-foreground">{t('Connecting…')}</div>
          )}
        </main>
      </div>
      <PointerDragLayer />
      <Toaster />
      <WorkflowStartConfirmDialog />
    </TooltipProvider>
  )
}

/** The pane's name, as in the main window; dropped on the main window, the workspace goes back into the pane under it. */
function WindowPaneHeader({ workspaceId }: { workspaceId: string }) {
  const { title, detail } = usePaneTitle(workspaceId)
  return (
    <div
      data-column-header
      title={t('Drag onto the main window to put this workspace back there')}
      className="flex h-7 shrink-0 cursor-grab items-center gap-1.5 border-b border-border px-2.5 text-xs select-none active:cursor-grabbing"
      onPointerDown={(event) => {
        if (!isTauri()) return
        paneDrag.begin(event, {
          payload: () => ({ workspaceId }),
          preview: <DragChip label={title} icon={<AppWindow className="size-3.5" />} />,
          onDropOutside: (_item, screen) => void returnByDrop(workspaceId, screen)
        })
      }}
    >
      <span className="shrink-0 font-medium text-foreground">{title}</span>
      {detail && <span className="min-w-0 truncate text-muted-foreground">{detail}</span>}
    </div>
  )
}
