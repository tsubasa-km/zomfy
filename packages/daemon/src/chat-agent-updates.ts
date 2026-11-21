import { readFile, realpath } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { ChatAgentId, ChatAgentUpdate } from '@zomfy/protocol'
import { log } from './log.ts'

// Newer releases of the npm packages chat agents run (Codex and its ACP adapter, OpenCode…).
// npm has no way to tell a client about a release, so the daemon asks the registry: when it
// starts, every few hours after, and whenever someone refreshes the agent list. Each ask is one
// small request per package, and the installed version comes from the package.json next to the
// command on PATH, so an agent installed some other way (a native installer) is simply skipped.

export interface NpmPackage {
  name: string
  /** The command the package puts on PATH, which locates the installed copy. */
  bin: string
}

const CHECK_EVERY_MS = 6 * 60 * 60 * 1000
const FIRST_CHECK_DELAY_MS = 30_000
/** A refresh within this long reuses the registry's last answer. */
const REGISTRY_FRESH_MS = 30 * 60 * 1000
const REGISTRY_TIMEOUT_MS = 10_000
const REGISTRY = 'https://registry.npmjs.org'

const latestByPackage = new Map<string, { version: string | null; at: number }>()
let updates = new Map<ChatAgentId, ChatAgentUpdate>()

export function agentUpdate(agent: ChatAgentId): ChatAgentUpdate | null {
  return updates.get(agent) ?? null
}

/**
 * Compares each agent's installed packages with the registry's latest. `network: false` only
 * re-reads installed versions (after an install). Resolves true when any agent's update changed.
 */
export async function checkAgentUpdates(
  agents: { id: ChatAgentId; packages: NpmPackage[] }[],
  locate: (bin: string) => Promise<string | null>,
  { network }: { network: boolean }
): Promise<boolean> {
  const next = new Map<ChatAgentId, ChatAgentUpdate>()
  await Promise.all(
    agents.map(async ({ id, packages }) => {
      for (const pkg of packages) {
        const path = await locate(pkg.bin)
        const installed = path ? await installedVersion(path, pkg.name) : null
        if (!installed) continue
        const latest = await latestVersion(pkg.name, network)
        if (latest && compareVersions(installed, latest) < 0) {
          next.set(id, { packageName: pkg.name, installed, latest })
          return
        }
      }
    })
  )
  const changed = JSON.stringify([...next].sort()) !== JSON.stringify([...updates].sort())
  updates = next
  if (changed) log(`agent updates: ${[...next].map(([id, u]) => `${id} ${u.packageName} ${u.installed} → ${u.latest}`).join(', ') || 'none'}`)
  return changed
}

/** Checks now (after a short delay, off the daemon's startup path) and every few hours after. */
export function scheduleAgentUpdateChecks(check: () => Promise<void>): void {
  const run = () => void check().catch((error: unknown) => log(`agent update check failed: ${String(error)}`))
  setTimeout(run, FIRST_CHECK_DELAY_MS).unref?.()
  setInterval(run, CHECK_EVERY_MS).unref?.()
}

/** The version in the package.json of `name` that holds this command (a shim's target or a symlink). */
async function installedVersion(command: string, name: string): Promise<string | null> {
  let dir = dirname(await realpath(command).catch(() => command))
  for (let depth = 0; depth < 6; depth++) {
    const manifest = await readFile(join(dir, 'package.json'), 'utf8')
      .then((text) => JSON.parse(text) as { name?: unknown; version?: unknown })
      .catch(() => null)
    if (manifest?.name === name) return typeof manifest.version === 'string' ? manifest.version : null
    // Global installs keep packages under node_modules next to the command's shim.
    const nested = await readFile(join(dir, 'node_modules', name, 'package.json'), 'utf8')
      .then((text) => JSON.parse(text) as { version?: unknown })
      .catch(() => null)
    if (typeof nested?.version === 'string') return nested.version
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return null
}

async function latestVersion(name: string, network: boolean): Promise<string | null> {
  const cached = latestByPackage.get(name)
  if (cached && (!network || Date.now() - cached.at < REGISTRY_FRESH_MS)) return cached.version
  if (!network) return null
  try {
    const response = await fetch(`${REGISTRY}/${name}/latest`, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(REGISTRY_TIMEOUT_MS)
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const { version } = (await response.json()) as { version?: unknown }
    const latest = typeof version === 'string' ? version : null
    latestByPackage.set(name, { version: latest, at: Date.now() })
    return latest
  } catch (error) {
    log(`npm latest for ${name} failed: ${String(error)}`)
    return cached?.version ?? null
  }
}

/** Semver order on the numeric core; a prerelease sorts before its release. */
export function compareVersions(a: string, b: string): number {
  const [coreA = '', preA] = a.split('-', 2)
  const [coreB = '', preB] = b.split('-', 2)
  const pa = coreA.split('.').map(Number)
  const pb = coreB.split('.').map(Number)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d !== 0) return Number.isNaN(d) ? 0 : d
  }
  if (preA && !preB) return -1
  if (!preA && preB) return 1
  return 0
}
