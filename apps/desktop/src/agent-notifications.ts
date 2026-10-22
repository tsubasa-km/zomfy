import { isPermissionGranted, requestPermission, sendNotification } from '@tauri-apps/plugin-notification'
import { allWorkspaces, getState, isFloating, onSessionTransition, type Session } from './session-store'
import { getSettings } from './stores/settings-store'

// Like Orca's agent-hook-completion-notifications: a desktop notification when an agent finishes
// or asks for approval, unless the user is already looking at that session.

function isOnScreen(session: Session): boolean {
  if (!document.hasFocus()) return false
  const state = getState()
  if (state.dashboardOpen) return false
  if (state.activeSessionByWorkspace[session.workspaceId] !== session.id) return false
  return isFloating(session.workspaceId) ? state.floating.open : state.activeWorkspaceId === session.workspaceId
}

let permission: Promise<boolean> | null = null

function ensurePermission(): Promise<boolean> {
  permission ??= isPermissionGranted().then(async (granted) => granted || (await requestPermission()) === 'granted')
  return permission
}

export function installAgentNotifications(): void {
  onSessionTransition(({ session, from, to }) => {
    const settings = getSettings()
    const finished = from === 'working' && (to === 'idle' || to === 'error')
    const wanted = (to === 'needs-you' && settings.notifyAgentNeedsYou) || (finished && settings.notifyAgentFinished)
    if (!settings.notificationsEnabled || !wanted) return
    if (settings.notifySuppressWhenFocused && isOnScreen(session)) return
    const workspace = allWorkspaces().find((w) => w.id === session.workspaceId)?.name ?? 'workspace'
    const title =
      to === 'needs-you'
        ? `Claude needs you · ${workspace}`
        : to === 'error'
          ? `Claude stopped with an error · ${workspace}`
          : `Claude finished · ${workspace}`
    void ensurePermission().then((granted) => {
      if (granted) sendNotification({ title, body: session.title })
    })
  })
}

/** The daemon resumed a usage-limited chat on its own; said even when the window is focused. */
export function notifyAutoResumed(sessionId: string): void {
  const session = getState().sessions.find((s) => s.id === sessionId)
  if (!session || !getSettings().notificationsEnabled) return
  const workspace = allWorkspaces().find((w) => w.id === session.workspaceId)?.name ?? 'workspace'
  void ensurePermission().then((granted) => {
    if (granted) sendNotification({ title: `Usage limit reset: resumed · ${workspace}`, body: session.title })
  })
}
