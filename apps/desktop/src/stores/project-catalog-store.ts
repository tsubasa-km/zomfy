import { HARNESS_METHODS, locationKey, type CatalogProject, type ProjectLocation } from '@acp-harness/protocol'
import { harnessRequest } from '@/daemon-connection'
import { getState, LOCAL_HOST, subscribeStore, type HostId } from '@/session-store'
import { setProjectNameLookup } from '@/components/sidebar/workspace-visibility'
import { createExternalStore } from './external-store'

// The project catalog (protocol project-catalog.ts), kept on this computer's daemon: which host
// projects are one project. Each host's project list is reported to it as the host's state changes.

const store = createExternalStore<CatalogProject[]>([])

export function setProjectCatalog(catalog: CatalogProject[]): void {
  store.set(catalog)
}

export function getProjectCatalog(): CatalogProject[] {
  return store.get()
}

export function useProjectCatalog(): CatalogProject[] {
  return store.use((catalog) => catalog)
}

const sameLocation = (a: ProjectLocation, b: ProjectLocation) => a.hostId === b.hostId && a.projectId === b.projectId

/** The entry holding `location`; one of its own until the catalog has heard of it. */
export function catalogEntryOf(location: ProjectLocation, catalog: CatalogProject[] = store.get()): CatalogProject {
  return catalog.find((p) => p.locations.some((l) => sameLocation(l, location))) ?? { id: locationKey(location), locations: [location] }
}

/** Where the project `location` belongs to has its name, its workflows and its lead agent. */
export function mainLocationOf(location: ProjectLocation): ProjectLocation {
  return catalogEntryOf(location).locations[0] ?? location
}

/**
 * The name the project holding `location` goes by when it is not `location`'s own: the name the
 * person gave it, else its main location's name when that is on another host project.
 */
export function catalogNameOf(location: ProjectLocation, catalog: CatalogProject[] = store.get()): string | null {
  const entry = catalog.find((p) => p.locations.some((l) => sameLocation(l, location)))
  if (!entry) return null
  if (entry.name) return entry.name
  const main = entry.locations[0]
  if (!main || sameLocation(main, location)) return null
  const project = getState().hosts[main.hostId]?.harness?.projects.find((p) => p.id === main.projectId)
  return project ? (project.displayName ?? project.name) : null
}

setProjectNameLookup((hostId, projectId) => catalogNameOf({ hostId, projectId }))

/** Names the project holding `location`; null goes back to its main location's name. */
export async function renameProject(location: ProjectLocation, name: string | null): Promise<void> {
  const entry = catalogEntryOf(location)
  if (!store.get().some((p) => p.id === entry.id)) await syncHost(location.hostId as HostId, true)
  setProjectCatalog(await harnessRequest(HARNESS_METHODS.projectCatalogRename, { id: catalogEntryOf(location).id, name }, LOCAL_HOST))
}

/** Moves `location` into the project `to` belongs to. */
export async function placeInProject(to: ProjectLocation, location: ProjectLocation): Promise<void> {
  if (sameLocation(to, location)) return
  const entry = catalogEntryOf(to)
  // A project the catalog has not heard of yet joins it first, so there is an entry to place into.
  if (!store.get().some((p) => p.id === entry.id)) await syncHost(to.hostId as HostId, true)
  setProjectCatalog(await harnessRequest(HARNESS_METHODS.projectCatalogPlace, { to: catalogEntryOf(to).id, location }, LOCAL_HOST))
}

/** Takes a host project out of its project; it lists on its own again. */
export async function detachFromProject(location: ProjectLocation): Promise<void> {
  setProjectCatalog(await harnessRequest(HARNESS_METHODS.projectCatalogDetach, { location }, LOCAL_HOST))
}

/** The project list last reported per host, so an unchanged state sends nothing. */
const reported = new Map<HostId, string>()

async function syncHost(hostId: HostId, force = false): Promise<void> {
  const projectIds = getState().hosts[hostId]?.harness?.projects.map((p) => p.id)
  if (!projectIds) return
  const key = projectIds.join('\n')
  if (!force && reported.get(hostId) === key) return
  reported.set(hostId, key)
  try {
    setProjectCatalog(await harnessRequest(HARNESS_METHODS.projectCatalogSync, { hostId, projectIds }, LOCAL_HOST))
  } catch {
    // An older daemon has no catalog, or this computer's daemon is not up yet: the next change retries.
    reported.delete(hostId)
  }
}

let seenHosts: unknown = null

function syncConnectedHosts(): void {
  const { hosts } = getState()
  // Most store changes are chats streaming; only a change to the hosts can change their projects.
  if (hosts === seenHosts) return
  seenHosts = hosts
  if (hosts[LOCAL_HOST]?.connection.kind !== 'connected') return
  for (const host of Object.values(hosts)) {
    if (host.connection.kind === 'connected' && host.harness) void syncHost(host.id)
  }
}

let stop: (() => void) | null = null

/** Once this computer's daemon is up: loads the catalog and reports every host's projects as they change. */
export async function startProjectCatalog(): Promise<void> {
  reported.clear()
  seenHosts = null
  try {
    setProjectCatalog(await harnessRequest(HARNESS_METHODS.projectCatalogList, {}, LOCAL_HOST))
  } catch {
    return
  }
  stop ??= subscribeStore(syncConnectedHosts)
  syncConnectedHosts()
}
