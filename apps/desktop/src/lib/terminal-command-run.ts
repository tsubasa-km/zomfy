import { HARNESS_METHODS } from '@acp-harness/protocol'
import { createTerminal, harnessRequest } from '@/daemon-connection'

/**
 * A new terminal tab named after the command, every run: an earlier run's tab may still be busy or
 * waiting for input, which no host reports reliably (least of all over SSH), and typing into it
 * would hand our command to that program. Separate tabs also keep each run's output apart.
 */
export async function runCommandInNewTerminal(
  workspaceId: string,
  run: { shellId: string; input: string; title: string }
): Promise<void> {
  // The daemon types `command` once the shell is ready; it is the block's own text plus Enter.
  const terminalId = await createTerminal(workspaceId, run.shellId, { command: run.input })
  if (run.title) {
    await harnessRequest(HARNESS_METHODS.terminalRename, { terminalId, title: run.title }).catch(() => undefined)
  }
}
