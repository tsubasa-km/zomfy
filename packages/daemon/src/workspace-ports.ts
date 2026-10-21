import { resolve, sep } from 'node:path'
import type { ListeningPort, PortAttribution, PortScanResult, Workspace } from '@acp-harness/protocol'
import { readProcesses, scanListeners, type ProcessEntry, type RawListener } from './listening-ports.ts'

// Wildcard and loopback binds both open as localhost.
const LOCALHOST_BINDS = new Set(['*', '0.0.0.0', '::', '::0', '127.0.0.1', '::1'])
const MAX_ANCESTRY = 64

/**
 * Every listener on this host, tied to a workspace when it descends from one of that workspace's
 * terminals or runs inside its folder (Orca's cwd/command attribution, by process tree here).
 */
export async function scanWorkspacePorts(
  workspaces: Pick<Workspace, 'id' | 'path'>[],
  shellPids: Map<number, string>
): Promise<PortScanResult> {
  const base = { platform: process.platform, scannedAt: Date.now() }
  let raw: RawListener[]
  try {
    raw = dedupe(await scanListeners())
  } catch (error) {
    return { ...base, ports: [], unavailableReason: error instanceof Error ? error.message : String(error) }
  }
  const processes = await readProcesses(new Set(raw.flatMap((l) => (l.pid ? [l.pid] : [])))).catch(
    () => new Map<number, ProcessEntry>()
  )
  // Longest path first, so a worktree nested in its project's folder wins.
  const roots = workspaces
    .map((w) => ({ id: w.id, path: comparable(w.path) }))
    .sort((a, b) => b.path.length - a.path.length)

  const ports = raw.map((listener): ListeningPort => {
    const owner = listener.pid ? attribute(listener.pid, processes, shellPids, roots) : null
    return {
      id: `${listener.pid ?? 0}:${listener.host}:${listener.port}`,
      port: listener.port,
      bindHost: listener.host,
      connectHost: LOCALHOST_BINDS.has(listener.host) ? 'localhost' : listener.host,
      pid: listener.pid,
      processName: (listener.pid && processes.get(listener.pid)?.name) || null,
      workspaceId: owner?.workspaceId ?? null,
      attribution: owner?.attribution ?? null
    }
  })
  ports.sort((a, b) => a.port - b.port)
  return { ...base, ports }
}

function attribute(
  pid: number,
  processes: Map<number, ProcessEntry>,
  shellPids: Map<number, string>,
  roots: { id: string; path: string }[]
): { workspaceId: string; attribution: PortAttribution } | null {
  const seen = new Set<number>()
  for (let current: number | null = pid; current && !seen.has(current) && seen.size < MAX_ANCESTRY; ) {
    seen.add(current)
    const workspaceId = shellPids.get(current)
    if (workspaceId) return { workspaceId, attribution: 'terminal' }
    current = processes.get(current)?.ppid ?? null
  }
  const cwd = processes.get(pid)?.cwd
  if (cwd) {
    const path = comparable(cwd)
    const root = roots.find((r) => path === r.path || path.startsWith(r.path + sep))
    if (root) return { workspaceId: root.id, attribution: 'cwd' }
  }
  return null
}

function comparable(path: string): string {
  const absolute = resolve(path)
  return process.platform === 'win32' || process.platform === 'darwin' ? absolute.toLowerCase() : absolute
}

/** One row per process and port: a dual-stack server binds both 0.0.0.0 and ::. */
function dedupe(listeners: RawListener[]): RawListener[] {
  const byKey = new Map<string, RawListener>()
  for (const listener of listeners) {
    const key = `${listener.pid ?? listener.host}:${listener.port}`
    const existing = byKey.get(key)
    if (!existing || (!existing.host.includes('.') && listener.host.includes('.'))) byKey.set(key, listener)
  }
  return [...byKey.values()]
}

/** Stops a listener's process, only when the current scan still ties it to a workspace. */
export async function killWorkspacePort(
  workspaces: Pick<Workspace, 'id' | 'path'>[],
  shellPids: Map<number, string>,
  pid: number,
  port: number
): Promise<void> {
  if (pid === process.pid) throw new Error('Refusing to stop the harness daemon')
  const scan = await scanWorkspacePorts(workspaces, shellPids)
  const listener = scan.ports.find((p) => p.pid === pid && p.port === port)
  if (!listener) throw new Error(`Nothing is listening on :${port} with PID ${pid} any more`)
  if (!listener.workspaceId) throw new Error(`:${port} does not belong to a workspace; stop it yourself`)
  process.kill(pid)
}
