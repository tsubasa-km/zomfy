// The project catalog: the projects the person works on, apart from the hosts they live on. Each
// entry is one project; its locations are the host projects (a repository or folder on one host)
// that hold it, so its workspaces can live in WSL, on an SSH host and on this computer at once.
// Every host project is a location of exactly one entry. Each host still owns its own projects,
// worktrees and chats; this computer's daemon keeps the catalog.

/** A host project: the project `projectId` in the state of host `hostId`. */
export interface ProjectLocation {
  hostId: string
  projectId: string
}

export interface CatalogProject {
  /** `<hostId>:<projectId>` of the location it started from, or a random id. */
  id: string
  /** Never empty. The first is the main location: the project's name, and where its lead agent runs. */
  locations: ProjectLocation[]
}

/** The id a host project's own entry gets when it joins the catalog alone. */
export const locationKey = (location: ProjectLocation): string => `${location.hostId}:${location.projectId}`

export const PROJECT_CATALOG_METHODS = {
  projectCatalogList: '_harness/projectCatalog/list',
  /**
   * A host's full project list, as its state reports it: a project the catalog lacks joins as an
   * entry of its own, and a location of that host whose project is gone leaves its entry.
   */
  projectCatalogSync: '_harness/projectCatalog/sync',
  /** Moves a location into the entry `to` (it leaves the entry it was in). */
  projectCatalogPlace: '_harness/projectCatalog/place',
  /** Takes a location out of its entry into an entry of its own. */
  projectCatalogDetach: '_harness/projectCatalog/detach'
} as const

export const PROJECT_CATALOG_NOTIFICATIONS = {
  /** Every client of this computer's daemon hears the full catalog after any change. */
  projectCatalogChanged: '_harness/projectCatalog/changed'
} as const

export interface ProjectCatalogRequests {
  [PROJECT_CATALOG_METHODS.projectCatalogList]: { params: Record<string, never>; result: CatalogProject[] }
  [PROJECT_CATALOG_METHODS.projectCatalogSync]: { params: { hostId: string; projectIds: string[] }; result: CatalogProject[] }
  [PROJECT_CATALOG_METHODS.projectCatalogPlace]: { params: { to: string; location: ProjectLocation }; result: CatalogProject[] }
  [PROJECT_CATALOG_METHODS.projectCatalogDetach]: { params: { location: ProjectLocation }; result: CatalogProject[] }
}
