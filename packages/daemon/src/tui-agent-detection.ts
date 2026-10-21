import { delimiter } from 'node:path'
import { TUI_AGENTS, type DetectedAgents, type TuiAgentId } from '@acp-harness/protocol'
import { log } from './log.ts'

// Detection runs on the daemon's own host (Windows, or Linux inside WSL), as Orca's preflight does
// on its execution host: a CLI installed on the client says nothing about this machine.

const HYDRATE_TIMEOUT_MS = 5_000

let pathPromise: Promise<string> | null = null
let detected: Promise<DetectedAgents> | null = null

/** PATH as a fresh shell would see it, so a CLI installed after the daemon started is found. */
export function hostPath(refresh = false): Promise<string> {
  if (refresh || !pathPromise) pathPromise = readHostPath()
  return pathPromise
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

async function readHostPath(): Promise<string> {
  const current = process.env.PATH ?? process.env.Path ?? ''
  try {
    const extra = process.platform === 'win32' ? await persistedWindowsPath() : await loginShellPath()
    return mergePath(current, extra)
  } catch (error) {
    log(`PATH hydration failed: ${error instanceof Error ? error.message : String(error)}`)
    return current
  }
}

function mergePath(current: string, extra: string): string {
  const seen = new Set<string>()
  const out: string[] = []
  for (const segment of [...current.split(delimiter), ...extra.split(delimiter)]) {
    const key = process.platform === 'win32' ? segment.toLowerCase() : segment
    if (!segment || seen.has(key)) continue
    seen.add(key)
    out.push(segment)
  }
  return out.join(delimiter)
}

/** The user's login shell PATH (nvm, ~/.local/bin, …), which a daemon started by wsl.exe lacks. */
async function loginShellPath(): Promise<string> {
  const shell = process.env.SHELL || '/bin/bash'
  const marker = '__ACP_HARNESS_PATH__'
  const proc = Bun.spawn([shell, '-ilc', `printf '${marker}%s${marker}' "$PATH"`], {
    stdin: 'ignore',
    stdout: 'pipe',
    stderr: 'ignore',
    windowsHide: true
  })
  const timer = setTimeout(() => proc.kill(), HYDRATE_TIMEOUT_MS)
  const output = await new Response(proc.stdout).text()
  clearTimeout(timer)
  // Fenced, because interactive rc files may print banners to stdout.
  return output.split(marker)[1] ?? ''
}

/** User and machine PATH from the registry, expanded; what a newly opened console would get. */
async function persistedWindowsPath(): Promise<string> {
  const keys = ['HKCU\\Environment', 'HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment']
  const parts = await Promise.all(
    keys.map(async (key) => {
      const proc = Bun.spawn(['reg.exe', 'query', key, '/v', 'Path'], {
        stdin: 'ignore',
        stdout: 'pipe',
        stderr: 'ignore',
        windowsHide: true
      })
      const text = await new Response(proc.stdout).text()
      const value = /\s+Path\s+REG_(?:EXPAND_)?SZ\s+(.*)/i.exec(text)?.[1]?.trim() ?? ''
      return value.replace(/%([^%]+)%/g, (match, name: string) => process.env[name] ?? match)
    })
  )
  return parts.filter(Boolean).join(delimiter)
}
