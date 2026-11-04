import { isTauri } from '@tauri-apps/api/core'
import { emitTo, listen } from '@tauri-apps/api/event'
import { Window, getCurrentWindow } from '@tauri-apps/api/window'
import { WebviewWindow } from '@tauri-apps/api/webviewWindow'
import { allProjects, findWorkspace, getState, onPoppedOutSelect, openInColumn, selectWorkspace, setPoppedOut } from '@/session-store'
import { dropPaneAt } from '@/components/pane-drop'
import type { DragPoint } from '@/lib/pointer-drag'
import { t } from '@/i18n/i18n'

// A workspace popped out into a window of its own (`?window=workspace&workspace=<id>`), so two
// projects can sit on separate monitors. The main window keeps the workspace out of its own view
// while that window is open, and selecting it there brings the window forward. A pane header dragged
// out of the main window opens one where it was dropped; one dragged from a workspace window onto the
// main window goes back there, into the pane it was dropped on.

const RETURN_EVENT = 'workspace-window:return'

/** A workspace coming back; `at` is where it was dropped, in physical pixels from the main window's content corner. */
type ReturnPayload = { workspaceId: string; at?: DragPoint }

export const canPopOutWorkspace = (): boolean => isTauri()

const labelFor = (workspaceId: string) => `workspace-${workspaceId.replace(/[^a-zA-Z0-9_-]/g, '-')}`

export function workspaceWindowTitle(workspaceId: string): string {
  const workspace = findWorkspace(workspaceId)
  const project = allProjects().find((p) => p.id === workspace?.projectId)
  const name = workspace?.displayName ?? workspace?.name ?? t('Workspace')
  return `${project ? `${project.displayName ?? project.name} · ` : ''}${name} — Zomfy`
}

/** `at` (screen CSS pixels) puts the new window's top left near where the pane was dropped. */
export async function popOutWorkspace(workspaceId: string, at?: DragPoint): Promise<void> {
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
    minHeight: 360,
    ...(at ? { x: Math.max(0, Math.round(at.x - 120)), y: Math.max(0, Math.round(at.y - 16)) } : {})
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
  const unlisten = listen<string | ReturnPayload>(RETURN_EVENT, (event) => {
    // An older window sends the bare id.
    const { workspaceId, at } = typeof event.payload === 'string' ? { workspaceId: event.payload, at: undefined } : event.payload
    setPoppedOut(workspaceId, false)
    const point = at && { x: at.x / window.devicePixelRatio, y: at.y / window.devicePixelRatio }
    // Dropped on a pane: there. Otherwise back beside the others when panes are showing.
    if (point && dropPaneAt(workspaceId, point)) {
      // Placed.
    } else if (getState().columns.length > 1) openInColumn(workspaceId)
    else selectWorkspace(workspaceId)
    // The user asked for the workspace back here, so bringing this window forward is intended.
    void getCurrentWindow().setFocus()
  })
  return () => void unlisten.then((stop) => stop())
}

/** Workspace window: hands its workspace back to the main window and closes. */
export async function returnToMainWindow(workspaceId: string, at?: DragPoint): Promise<void> {
  const payload: ReturnPayload = at ? { workspaceId, at } : { workspaceId }
  await emitTo('main', RETURN_EVENT, payload)
  await getCurrentWindow().close()
}

/**
 * Workspace window: its header was dropped outside it. Over the main window, the workspace goes
 * back there, into the pane under the pointer; elsewhere nothing happens (the window itself moves
 * by its title bar).
 */
export async function returnByDrop(workspaceId: string, screen: DragPoint): Promise<void> {
  const main = await Window.getByLabel('main')
  if (!main) return
  const [origin, size] = await Promise.all([main.innerPosition(), main.innerSize()])
  const x = screen.x * window.devicePixelRatio - origin.x
  const y = screen.y * window.devicePixelRatio - origin.y
  if (x < 0 || y < 0 || x > size.width || y > size.height) return
  await returnToMainWindow(workspaceId, { x, y })
}
