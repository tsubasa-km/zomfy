import { isTauri } from '@tauri-apps/api/core'
import { emitTo, listen } from '@tauri-apps/api/event'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { WebviewWindow } from '@tauri-apps/api/webviewWindow'
import { selectSession, setDashboardOpen } from '@/session-store'
import { t } from '@/i18n/i18n'

// Orca's dashboard pop-out (dashboard-popout/): the agent dashboard in a window of its own, which
// hands the session the user picks back to the main window. The browser preview has no windows,
// so there the dashboard stays an in-app view.

export const DASHBOARD_WINDOW_LABEL = 'dashboard'
const PICK_EVENT = 'dashboard:select-session'

export const canPopOutDashboard = (): boolean => isTauri()

export async function popOutDashboard(): Promise<void> {
  setDashboardOpen(false)
  const existing = await WebviewWindow.getByLabel(DASHBOARD_WINDOW_LABEL)
  if (existing) {
    await existing.setFocus()
    return
  }
  new WebviewWindow(DASHBOARD_WINDOW_LABEL, {
    url: '/index.html?window=dashboard',
    title: t('Agents — Zomfy'),
    width: 1100,
    height: 720,
    minWidth: 560,
    minHeight: 360
  })
}

/** Dashboard window: a picked session opens in the main window, which comes forward. */
export function pickSessionInMainWindow(sessionId: string): void {
  void emitTo('main', PICK_EVENT, sessionId)
}

/** Main window: shows sessions the dashboard window picked. Returns the unlisten function. */
export function listenForDashboardPicks(): () => void {
  if (!isTauri()) return () => {}
  const unlisten = listen<string>(PICK_EVENT, (event) => {
    selectSession(event.payload)
    // The user clicked a card, so bringing the window they asked for forward is intended.
    void getCurrentWindow().setFocus()
  })
  return () => void unlisten.then((stop) => stop())
}
