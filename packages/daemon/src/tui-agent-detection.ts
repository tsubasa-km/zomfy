import { TUI_AGENTS, type DetectedAgents, type TuiAgentId } from '@zomfy/protocol'
import { log } from './log.ts'
import { liveEnvironment, spawnPath } from './user-environment.ts'

// Detection runs on the daemon's own host (Windows, or Linux inside WSL), as Orca's preflight does
// on its execution host: a CLI installed on the client says nothing about this machine.

let detected: Promise<DetectedAgents> | null = null

/** PATH as a fresh shell would see it, so a CLI installed after the daemon started is found
 *  (docs/specs/live-environment.md); `refresh` re-reads the person's environment now. */
export async function hostPath(refresh = false): Promise<string> {
  if (refresh) await liveEnvironment().reload()
  return spawnPath()
}

export function detectInstalledAgents(refresh = false): Promise<DetectedAgents> {
  if (refresh || !detected) {
    detected = (async () => {
      const PATH = await hostPath(refresh)
      const agents = TUI_AGENTS.filter((agent) =>
        [agent.detectCmd, ...('detectAliases' in agent ? agent.detectAliases : [])].some(
          (cmd) => Bun.which(cmd, { PATH }) !== null
        )
      ).map((agent): TuiAgentId => agent.id)
      log(`agents on PATH: ${agents.join(', ') || 'none'}`)
      return { agents, platform: process.platform }
    })()
  }
  return detected
}

