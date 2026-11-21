import { Bot, Hand } from 'lucide-react'
import { HARNESS_METHODS, type TerminalInfo } from '@zomfy/protocol'
import { harnessRequest } from '@/daemon-connection'
import type { HostId } from '@/session-store'
import { Button } from '@/components/ui/button'
import { t } from '@/i18n/i18n'

// Over a terminal an agent types into (terminal_send): who is typing, and the person's way to take
// it back. Typing in the terminal takes it back too; then agents wait until it is handed back.

function setControl(terminal: TerminalInfo & { hostId: HostId }, action: 'hold' | 'release'): void {
  void harnessRequest(HARNESS_METHODS.terminalAgentControl, { terminalId: terminal.id, action }, terminal.hostId).catch(() => undefined)
}

export function TerminalAgentControlBar({ terminal }: { terminal: TerminalInfo & { hostId: HostId } }) {
  const control = terminal.agentControl
  if (!control || terminal.exitCode !== null) return null
  const chat = control.chatTitle || t('An agent')
  return control.state === 'driving' ? (
    <div
      className="flex shrink-0 items-center gap-2 border-t border-highlight/40 bg-highlight/10 px-3 py-1 text-xs"
      data-terminal-agent-control="driving"
    >
      <Bot className="size-3.5 shrink-0 text-highlight" />
      <span className="min-w-0 flex-1 truncate">{t('{chat} is typing in this terminal. Type here or press Stop to take it back.', { chat })}</span>
      <Button type="button" size="xs" variant="outline" onClick={() => setControl(terminal, 'hold')} data-terminal-agent-stop>
        <Hand className="size-3" />
        {t('Stop')}
      </Button>
    </div>
  ) : (
    <div className="flex shrink-0 items-center gap-2 border-t border-border bg-muted/40 px-3 py-1 text-xs" data-terminal-agent-control="held">
      <Hand className="size-3.5 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1 truncate text-muted-foreground">{t('You have this terminal: agents cannot type into it.')}</span>
      <Button type="button" size="xs" variant="ghost" onClick={() => setControl(terminal, 'release')} data-terminal-agent-release>
        <Bot className="size-3" />
        {t('Let agents type again')}
      </Button>
    </div>
  )
}
