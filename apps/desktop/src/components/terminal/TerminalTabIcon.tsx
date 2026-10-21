import { SquareTerminal } from 'lucide-react'
import { TUI_AGENTS, type TerminalInfo } from '@acp-harness/protocol'
import { TuiAgentIcon } from '@/components/terminal/TuiAgentIcon'
import { cn } from '@/lib/utils'

/** Names too generic to read an agent from a title. */
const TITLE_AMBIGUOUS = new Set(['pi', 'continue', 'cursor'])

/**
 * The agent a terminal is running: the one it was launched with, else one its title names, as
 * Orca recognises an agent the user started by hand from its OSC title.
 */
export function terminalAgent(terminal: Pick<TerminalInfo, 'agent' | 'title' | 'customTitle'>): string | null {
  if (terminal.agent) return terminal.agent
  if (terminal.customTitle) return null
  const words = terminal.title.toLowerCase().split(/[^a-z0-9-]+/)
  return (
    TUI_AGENTS.find(
      (a) => !TITLE_AMBIGUOUS.has(a.id) && (words.includes(a.detectCmd) || words.includes(a.label.toLowerCase()))
    )?.id ?? null
  )
}

/** Leading tab icon: the agent's mark for agent tabs, the terminal glyph otherwise. */
export function TerminalTabIcon({ terminal, className }: { terminal: TerminalInfo; className?: string }) {
  const agent = terminalAgent(terminal)
  if (!agent) return <SquareTerminal className={cn('size-3.5', className)} />
  return (
    <span className="inline-flex shrink-0" data-agent-icon={agent} aria-hidden>
      <TuiAgentIcon agent={agent} size={12} />
    </span>
  )
}
