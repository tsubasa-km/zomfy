import { isTauri } from '@tauri-apps/api/core'
import { getVersion } from '@tauri-apps/api/app'
import { check, type Update } from '@tauri-apps/plugin-updater'
import { relaunch } from '@tauri-apps/plugin-process'
import { toast } from 'sonner'
import { busyWork } from '@/lib/close-guard'
import { createExternalStore } from '@/stores/external-store'
import { WINDOW_ROLE } from '@/lib/window-role'
import { registerKeybindingDefinitions } from '@/keybindings/keybinding-definitions'
import { registerCommandHandler } from '@/keybindings/keybinding-registry'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'

// Releases are GitHub Releases of tsubasa-km/zomfy (tauri.conf.json); an update downloads in the
// background and installs when the person restarts. The new build replaces every host's daemon itself.

export type UpdatePhase = 'idle' | 'checking' | 'downloading' | 'ready' | 'current' | 'error' | 'unavailable'

export interface UpdateState {
  phase: UpdatePhase
  current: string | null
  next: string | null
  error: string | null
}

const CHECK_EVERY_MS = 4 * 60 * 60 * 1000
const store = createExternalStore<UpdateState>({ phase: 'idle', current: null, next: null, error: null })
const confirmStore = createExternalStore(false)
let pending: Update | null = null

export const useAppUpdate = store.use

function patch(change: Partial<UpdateState>): void {
  store.update((s) => ({ ...s, ...change }))
}

/** Dev builds run from source, so only the installed app updates. */
function updatable(): boolean {
  return isTauri() && !import.meta.env.DEV
}

export async function checkForUpdate(manual = false): Promise<void> {
  const phase = store.get().phase
  if (phase === 'checking' || phase === 'downloading' || phase === 'ready') return
  if (!updatable()) {
    patch({ phase: 'unavailable' })
    return
  }
  patch({ phase: 'checking', error: null })
  try {
    const update = await check()
    if (!update) {
      patch({ phase: 'current' })
      return
    }
    patch({ phase: 'downloading', next: update.version })
    await update.download()
    pending = update
    patch({ phase: 'ready' })
    toast(`Zomfy ${update.version} is ready`, {
      description: 'Restart to update.',
      duration: Infinity,
      action: { label: 'Restart', onClick: () => restartToUpdate() }
    })
  } catch (error) {
    patch({ phase: 'error', error: error instanceof Error ? error.message : String(error) })
    if (manual) toast.error("Couldn't check for updates", { description: store.get().error ?? undefined })
  }
}

/** Asks first while agents work or runs go on: the restart stops them on every host. */
export function restartToUpdate(): void {
  if (!pending) return
  const now = busyWork()
  if (now.chats > 0 || now.runs > 0) confirmStore.set(true)
  else void apply()
}

async function apply(): Promise<void> {
  if (!pending) return
  try {
    // Windows quits the app here and the installer reopens it; relaunch covers the other platforms.
    await pending.install()
    await relaunch()
  } catch (error) {
    toast.error("Couldn't install the update", { description: error instanceof Error ? error.message : String(error) })
  }
}

export function installAppUpdates(): void {
  registerKeybindingDefinitions([
    { id: 'app.checkForUpdates', title: 'Check for Updates', group: 'Global', keywords: ['update', 'upgrade', 'version', 'release'], defaultBindings: [] }
  ])
  registerCommandHandler('app.checkForUpdates', () => void checkForUpdate(true))
  if (!isTauri()) return
  void getVersion().then((current) => patch({ current }))
  if (!updatable() || WINDOW_ROLE !== 'main') return
  setTimeout(() => void checkForUpdate(), 15_000)
  setInterval(() => void checkForUpdate(), CHECK_EVERY_MS)
}

export function UpdateConfirmDialog() {
  const open = confirmStore.use((o) => o)
  if (!open) return null
  const now = busyWork()
  return (
    <Dialog open onOpenChange={(o) => !o && confirmStore.set(false)}>
      <DialogContent className="sm:max-w-md" data-update-confirm>
        <DialogHeader>
          <DialogTitle>Restart to update?</DialogTitle>
          <DialogDescription>
            {[now.chats > 0 && `${now.chats} chat${now.chats > 1 ? 's' : ''} working or waiting for you`, now.runs > 0 && `${now.runs} workflow run${now.runs > 1 ? 's' : ''} going`]
              .filter(Boolean)
              .join(' and ')}
            . Restarting stops them on every host.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => confirmStore.set(false)}>
            Later
          </Button>
          <Button
            onClick={() => {
              confirmStore.set(false)
              void apply()
            }}
          >
            Restart and update
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
