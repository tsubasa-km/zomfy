import { isTauri } from '@tauri-apps/api/core'
import { emitTo, listen } from '@tauri-apps/api/event'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { WebviewWindow } from '@tauri-apps/api/webviewWindow'
import { allProjects, findWorkspace, getState, onPoppedOutSelect, openInColumn, selectWorkspace, setPoppedOut } from '@/session-store'

// A workspace popped out into a window of its own (`?window=workspace&workspace=<id>`), so two
// projects can sit on separate monitors. The main window keeps the workspace out of its own view
// while that window is open, and selecting it there brings the window forward.

const RETURN_EVENT = 'workspace-window:return'

export const canPopOutWorkspace = (): boolean => isTauri()

const labelFor = (workspaceId: string) => `workspace-${workspaceId.replace(/[^a-zA-Z0-9_-]/g, '-')}`

export function workspaceWindowTitle(workspaceId: string): string {
  const workspace = findWorkspace(workspaceId)
  const project = allProjects().find((p) => p.id === workspace?.projectId)
  const name = workspace?.displayName ?? workspace?.name ?? 'Workspace'
  return `${project ? `${project.displayName ?? project.name} · ` : ''}${name} — Zomfy`
}

export async function popOutWorkspace(workspaceId: string): Promise<void> {
  const label = labelFor(workspaceId)
  const existing = await WebviewWindow.getByLabel(label)
  if (existing) {
    await existing.setFocus()
    return
  }
  const window = new WebviewWindow(label, {
    url: `/index.html?window=workspace&workspace=${encodeURIComponent(workspaceId)}`,
    title: workspaceWindowTitle(workspaceId),
    width: 1200,
    height: 820,
    minWidth: 560,
    minHeight: 360
  })
  setPoppedOut(workspaceId, true)
  void window.once('tauri://error', () => setPoppedOut(workspaceId, false))
  void window.once('tauri://destroyed', () => setPoppedOut(workspaceId, false))
}

/** Main window: selecting a popped-out workspace focuses its window; "back" returns it here. */
export function installWorkspaceWindows(): () => void {
  if (!isTauri()) return () => {}
  onPoppedOutSelect((workspaceId) => {
    void WebviewWindow.getByLabel(labelFor(workspaceId)).then((window) => {
      if (window) return window.setFocus()
      // The window went away without telling us; show the workspace here again.
      setPoppedOut(workspaceId, false)
      selectWorkspace(workspaceId)
    })
  })
  const unlisten = listen<string>(RETURN_EVENT, (event) => {
    setPoppedOut(event.payload, false)
    // Back beside the others when columns are showing, rather than taking over the focused one.
    if (getState().columns.length > 1) openInColumn(event.payload)
    else selectWorkspace(event.payload)
    // The user asked for the workspace back here, so bringing this window forward is intended.
    void getCurrentWindow().setFocus()
  })
  return () => void unlisten.then((stop) => stop())
}

/** Workspace window: hands its workspace back to the main window and closes. */
export async function returnToMainWindow(workspaceId: string): Promise<void> {
  await emitTo('main', RETURN_EVENT, workspaceId)
  await getCurrentWindow().close()
}
