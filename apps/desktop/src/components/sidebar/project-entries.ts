import type { ProjectLink } from '@acp-harness/protocol'
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

export interface LinkedEntry {
  /** The link's main member present here (its first), or the project itself when unlinked. */
  primary: HostedProject
  copies: HostedProject[]
}

/** Projects in display order, each link folded into the place of its first member listed. */
export function linkedEntries(projects: HostedProject[], links: ProjectLink[]): LinkedEntry[] {
  const key = (hostId: HostId, projectId: string) => `${hostId}:${projectId}`
  const byKey = new Map(projects.map((p) => [key(p.hostId, p.id), p]))
  const linkOfKey = new Map(links.flatMap((l) => l.members.map((m) => [key(m.hostId, m.projectId), l] as const)))
  const done = new Set<string>()
  const entries: LinkedEntry[] = []
  for (const project of projects) {
    const link = linkOfKey.get(key(project.hostId, project.id))
    if (!link) {
      entries.push({ primary: project, copies: [] })
      continue
    }
    if (done.has(link.id)) continue
    done.add(link.id)
    const present = link.members.flatMap((m) => byKey.get(key(m.hostId, m.projectId)) ?? [])
    entries.push({ primary: present[0]!, copies: present.slice(1) })
  }
  return entries
}
