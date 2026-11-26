import { toast } from 'sonner'
import { registerKeybindingDefinitions } from '@/keybindings/keybinding-definitions'
import { registerCommandHandler } from '@/keybindings/keybinding-registry'
import { focusedWorkspaceId } from '@/lib/workspace-navigation'
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
