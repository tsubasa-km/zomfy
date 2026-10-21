export interface TerminalInfo {
  id: string
  workspaceId: string
  title: string
  /** Shell program the terminal was started with. */
  shell: string
  cwd: string
  createdAt: number
  /** null while the shell runs. */
  exitCode: number | null
}

export interface ShellOption {
  id: string
  label: string
}

export interface TerminalOutput {
  terminalId: string
  data: string
}

export const TERMINAL_METHODS = {
  shellsList: '_harness/terminals/shells',
  terminalsList: '_harness/terminals/list',
  terminalCreate: '_harness/terminals/create',
  terminalAttach: '_harness/terminals/attach',
  terminalInput: '_harness/terminals/input',
  terminalResize: '_harness/terminals/resize',
  terminalClose: '_harness/terminals/close'
} as const

export interface TerminalRequests {
  [TERMINAL_METHODS.shellsList]: { params: Record<string, never>; result: ShellOption[] }
  [TERMINAL_METHODS.terminalsList]: { params: Record<string, never>; result: TerminalInfo[] }
  [TERMINAL_METHODS.terminalCreate]: {
    params: { workspaceId: string; shellId?: string; cols: number; rows: number }
    result: TerminalInfo
  }
  /** Recent output, so a reloaded window repaints the screen before live output resumes. */
  [TERMINAL_METHODS.terminalAttach]: { params: { terminalId: string }; result: { buffer: string } }
  [TERMINAL_METHODS.terminalInput]: { params: { terminalId: string; data: string }; result: Record<string, never> }
  [TERMINAL_METHODS.terminalResize]: {
    params: { terminalId: string; cols: number; rows: number }
    result: Record<string, never>
  }
  [TERMINAL_METHODS.terminalClose]: { params: { terminalId: string }; result: Record<string, never> }
}
