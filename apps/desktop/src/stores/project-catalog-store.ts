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
  pinSharedNames()
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

const hostProject = (location: ProjectLocation) =>
  getState().hosts[location.hostId]?.harness?.projects.find((p) => p.id === location.projectId)

/**
 * Where the project `location` belongs to keeps its workflows and runs its lead agent: its main
 * location, unless that host is gone from this window (removed), when the first one still here.
 */
export function mainLocationOf(location: ProjectLocation): ProjectLocation {
  const { locations } = catalogEntryOf(location)
  const { hosts } = getState()
  return locations.find((l) => hosts[l.hostId]) ?? location
}

/**
 * The name the project holding `location` goes by when it is not `location`'s own: the name the
 * catalog keeps for it. A project on one host goes by that host's name for it, which every
 * computer connecting to the host sees; a project on several hosts gets its name kept here.
 */
export function catalogNameOf(location: ProjectLocation, catalog: CatalogProject[] = store.get()): string | null {
  const entry = catalog.find((p) => p.locations.some((l) => sameLocation(l, location)))
  if (!entry) return null
  if (entry.name) return entry.name
  // Not pinned yet (pinSharedNames waits for the main host): its main location's name, when known.
  const main = entry.locations[0]
  if (!main || sameLocation(main, location)) return null
  const project = hostProject(main)
  return project ? (project.displayName ?? project.name) : null
}

/** Projects already given a name here, so one that fails is not asked again and again. */
const pinned = new Set<string>()

/**
 * A project on several hosts keeps one name, so it does not change with which host has connected:
 * the first time its main location's name is known, that becomes the catalog's name for it.
 */
function pinSharedNames(): void {
  for (const entry of store.get()) {
    if (entry.name || entry.locations.length < 2 || pinned.has(entry.id)) continue
    const main = hostProject(entry.locations[0]!)
    if (!main) continue
    pinned.add(entry.id)
    void harnessRequest(HARNESS_METHODS.projectCatalogRename, { id: entry.id, name: main.displayName ?? main.name }, LOCAL_HOST)
      .then((catalog) => store.set(catalog))
      .catch((error) => console.warn('Could not name a project in the catalog', error))
  }
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
  } catch (error) {
    // This computer's daemon is not up yet or refused it: the next change to the host retries.
    reported.delete(hostId)
    console.warn(`Could not report ${hostId}'s projects to the catalog`, error)
  }
}

let seenHosts: unknown = null

function syncConnectedHosts(): void {
  const { hosts } = getState()
  // Most store changes are chats streaming; only a change to the hosts can change their projects.
  if (hosts === seenHosts) return
  seenHosts = hosts
  // A main host that connected late may now give a shared project its name.
  pinSharedNames()
  if (hosts[LOCAL_HOST]?.connection.kind !== 'connected') return
  for (const host of Object.values(hosts)) {
    if (host.connection.kind === 'connected' && host.harness) void syncHost(host.id)
  }
}

let subscribed = false

/** Once this computer's daemon is up: loads the catalog and reports every host's projects as they change. */
export async function startProjectCatalog(): Promise<void> {
  reported.clear()
  seenHosts = null
  try {
    setProjectCatalog(await harnessRequest(HARNESS_METHODS.projectCatalogList, {}, LOCAL_HOST))
  } catch {
    return
  }
  if (!subscribed) subscribeStore(syncConnectedHosts)
  subscribed = true
  syncConnectedHosts()
}
