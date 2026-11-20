import type { HostId, HostedProject } from '@/session-store'
import type { ListedProject } from '@/lib/catalog-projects'

// The Projects page's selection: rows are catalog projects, and an action on them acts on every
// place each one lives, on the hosts that can be reached.

/** The selected ids still listed, in the list's order: a project that went away drops out. */
export function liveSelection(projects: ListedProject[], ids: string[]): string[] {
  const chosen = new Set(ids)
  return projects.filter((p) => chosen.has(p.id)).map((p) => p.id)
}

/** The selected projects' locations, split by whether their host is connected. */
export function selectedLocations(
  projects: ListedProject[],
  ids: string[],
  connected: (hostId: HostId) => boolean
): { reachable: HostedProject[]; offline: HostedProject[] } {
  const chosen = new Set(ids)
  const locations = projects.filter((p) => chosen.has(p.id)).flatMap((p) => p.locations)
  return {
    reachable: locations.filter((l) => connected(l.hostId)),
    offline: locations.filter((l) => !connected(l.hostId))
  }
}

/** The header checkbox: all, some or none of the shown projects selected. */
export function selectAllState(shown: ListedProject[], ids: string[]): boolean | 'indeterminate' {
  const chosen = new Set(ids)
  const count = shown.filter((p) => chosen.has(p.id)).length
  return count === 0 ? false : count === shown.length ? true : 'indeterminate'
}
