import type { TuiAgentId } from '@acp-harness/protocol'
import { createTerminal } from '@/daemon-connection'

/** Starts an agent CLI in a new terminal tab of the workspace, as Orca's launchAgentInNewTab. */
export function launchAgentTerminal(workspaceId: string, agent: TuiAgentId, prompt?: string): Promise<string> {
  return createTerminal(workspaceId, undefined, { agent, ...(prompt?.trim() ? { prompt } : {}) })
}
