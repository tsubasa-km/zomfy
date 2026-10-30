import { Maximize2, Minimize2, Minus } from 'lucide-react'
import { chatAgentLabel, isChatAgentId } from '@acp-harness/protocol'
import { createSession } from '@/daemon-connection'
import { useSetting } from '@/stores/settings-store'
import { useShortcutLabel } from '@/keybindings/keybinding-registry'
import { TuiAgentIcon } from '@/components/terminal/TuiAgentIcon'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { t } from '@/i18n/i18n'

// Orca's FloatingTerminalWindowControls: launch the default agent here, maximize/restore, minimize.

const CONTROL = 'border-border bg-secondary text-secondary-foreground shadow-xs hover:bg-accent hover:text-accent-foreground'

function withShortcut(label: string, shortcut: string | null): string {
  return shortcut ? `${label} (${shortcut})` : label
}

function ControlButton({
  label,
  tooltip,
  pressed,
  onClick,
  children
}: {
  label: string
  tooltip: string
  pressed?: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button type="button" variant="outline" size="icon-xs" className={CONTROL} aria-label={label} aria-pressed={pressed} onClick={onClick}>
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom" sideOffset={6}>
        {tooltip}
      </TooltipContent>
    </Tooltip>
  )
}

export function FloatingWorkspaceWindowControls({
  workspaceId,
  maximized,
  onToggleMaximized,
  onMinimize
}: {
  workspaceId: string
  maximized: boolean
  onToggleMaximized: () => void
  onMinimize: () => void
}) {
  const saved = useSetting('defaultChatAgent')
  const agent = isChatAgentId(saved) ? saved : 'claude'
  const agentLabel = t('Open {agent} in floating workspace', { agent: chatAgentLabel(agent) })
  const maximizeShortcut = useShortcutLabel('floatingWorkspace.maximize')
  const minimizeShortcut = useShortcutLabel('floatingWorkspace.minimize')
  return (
    <div className="flex shrink-0 items-center gap-1 px-2" data-floating-workspace-no-drag>
      <ControlButton label={agentLabel} tooltip={agentLabel} onClick={() => void createSession(workspaceId, agent)}>
        <TuiAgentIcon agent={agent} size={14} />
      </ControlButton>
      <ControlButton
        label={maximized ? t('Restore floating workspace') : t('Maximize floating workspace')}
        tooltip={withShortcut(maximized ? t('Restore') : t('Maximize'), maximizeShortcut)}
        pressed={maximized}
        onClick={onToggleMaximized}
      >
        {maximized ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />}
      </ControlButton>
      <ControlButton label={t('Minimize floating workspace')} tooltip={withShortcut(t('Minimize'), minimizeShortcut)} onClick={onMinimize}>
        <Minus className="size-3.5" />
      </ControlButton>
    </div>
  )
}
