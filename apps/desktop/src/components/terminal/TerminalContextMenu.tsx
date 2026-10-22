import {
  Clipboard,
  Copy,
  Eraser,
  PanelBottomClose,
  PanelRightClose,
  Pencil,
  Play,
  Plus,
  RotateCcw,
  RotateCw,
  Search,
  TextSelect,
  X
} from 'lucide-react'
import type { QuickCommand } from '@acp-harness/protocol'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { QuickCommandIcon } from '@/components/terminal/QuickCommandsButton'
import { TERMINAL_SHORTCUT_LABELS } from '@/lib/terminal-shortcuts'

// Ported from Orca's TerminalContextMenu.tsx and TerminalQuickCommandsSubmenu.tsx.

export interface TerminalMenuActions {
  onCopy: () => void
  onPaste: () => void
  onSelectAll: () => void
  onFind: () => void
  /** Absent where the terminal is not a tab (under a chat code block). */
  onSplit?: (direction: 'right' | 'down') => void
  onSetTitle: () => void
  onClearTitle: (() => void) | null
  onCopyTerminalId: () => void
  onClose: () => void
  onClearScreen: () => void
  onResetTerminal: () => void
  onRestart: () => void
  quickCommands: { project: QuickCommand[]; global: QuickCommand[]; projectLabel: string | null }
  onQuickCommand: (command: QuickCommand) => void
  onAddQuickCommand: () => void
}

/** Opens at the pointer: a 1px trigger is moved there, as Orca anchors its terminal menu. */
export function TerminalContextMenu({
  open,
  point,
  onOpenChange,
  ...actions
}: TerminalMenuActions & {
  open: boolean
  point: { x: number; y: number }
  onOpenChange: (open: boolean) => void
}) {
  const { project, global, projectLabel } = actions.quickCommands
  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange} modal={false}>
      <DropdownMenuTrigger asChild>
        <button
          aria-hidden
          tabIndex={-1}
          className="pointer-events-none absolute size-px opacity-0"
          style={{ left: point.x, top: point.y }}
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        className="w-60"
        sideOffset={0}
        align="start"
        data-terminal-context-menu
        // Keep xterm focused instead of Radix's hidden trigger.
        onCloseAutoFocus={(e) => e.preventDefault()}
      >
        <DropdownMenuItem onSelect={actions.onCopy}>
          <Copy />
          Copy
          <DropdownMenuShortcut>{TERMINAL_SHORTCUT_LABELS.copy}</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={actions.onSelectAll}>
          <TextSelect />
          Select All
          <DropdownMenuShortcut>{TERMINAL_SHORTCUT_LABELS.selectAll}</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={actions.onPaste}>
          <Clipboard />
          Paste
          <DropdownMenuShortcut>{TERMINAL_SHORTCUT_LABELS.paste}</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={actions.onFind}>
          <Search />
          Find
          <DropdownMenuShortcut>{TERMINAL_SHORTCUT_LABELS.search}</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger data-quick-commands-submenu>
            <Play fill="currentColor" strokeWidth={0} />
            Quick Commands
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="w-60">
            {project.length + global.length === 0 ? (
              <DropdownMenuItem disabled className="text-muted-foreground">
                No quick commands
              </DropdownMenuItem>
            ) : (
              <>
                {projectLabel && project.length > 0 && <DropdownMenuLabel className="truncate">{projectLabel}</DropdownMenuLabel>}
                {project.map((command) => (
                  <QuickCommandRow key={command.id} command={command} onRun={actions.onQuickCommand} />
                ))}
                {project.length > 0 && global.length > 0 && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuLabel>Global</DropdownMenuLabel>
                  </>
                )}
                {global.map((command) => (
                  <QuickCommandRow key={command.id} command={command} onRun={actions.onQuickCommand} />
                ))}
              </>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={() => {
                // Close the menu before its dialog mounts above it.
                onOpenChange(false)
                actions.onAddQuickCommand()
              }}
            >
              <Plus />
              Add Quick Command…
            </DropdownMenuItem>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        {actions.onSplit ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="whitespace-nowrap" onSelect={() => actions.onSplit?.('right')}>
              <PanelRightClose />
              Split Terminal Right
            </DropdownMenuItem>
            <DropdownMenuItem className="whitespace-nowrap" onSelect={() => actions.onSplit?.('down')}>
              <PanelBottomClose />
              Split Terminal Down
            </DropdownMenuItem>
          </>
        ) : null}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={() => {
            onOpenChange(false)
            actions.onSetTitle()
          }}
        >
          <Pencil />
          Set Title…
        </DropdownMenuItem>
        {actions.onClearTitle && (
          <DropdownMenuItem onSelect={actions.onClearTitle}>
            <Eraser />
            Clear Title
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onSelect={actions.onCopyTerminalId}>
          <Copy />
          Copy Terminal ID
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onSelect={actions.onClose}>
          <X />
          Close Terminal
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={actions.onClearScreen}>
          <Eraser />
          Clear Screen
          <DropdownMenuShortcut>{TERMINAL_SHORTCUT_LABELS.clear}</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={actions.onResetTerminal}>
          <RotateCcw />
          Reset Terminal
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={actions.onRestart}>
          <RotateCw />
          Restart Terminal
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function QuickCommandRow({ command, onRun }: { command: QuickCommand; onRun: (command: QuickCommand) => void }) {
  return (
    <DropdownMenuItem onSelect={() => onRun(command)} data-quick-command={command.label}>
      <QuickCommandIcon command={command} size={14} />
      <span className="min-w-0 flex-1 truncate">{command.label}</span>
      {command.action === 'terminal-command' && !command.appendEnter && (
        <DropdownMenuShortcut className="shrink-0">Insert</DropdownMenuShortcut>
      )}
    </DropdownMenuItem>
  )
}
