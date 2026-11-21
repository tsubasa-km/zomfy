import type { CatalogProject } from '@zomfy/protocol'
import type { HostEntry, HostedProject } from '@/session-store'
import { projectEntries } from '@/components/sidebar/project-entries'
import { sortProjects } from '@/components/sidebar/workspace-visibility'
import { catalogEntryOf } from '@/stores/project-catalog-store'

// The projects to list: one per catalog project, its host projects as its locations. A project's
// host is where one of its copies lives, not a section of its own.

export interface ListedProject {
  /** The catalog project's id. */
  id: string
  /** Its main location present here first; a host project the catalog has not heard of stands alone. */
  locations: HostedProject[]
}

/** `hosts` in the order to list them; a host with no project list (still connecting) adds nothing. */
export function listedProjects(hosts: HostEntry[], catalog: CatalogProject[]): ListedProject[] {
  const projects = hosts.flatMap((h) => sortProjects(h.harness?.projects ?? []).map((p): HostedProject => ({ ...p, hostId: h.id })))
  return projectEntries(projects, catalog).map(({ primary, copies }) => ({
    id: catalogEntryOf({ hostId: primary.hostId, projectId: primary.id }, catalog).id,
    locations: [primary, ...copies]
  }))
}
