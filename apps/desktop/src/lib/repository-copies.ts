import type { Project } from '@acp-harness/protocol'
import type { HostId } from '@/session-store'

// One repository added on several hosts (a clone on Windows and in WSL) is one project to the
// person: copies share a remote URL or their first commit. Each host keeps its own project; this
// only decides how the sidebar lists them.

/** `git@github.com:a/b.git`, `https://user@github.com/a/b/` and `ssh://git@github.com/a/b` all read `github.com/a/b`. */
export function normalizeRemote(url: string): string {
  let rest = url.trim().replace(/^[a-z][a-z0-9+.-]*:\/\//i, '')
  rest = rest.replace(/^[^@/]+@/, '')
  // scp-like `host:path` (but not a Windows drive letter).
  rest = rest.replace(/^([^/:]{2,}):(?!\/\/)/, '$1/')
  rest = rest.replace(/\/+$/, '').replace(/\.git$/i, '')
  const slash = rest.indexOf('/')
  return slash === -1 ? rest.toLowerCase() : rest.slice(0, slash).toLowerCase() + rest.slice(slash)
}

export interface ProjectCopies<T> {
  /** The copy the list shows: the one on `preferredHost`, else the first in order. */
  primary: T
  /** The other hosts' copies, at most one per host. */
  copies: T[]
}

/** Groups `projects` (in display order) into copies of one repository across hosts. */
export function groupRepositoryCopies<T extends Project & { hostId: HostId }>(projects: T[], preferredHost: HostId): ProjectCopies<T>[] {
  const parent = projects.map((_, i) => i)
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i]!)))
  const owner = new Map<string, number>()
  projects.forEach((p, i) => {
    if (p.kind !== 'git') return
    const keys = [p.remoteUrl ? `remote:${normalizeRemote(p.remoteUrl)}` : null, p.rootCommit ? `root:${p.rootCommit}` : null]
    for (const key of keys) {
      if (!key) continue
      const seen = owner.get(key)
      if (seen === undefined) owner.set(key, i)
      else parent[find(i)] = find(seen)
    }
  })
  const components = new Map<number, number[]>()
  projects.forEach((_, i) => components.set(find(i), [...(components.get(find(i)) ?? []), i]))

  const result: { at: number; entry: ProjectCopies<T> }[] = []
  for (const members of components.values()) {
    // One copy per host: two clones on the same host are different projects to work in.
    const byHost = new Map<HostId, number>()
    const extras: number[] = []
    for (const i of members) {
      if (byHost.has(projects[i]!.hostId)) extras.push(i)
      else byHost.set(projects[i]!.hostId, i)
    }
    const merged = [...byHost.values()]
    const primaryAt = merged.find((i) => projects[i]!.hostId === preferredHost) ?? merged[0]!
    result.push({
      at: Math.min(...merged),
      entry: { primary: projects[primaryAt]!, copies: merged.filter((i) => i !== primaryAt).map((i) => projects[i]!) }
    })
    for (const i of extras) result.push({ at: i, entry: { primary: projects[i]!, copies: [] } })
  }
  return result.sort((a, b) => a.at - b.at).map((r) => r.entry)
}
