import { HARNESS_METHODS, type InlineTerminalAnchor } from '@acp-harness/protocol'
import { closeTerminal, createTerminal, harnessRequest } from '@/daemon-connection'
import { getState, selectTerminal, setTerminals } from '@/session-store'

type CommandRun = { shellId: string; input: string; title: string }

/**
 * A new terminal under the code block, every run: an earlier run may still be busy or waiting for
 * input, which no host reports reliably (least of all over SSH), and typing into it would hand our
 * command to that program. The block's previous run is closed; it stays only if opened as a tab.
 */
export async function runCommandInline(workspaceId: string, anchor: InlineTerminalAnchor, run: CommandRun): Promise<void> {
  for (const t of inlineTerminalsOf(anchor)) closeTerminal(t.id)
  // The daemon types `command` once the shell is ready; it is the block's own text plus Enter.
  const terminalId = await createTerminal(workspaceId, run.shellId, { command: run.input, inline: anchor }, { select: false })
  if (run.title) {
    await harnessRequest(HARNESS_METHODS.terminalRename, { terminalId, title: run.title }).catch(() => undefined)
  }
}

export function inlineTerminalsOf(anchor: InlineTerminalAnchor) {
  return getState().terminals.filter(
    (t) => t.inline?.sessionId === anchor.sessionId && t.inline.blockKey === anchor.blockKey
  )
}

/** Turns the block's terminal into an ordinary tab of its workspace and shows it. */
export async function openInlineTerminalAsTab(terminalId: string): Promise<void> {
  const terminal = getState().terminals.find((t) => t.id === terminalId)
  if (!terminal) return
  const info = await harnessRequest(HARNESS_METHODS.terminalSetInline, { terminalId, inline: null }, terminal.hostId)
  const others = getState().terminals.filter((t) => t.hostId === terminal.hostId && t.id !== terminalId)
  setTerminals(terminal.hostId, [...others, info])
  selectTerminal(terminalId)
}
