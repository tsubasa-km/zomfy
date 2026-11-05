import { useEffect, useState } from 'react'
import { isTauri } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { PanelLeft, PanelRight, RefreshCw, Settings, type LucideIcon } from 'lucide-react'
import { restartToUpdate, useAppUpdate } from '@/lib/app-update'
import { WINDOW_ROLE } from '@/lib/window-role'
import { toggleActivePaneSidebar } from '@/session-store'
import { getSetting, setSetting, useSetting } from '@/stores/settings-store'
import { openSettings } from '@/stores/app-overlay-store'
import { useShortcutLabel } from '@/keybindings/keybinding-registry'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { t } from '@/i18n/i18n'

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
      {t('Restart to update {version}', { version: next })}
    </button>
  )
}

/** An icon button in the title bar, as Orca's titlebar-icon-button; its tooltip names the shortcut when there is one. */
function BarButton({ icon: Icon, label, command, pressed, onClick }: { icon: LucideIcon; label: string; command: string; pressed?: boolean; onClick: () => void }) {
  const shortcut = useShortcutLabel(command)
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          aria-pressed={pressed}
          data-title-bar-button={command}
          className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground"
          onClick={onClick}
        >
          <Icon className="size-4" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom" sideOffset={6}>
        {shortcut ? `${label} (${shortcut})` : label}
      </TooltipContent>
    </Tooltip>
  )
}

export function TitleBar() {
  const [maximized, setMaximized] = useState(false)
  useEffect(() => {
    const win = getCurrentWindow()
    const sync = () => void win.isMaximized().then(setMaximized)
    sync()
    const unlisten = win.onResized(sync)
    return () => void unlisten.then((stop) => stop())
  }, [])

  const sidebarVisible = useSetting('sidebarVisible')
  const win = getCurrentWindow()
  return (
    <div data-tauri-drag-region data-title-bar className="flex h-8 shrink-0 items-center border-b border-border bg-worktree-sidebar select-none">
      <span data-tauri-drag-region className="pr-1.5 pl-3 text-xs text-muted-foreground">
        Zomfy
      </span>
      <BarButton
        icon={PanelLeft}
        label={t('Toggle sidebar')}
        command="sidebar.left.toggle"
        pressed={sidebarVisible}
        onClick={() => setSetting('sidebarVisible', !getSetting('sidebarVisible'))}
      />
      <div data-tauri-drag-region className="flex-1 self-stretch" />
      <UpdateButton />
      <div className="mr-1.5 flex items-center gap-0.5">
        <BarButton icon={PanelRight} label={t('Toggle right sidebar')} command="sidebar.right.toggle" onClick={() => toggleActivePaneSidebar()} />
        <BarButton icon={Settings} label={t('Settings')} command="app.settings" onClick={() => openSettings()} />
      </div>
      <div className="flex h-full">
        <button type="button" aria-label={t('Minimize')} className={cn(CONTROL, 'hover:bg-foreground/10')} onClick={() => void win.minimize()}>
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
            <path d="M0 5h10v1H0z" fill="currentColor" />
          </svg>
        </button>
        <button
          type="button"
          aria-label={maximized ? t('Restore') : t('Maximize')}
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
        <button type="button" aria-label={t('Close')} className={cn(CONTROL, 'hover:bg-[#c42b1c] hover:text-white')} onClick={() => void win.close()}>
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
            <path d="M1 0L0 1l4 4-4 4 1 1 4-4 4 4 1-1-4-4 4-4-1-1-4 4-4-4z" fill="currentColor" />
          </svg>
        </button>
      </div>
    </div>
  )
}
