import { isTauri } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { getState } from '@/session-store'
import { getSetting } from '@/stores/settings-store'
import { getWorkflowRuns } from '@/stores/workflow-runs-store'
import { createExternalStore } from '@/stores/external-store'
import { WINDOW_ROLE } from '@/lib/window-role'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { t } from '@/i18n/i18n'

// Quitting stops every host's daemon (src-tauri/src/lib.rs), so closing the main window while agents
// work or runs go on asks first, offering the tray, where they keep going.

interface Busy {
  chats: number
  runs: number
}

const store = createExternalStore<Busy | null>(null)

/** Chats working or waiting for the person, and workflow runs still going. */
export function busyWork(): Busy {
  const chats = getState().sessions.filter((s) => s.status === 'working' || s.status === 'needs-you').length
  const runs = getWorkflowRuns().filter((r) => r.status === 'running' || r.status === 'waiting').length
  return { chats, runs }
}

/** What would stop, as phrases for a confirmation ("2 chats working or waiting for you"). */
export function busyParts(busy: Busy): string[] {
  const chats = busy.chats > 1 ? t('{n} chats working or waiting for you', { n: busy.chats }) : t('{n} chat working or waiting for you', { n: busy.chats })
  const runs = busy.runs > 1 ? t('{n} workflow runs going', { n: busy.runs }) : t('{n} workflow run going', { n: busy.runs })
  return [busy.chats > 0 ? chats : null, busy.runs > 0 ? runs : null].filter((part): part is string => part !== null)
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
    const now = busyWork()
    if (now.chats === 0 && now.runs === 0) return
    event.preventDefault()
    store.set(now)
  })
}

export function CloseGuardDialog() {
  const ask = store.use((a) => a)
  if (!ask) return null
  const parts = busyParts(ask)
  return (
    <Dialog open onOpenChange={(open) => !open && store.set(null)}>
      <DialogContent className="sm:max-w-md" data-close-guard>
        <DialogHeader>
          <DialogTitle>{t('Quit Zomfy?')}</DialogTitle>
          <DialogDescription>
            {parts.join(t(' and '))}
            {t('. Quitting stops them on every host. Hidden in the tray, Zomfy keeps them going.')}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => store.set(null)}>
            {t('Cancel')}
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              store.set(null)
              void getCurrentWindow().destroy()
            }}
          >
            {t('Quit and stop them')}
          </Button>
          <Button
            onClick={() => {
              store.set(null)
              void getCurrentWindow().hide()
            }}
          >
            {t('Hide to tray')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
