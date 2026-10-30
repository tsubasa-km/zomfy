import { SquareTerminal } from 'lucide-react'
import { toast } from 'sonner'
import { registerKeybindingDefinitions } from '@/keybindings/keybinding-definitions'
import { registerCommandHandler, shortcutLabel } from '@/keybindings/keybinding-registry'
import { focusedWorkspaceId } from '@/lib/workspace-navigation'
import { focusGroup } from './tab-group-commands'
import { newTerminalTab } from './workspace-tab-model'
import { t } from '@/i18n/i18n'

// A terminal runs where the workspace's daemon runs, so a WSL or SSH workspace gets a shell on that host.

function openTerminal(workspaceId: string): void {
  void newTerminalTab(workspaceId).catch((error: unknown) =>
    toast.error(t("Couldn't open a terminal"), { description: error instanceof Error ? error.message : String(error) })
  )
}

export function installTerminalCommands(): void {
  registerKeybindingDefinitions([
    {
      id: 'terminal.new',
      title: t('New Terminal'),
      group: 'Tabs',
      keywords: ['terminal', 'shell', 'console', 'command line', 'wsl', 'ssh'],
      defaultBindings: ['Ctrl+Shift+Backquote'],
      allowInTerminal: true
    }
  ])
  registerCommandHandler('terminal.new', () => {
    const workspaceId = focusedWorkspaceId()
    if (!workspaceId) return false
    openTerminal(workspaceId)
  })
}

/** The tab strip's one-click terminal, beside "+", in the group it belongs to. */
export function NewTerminalButton({ workspaceId, groupId }: { workspaceId: string; groupId: string }) {
  const shortcut = shortcutLabel('terminal.new')
  const label = shortcut ? t('New terminal ({shortcut})', { shortcut }) : t('New terminal')
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      data-new-terminal
      className="my-auto flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent/50 hover:text-foreground"
      onClick={() => {
        focusGroup(workspaceId, groupId)
        openTerminal(workspaceId)
      }}
    >
      <SquareTerminal className="size-3.5" />
    </button>
  )
}
