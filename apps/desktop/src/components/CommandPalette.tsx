import { CornerDownLeft, FolderGit2, PanelBottomClose, PanelRightClose, Terminal } from 'lucide-react'
import { allWorkspaces, floatingWorkspaceId, selectWorkspace, setDashboardOpen, useStore, workspaceStatus } from '@/session-store'
import { closeSettings, setCommandPalette, useAppOverlays } from '@/stores/app-overlay-store'
import { keybindingDefinitions } from '@/keybindings/keybinding-definitions'
import { effectiveBindings, hasCommandHandler, runCommand, useCommandRegistryVersion } from '@/keybindings/keybinding-registry'
import { formatChord } from '@/keybindings/keybinding-chords'
import { useSetting } from '@/stores/settings-store'
import { ShortcutKeyCombo } from '@/components/ShortcutKeyCombo'
import { AgentStateDot } from '@/components/AgentStateDot'
import { canSplitActiveChat, splitActiveChat } from '@/components/tab-layout/pane-split-commands'
import { CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'

// Ctrl/Cmd+Shift+P and Ctrl/Cmd+J: Orca's Cmd+J palette (switch workspace, quick actions) merged
// with a command list drawn from the keybinding registry, so every command shows its shortcut.

export function CommandPalette() {
  const open = useAppOverlays((s) => s.commandPalette)
  const workspacesOnly = useAppOverlays((s) => s.commandPaletteMode === 'workspaces')
  useCommandRegistryVersion()
  const overrides = useSetting('keybindings')
  const hosts = useStore((s) => s.hosts)
  const sessions = useStore((s) => s.sessions)
  const activeWorkspaceId = useStore((s) => s.activeWorkspaceId)
  const floating = useStore((s) => floatingWorkspaceId(s))
  const workspaces = allWorkspaces({ hosts }).filter((w) => w.id !== floating)
  const commands = keybindingDefinitions().filter((d) => !d.hideInPalette && hasCommandHandler(d.id))
  const hostCount = Object.keys(hosts).length

  const close = () => setCommandPalette(false)
  // Orca's Cmd+J quick actions (native-chat-split-quick-actions.ts), offered while the active chat can move.
  const chatSplit = open && !workspacesOnly && canSplitActiveChat()

  return (
    <CommandDialog
      open={open}
      onOpenChange={setCommandPalette}
      title="Command Palette"
      description="Run a command or switch workspace"
      onCloseAutoFocus={(e) => e.preventDefault()}
      commandProps={{ loop: true }}
    >
      <CommandInput
        placeholder={workspacesOnly ? 'Search workspaces...' : 'Type a command or workspace name...'}
        className="!h-9 !py-2"
      />
      <CommandList className="max-h-[420px] p-2" data-command-palette-list>
        <CommandEmpty>{workspacesOnly ? 'No matching workspaces.' : 'No matching commands or workspaces.'}</CommandEmpty>
        {workspaces.length > 0 ? (
          <CommandGroup heading="Workspaces">
            {workspaces.map((workspace) => {
              const name = workspace.displayName ?? workspace.name
              const status = workspaceStatus(sessions.filter((s) => s.workspaceId === workspace.id))
              const host = hosts[workspace.hostId]?.label
              return (
                <CommandItem
                  key={workspace.id}
                  value={`workspace ${workspace.id} ${name} ${workspace.branch ?? ''} ${host ?? ''}`}
                  onSelect={() => {
                    selectWorkspace(workspace.id)
                    setDashboardOpen(false)
                    closeSettings()
                    close()
                  }}
                  className="!py-1.5"
                >
                  <FolderGit2 className="size-3.5 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 truncate">{name}</span>
                  {workspace.branch && workspace.branch !== name ? (
                    <span className="min-w-0 truncate text-xs text-muted-foreground">{workspace.branch}</span>
                  ) : null}
                  {hostCount > 1 && host ? <span className="shrink-0 text-[11px] text-muted-foreground">{host}</span> : null}
                  <span className="ml-auto flex shrink-0 items-center gap-2">
                    {status !== 'none' ? <AgentStateDot state={status === 'needs-you' ? 'permission' : status === 'working' ? 'working' : status === 'error' ? 'failed' : 'idle'} /> : null}
                    {workspace.id === activeWorkspaceId ? <CornerDownLeft className="size-3 text-muted-foreground" /> : null}
                  </span>
                </CommandItem>
              )
            })}
          </CommandGroup>
        ) : null}
        {chatSplit ? (
          <CommandGroup heading="Quick Actions">
            {([
              { direction: 'right', title: 'Split Chat Right', description: 'Open the active chat in a split pane to the right.', icon: PanelRightClose },
              { direction: 'down', title: 'Split Chat Down', description: 'Open the active chat in a split pane below.', icon: PanelBottomClose }
            ] as const).map(({ direction, title, description, icon: Icon }) => (
              <CommandItem
                key={direction}
                value={`quick split-chat-${direction} ${title} move chat ${direction} chat pane`}
                onSelect={() => {
                  close()
                  requestAnimationFrame(() => splitActiveChat(direction))
                }}
                className="!py-1.5"
                data-quick-action={`split-chat-${direction}`}
              >
                <Icon className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="min-w-0 truncate">{title}</span>
                <span className="min-w-0 truncate text-xs text-muted-foreground">{description}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        ) : null}
        {workspacesOnly ? null : (
          <CommandGroup heading="Commands">
            {commands.map((definition) => {
              const first = effectiveBindings(definition, overrides)[0]
              return (
                <CommandItem
                  key={definition.id}
                  value={`command ${definition.id} ${definition.title} ${definition.group} ${(definition.keywords ?? []).join(' ')}`}
                  onSelect={() => {
                    close()
                    // After the dialog closes, so focus-sensitive commands see the app, not the palette.
                    requestAnimationFrame(() => runCommand(definition.id))
                  }}
                  className="!py-1.5"
                >
                  <Terminal className="size-3.5 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 truncate">{definition.title}</span>
                  {first ? <ShortcutKeyCombo keys={formatChord(first)} className="ml-auto shrink-0" /> : null}
                </CommandItem>
              )
            })}
          </CommandGroup>
        )}
      </CommandList>
    </CommandDialog>
  )
}
