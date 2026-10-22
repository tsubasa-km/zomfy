import { invoke, isTauri } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { isPermissionGranted, sendNotification } from '@tauri-apps/plugin-notification'
import { getState, onSessionTransition } from '@/session-store'
import { getSetting, onSettingsChange } from '@/stores/settings-store'
import { runCommand } from '@/keybindings/keybinding-registry'

// Feeds the native tray (src-tauri/src/tray.rs): Orca's attention dot while the window is hidden,
// the number of agents waiting on the user, and the minimize-to-tray preference.

const NOTICE_KEY = 'acp-harness.trayMinimizeNoticeShown'

export function installTraySync(): void {
  if (!isTauri()) return
  let attention = false
  const waiting = () => getState().sessions.filter((s) => s.status === 'needs-you').length
  const push = () => void invoke('set_tray_attention', { attention, waiting: waiting() }).catch(() => undefined)

  onSessionTransition(({ from, to }) => {
    const finished = from === 'working' && (to === 'idle' || to === 'error')
    // Orca lights the dot only when the window cannot be seen; showing it clears the dot.
    if ((finished || to === 'needs-you') && document.visibilityState === 'hidden') attention = true
    push()
  })
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && attention) {
      attention = false
      push()
    }
  })

  const syncMinimize = () => void invoke('set_minimize_to_tray', { enabled: getSetting('minimizeToTrayOnClose') }).catch(() => undefined)
  syncMinimize()
  onSettingsChange((next, previous) => {
    if (next.minimizeToTrayOnClose !== previous.minimizeToTrayOnClose) syncMinimize()
  })

  void listen('tray-minimized', async () => {
    try {
      if (localStorage.getItem(NOTICE_KEY)) return
      localStorage.setItem(NOTICE_KEY, '1')
    } catch {
      return
    }
    // Once only, as Orca does: closing hid the window, the app and its daemons still run.
    if (await isPermissionGranted()) sendNotification({ title: 'ACP Harness', body: 'ACP Harness is still running in the system tray' })
  })
  void listen('tray-jump-needs-you', () => runCommand('agent.jumpToNeedsYou'))
}
