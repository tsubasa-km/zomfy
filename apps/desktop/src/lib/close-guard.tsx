import { isTauri } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { getState } from '@/session-store'
import { getSetting } from '@/stores/settings-store'
import { getWorkflowRuns } from '@/stores/workflow-runs-store'
import { createExternalStore } from '@/stores/external-store'
import { WINDOW_ROLE } from '@/lib/window-role'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'

// Quitting stops every host's daemon (src-tauri/src/lib.rs), so closing the main window while agents
// work or runs go on asks first, offering the tray, where they keep going.

interface Busy {
  chats: number
  runs: number
}

const store = createExternalStore<Busy | null>(null)

function busy(): Busy {
  const chats = getState().sessions.filter((s) => s.status === 'working' || s.status === 'needs-you').length
  const runs = getWorkflowRuns().filter((r) => r.status === 'running' || r.status === 'waiting').length
  return { chats, runs }
}

export function installCloseGuard(): void {
  if (!isTauri() || WINDOW_ROLE !== 'main') return
  const window = getCurrentWindow()
  void window.onCloseRequested((event) => {
    // tray.rs already hid the window; destroying it now would quit after all.
    if (getSetting('minimizeToTrayOnClose') && navigator.userAgent.includes('Windows')) {
      event.preventDefault()
      return
    }
    const now = busy()
    if (now.chats === 0 && now.runs === 0) return
    event.preventDefault()
    store.set(now)
  })
}

export function CloseGuardDialog() {
  const ask = store.use((a) => a)
  if (!ask) return null
  const parts = [ask.chats > 0 && `${ask.chats} chat${ask.chats > 1 ? 's' : ''} working or waiting for you`, ask.runs > 0 && `${ask.runs} workflow run${ask.runs > 1 ? 's' : ''} going`].filter(Boolean)
  return (
    <Dialog open onOpenChange={(open) => !open && store.set(null)}>
      <DialogContent className="sm:max-w-md" data-close-guard>
        <DialogHeader>
          <DialogTitle>Quit Zomfy?</DialogTitle>
          <DialogDescription>
            {parts.join(' and ')}. Quitting stops them on every host. Hidden in the tray, Zomfy keeps them going.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => store.set(null)}>
            Cancel
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              store.set(null)
              void getCurrentWindow().destroy()
            }}
          >
            Quit and stop them
          </Button>
          <Button
            onClick={() => {
              store.set(null)
              void getCurrentWindow().hide()
            }}
          >
            Hide to tray
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
