import { useEffect, useState } from 'react'
import { invoke, isTauri } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { RefreshCw } from 'lucide-react'
import { restartToUpdate, useAppUpdate } from '@/lib/app-update'
import { WINDOW_ROLE } from '@/lib/window-role'
import { cn } from '@/lib/utils'

/** On Windows the main window drops the OS title bar (title_bar.rs) so the update button can sit beside ＿ □ ✕, as in Orca. */
export const OWN_TITLE_BAR = isTauri() && WINDOW_ROLE === 'main' && navigator.userAgent.includes('Windows')

const CONTROL = 'flex h-full w-[46px] items-center justify-center text-foreground transition-colors'

function UpdateButton() {
  const { phase, next } = useAppUpdate((s) => s)
  if (phase !== 'ready' || !next) return null
  return (
    <button
      type="button"
      onClick={restartToUpdate}
      className="mr-2 flex h-6 items-center gap-1.5 rounded-md bg-highlight/15 px-2 text-xs font-medium text-highlight transition-colors hover:bg-highlight/25"
    >
      <RefreshCw className="size-3.5" />
      Restart to update {next}
    </button>
  )
}

/** The window brings the OS title bar back if this stops (title_bar.rs), so a hung page can still be closed. */
const HEARTBEAT_MS = 2000

export function TitleBar() {
  const [maximized, setMaximized] = useState(false)
  useEffect(() => {
    const beat = () => void invoke('title_bar_alive').catch(() => {})
    beat()
    const timer = setInterval(beat, HEARTBEAT_MS)
    return () => clearInterval(timer)
  }, [])
  useEffect(() => {
    const win = getCurrentWindow()
    const sync = () => void win.isMaximized().then(setMaximized)
    sync()
    const unlisten = win.onResized(sync)
    return () => void unlisten.then((stop) => stop())
  }, [])

  const win = getCurrentWindow()
  return (
    <div data-tauri-drag-region className="flex h-8 shrink-0 items-center border-b border-border bg-worktree-sidebar select-none">
      <span data-tauri-drag-region className="pl-3 text-xs text-muted-foreground">
        Zomfy
      </span>
      <div data-tauri-drag-region className="flex-1 self-stretch" />
      <UpdateButton />
      <div className="flex h-full">
        <button type="button" aria-label="Minimize" className={cn(CONTROL, 'hover:bg-foreground/10')} onClick={() => void win.minimize()}>
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
            <path d="M0 5h10v1H0z" fill="currentColor" />
          </svg>
        </button>
        <button
          type="button"
          aria-label={maximized ? 'Restore' : 'Maximize'}
          className={cn(CONTROL, 'hover:bg-foreground/10')}
          onClick={() => void win.toggleMaximize()}
        >
          {maximized ? (
            <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
              <path d="M2 0v2H0v8h8V8h2V0H2zm6 9H1V3h7v6zM9 7H8V2H3V1h6v6z" fill="currentColor" />
            </svg>
          ) : (
            <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
              <path d="M0 0v10h10V0H0zm9 9H1V1h8v8z" fill="currentColor" />
            </svg>
          )}
        </button>
        {/* close() goes through CloseRequested, so minimize-to-tray still applies. */}
        <button type="button" aria-label="Close" className={cn(CONTROL, 'hover:bg-[#c42b1c] hover:text-white')} onClick={() => void win.close()}>
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
            <path d="M1 0L0 1l4 4-4 4 1 1 4-4 4 4 1-1-4-4 4-4-1-1-4 4-4-4z" fill="currentColor" />
          </svg>
        </button>
      </div>
    </div>
  )
}
