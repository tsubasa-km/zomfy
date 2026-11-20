import type { CatalogProject } from '@acp-harness/protocol'
import type { HostEntry, HostedProject, HostId } from '@/session-store'

// One list of projects across every host: where a project lives is a badge, not a section, so the
// person picks work rather than machines.

/** Short host names: "WSL" (the distro when there are several), the SSH alias, "Windows". */
export function shortHostNames(hosts: HostEntry[]): Record<HostId, string> {
  const wslCount = hosts.filter((h) => h.id.startsWith('wsl:')).length
  const short = (h: HostEntry) =>
    h.id.startsWith('wsl:') ? (wslCount > 1 ? h.id.slice(4) : 'WSL') : h.id.startsWith('ssh:') ? h.id.slice(4) : h.label
  return Object.fromEntries(hosts.map((h) => [h.id, short(h)]))
}

export interface ProjectEntry {
  /** The project's main location present here (its first), or the host project itself when alone. */
  primary: HostedProject
  copies: HostedProject[]
}

/** Projects in display order, each catalog project folded into the place of its first location listed. */
export function projectEntries(projects: HostedProject[], catalog: CatalogProject[]): ProjectEntry[] {
  const key = (hostId: HostId, projectId: string) => `${hostId}:${projectId}`
  const byKey = new Map(projects.map((p) => [key(p.hostId, p.id), p]))
  const entryOfKey = new Map(catalog.flatMap((e) => e.locations.map((l) => [key(l.hostId, l.projectId), e] as const)))
  const done = new Set<string>()
  const entries: ProjectEntry[] = []
  for (const project of projects) {
    const entry = entryOfKey.get(key(project.hostId, project.id))
    if (!entry || entry.locations.length < 2) {
      entries.push({ primary: project, copies: [] })
      continue
    }
    if (done.has(entry.id)) continue
    done.add(entry.id)
    const present = entry.locations.flatMap((l) => byKey.get(key(l.hostId, l.projectId)) ?? [])
    entries.push({ primary: present[0]!, copies: present.slice(1) })
  }
  return entries
}
