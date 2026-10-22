import { useSetting } from '@/stores/settings-store'

/** Where the floating toggle shows: its own button, or the status bar (falling back to the button while the bar is hidden). */
export function useFloatingWorkspaceTrigger(): { enabled: boolean; floatingButton: boolean; statusBar: boolean } {
  const enabled = useSetting('floatingWorkspaceEnabled')
  const location = useSetting('floatingWorkspaceTriggerLocation')
  const statusBarVisible = useSetting('statusBarVisible')
  const inStatusBar = location === 'status-bar'
  return { enabled, floatingButton: enabled && (!inStatusBar || !statusBarVisible), statusBar: enabled && inStatusBar && statusBarVisible }
}
