import type { TuiAgentId } from './tui-agents'

/** The command grammar a terminal's shell reads, for quoting typed or dropped text. */
export type TerminalShellKind = 'posix' | 'powershell' | 'cmd'

/** A chat code block a terminal runs under, instead of being a tab. */
export interface InlineTerminalAnchor {
  sessionId: string
  /** Identifies the block within the chat (row and source line). */
  blockKey: string
}

export interface TerminalInfo {
  id: string
  workspaceId: string
  /** The title to show: the user's own title, else the latest OSC title, else the shell's label. */
  title: string
  /** Shell program the terminal was started with. */
  shell: string
  /** Optional so older daemons stay readable. */
  shellId?: string
  shellKind?: TerminalShellKind
  /** Follows OSC 7 when the shell reports directory changes. */
  cwd: string
  createdAt: number
  /** Bumped by a restart, so views know to drop the old screen. */
  startedAt?: number
  /** null while the shell runs. */
  exitCode: number | null
  /** Agent CLI the tab was launched with. */
  agent?: TuiAgentId | null
  /** Title set with "Set Title…"; wins over OSC titles. */
  customTitle?: string | null
  /** Set while the terminal shows under a chat code block; null or absent for a tab. */
  inline?: InlineTerminalAnchor | null
}

export interface ShellOption {
  id: string
  label: string
}

export interface TerminalOutput {
  terminalId: string
  data: string
}

export interface DetectedAgents {
  agents: TuiAgentId[]
  /** The daemon host's platform; the probe ran there, not on the client. */
  platform: string
}

export type QuickCommandScope = { type: 'global' } | { type: 'project'; projectId: string }

interface QuickCommandBase {
  id: string
  label: string
  scope: QuickCommandScope
}

export type QuickCommand =
  | (QuickCommandBase & { action: 'terminal-command'; command: string; appendEnter: boolean })
  | (QuickCommandBase & { action: 'agent-prompt'; agent: TuiAgentId; prompt: string })

export interface CreateTerminalParams {
  workspaceId: string
  shellId?: string
  cols: number
  rows: number
  /** Launches this agent CLI in the new shell. */
  agent?: TuiAgentId
  /** Initial prompt for `agent`. */
  prompt?: string
  /** Typed verbatim into the shell once it is ready; end it with a carriage return to run it (quick commands). */
  command?: string
  /** Starts the terminal under a chat code block rather than as a tab. */
  inline?: InlineTerminalAnchor
}

export const TERMINAL_METHODS = {
  shellsList: '_harness/terminals/shells',
  terminalsList: '_harness/terminals/list',
  terminalCreate: '_harness/terminals/create',
  terminalAttach: '_harness/terminals/attach',
  terminalInput: '_harness/terminals/input',
  terminalResize: '_harness/terminals/resize',
  terminalClose: '_harness/terminals/close',
  terminalRestart: '_harness/terminals/restart',
  terminalRename: '_harness/terminals/rename',
  terminalSetInline: '_harness/terminals/setInline',
  terminalResolvePaths: '_harness/terminals/resolvePaths',
  agentsDetect: '_harness/terminals/agents',
  quickCommandsList: '_harness/quickCommands/list',
  quickCommandSave: '_harness/quickCommands/save',
  quickCommandRemove: '_harness/quickCommands/remove'
} as const

export interface TerminalRequests {
  [TERMINAL_METHODS.shellsList]: { params: Record<string, never>; result: ShellOption[] }
  [TERMINAL_METHODS.terminalsList]: { params: Record<string, never>; result: TerminalInfo[] }
  [TERMINAL_METHODS.terminalCreate]: { params: CreateTerminalParams; result: TerminalInfo }
  /** Recent output, so a reloaded window repaints the screen before live output resumes. */
  [TERMINAL_METHODS.terminalAttach]: { params: { terminalId: string }; result: { buffer: string } }
  [TERMINAL_METHODS.terminalInput]: { params: { terminalId: string; data: string }; result: Record<string, never> }
  [TERMINAL_METHODS.terminalResize]: {
    params: { terminalId: string; cols: number; rows: number }
    result: Record<string, never>
  }
  [TERMINAL_METHODS.terminalClose]: { params: { terminalId: string }; result: Record<string, never> }
  /** Starts the tab's shell (and agent, without its prompt) again in place. */
  [TERMINAL_METHODS.terminalRestart]: { params: { terminalId: string }; result: TerminalInfo }
  /** null clears the custom title. */
  [TERMINAL_METHODS.terminalRename]: { params: { terminalId: string; title: string | null }; result: TerminalInfo }
  /** null turns an inline terminal into an ordinary tab. */
  [TERMINAL_METHODS.terminalSetInline]: {
    params: { terminalId: string; inline: InlineTerminalAnchor | null }
    result: TerminalInfo
  }
  /**
   * Resolves path text printed in a terminal against its cwd on the daemon host. Each entry is the
   * workspace-relative path of an existing file inside the terminal's workspace, else null.
   */
  [TERMINAL_METHODS.terminalResolvePaths]: {
    params: { terminalId: string; paths: string[] }
    result: (string | null)[]
  }
  [TERMINAL_METHODS.agentsDetect]: { params: { refresh?: boolean }; result: DetectedAgents }
  [TERMINAL_METHODS.quickCommandsList]: { params: Record<string, never>; result: QuickCommand[] }
  /** Adds the command, or replaces the one with the same id. */
  [TERMINAL_METHODS.quickCommandSave]: { params: { command: QuickCommand }; result: QuickCommand[] }
  [TERMINAL_METHODS.quickCommandRemove]: { params: { id: string }; result: QuickCommand[] }
}
