import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { locationKey, type CatalogProject, type ProjectLocation } from '@acp-harness/protocol'
import { HARNESS_HOME } from './harness-home.ts'

// The project catalog (protocol project-catalog.ts). The changes are pure functions over the list,
// so the store only orders them and writes the file.

const sameLocation = (a: ProjectLocation, b: ProjectLocation) => a.hostId === b.hostId && a.projectId === b.projectId

const withoutEmpty = (catalog: CatalogProject[]) => catalog.filter((p) => p.locations.length > 0)

/** An id for a new entry of `location`: its key, unless an entry already holds that id. */
function freshId(catalog: CatalogProject[], location: ProjectLocation): string {
  const key = locationKey(location)
  return catalog.some((p) => p.id === key) ? crypto.randomUUID() : key
}

/** Brings the catalog in line with every project `hostId` has now. */
export function syncHost(catalog: CatalogProject[], hostId: string, projectIds: string[]): CatalogProject[] {
  const present = new Set(projectIds)
  const kept = withoutEmpty(
    catalog.map((p) => ({ ...p, locations: p.locations.filter((l) => l.hostId !== hostId || present.has(l.projectId)) }))
  )
  const placed = new Set(kept.flatMap((p) => p.locations.filter((l) => l.hostId === hostId).map((l) => l.projectId)))
  const added: CatalogProject[] = []
  for (const projectId of projectIds) {
    if (placed.has(projectId)) continue
    placed.add(projectId)
    const location = { hostId, projectId }
    added.push({ id: freshId([...kept, ...added], location), locations: [location] })
  }
  return [...kept, ...added]
}

/** Moves `location` into entry `to`; unchanged when `to` is unknown. */
export function placeLocation(catalog: CatalogProject[], to: string, location: ProjectLocation): CatalogProject[] {
  if (!catalog.some((p) => p.id === to)) return catalog
  return withoutEmpty(
    catalog.map((p) => {
      const rest = p.locations.filter((l) => !sameLocation(l, location))
      return p.id === to ? { ...p, locations: [...rest, location] } : { ...p, locations: rest }
    })
  )
}

/** Gives `location` an entry of its own; unchanged when it already stands alone. */
export function detachLocation(catalog: CatalogProject[], location: ProjectLocation): CatalogProject[] {
  const from = catalog.find((p) => p.locations.some((l) => sameLocation(l, location)))
  if (from && from.locations.length === 1) return catalog
  const rest = withoutEmpty(catalog.map((p) => ({ ...p, locations: p.locations.filter((l) => !sameLocation(l, location)) })))
  return [...rest, { id: freshId(rest, location), locations: [location] }]
}

/** Names entry `id`; an empty name or null takes the name away. */
export function renameProject(catalog: CatalogProject[], id: string, name: string | null): CatalogProject[] {
  const trimmed = name?.trim()
  return catalog.map((p) => {
    if (p.id !== id) return p
    const { name: _old, ...rest } = p
    return trimmed ? { ...rest, name: trimmed } : rest
  })
}

/** The links that came before the catalog (project-links.json) become its first entries. */
export function fromLinks(raw: unknown): CatalogProject[] {
  if (!Array.isArray(raw)) return []
  const catalog: CatalogProject[] = []
  for (const link of raw as { id?: unknown; members?: unknown }[]) {
    if (typeof link?.id !== 'string' || !Array.isArray(link.members)) continue
    const locations = (link.members as ProjectLocation[]).filter(
      (m) => typeof m?.hostId === 'string' && typeof m?.projectId === 'string' && !catalog.some((p) => p.locations.some((l) => sameLocation(l, m)))
    )
    if (locations.length > 0) catalog.push({ id: link.id, locations: locations.map((m) => ({ hostId: m.hostId, projectId: m.projectId })) })
  }
  return catalog
}

export class ProjectCatalogStore {
  private catalog: Promise<CatalogProject[]> | null = null
  /** Changes run one at a time, so two hosts syncing at once both land. */
  private queue: Promise<unknown> = Promise.resolve()

  constructor(private readonly home: string = HARNESS_HOME) {}

  private get file() {
    return join(this.home, 'project-catalog.json')
  }

  list(): Promise<CatalogProject[]> {
    this.catalog ??= readFile(this.file, 'utf8')
      .then((text) => {
        const parsed: unknown = JSON.parse(text)
        return Array.isArray(parsed) ? (parsed as CatalogProject[]) : []
      })
      .catch(() =>
        readFile(join(this.home, 'project-links.json'), 'utf8')
          .then((text) => fromLinks(JSON.parse(text)))
          .catch(() => [])
      )
    return this.catalog
  }

  sync(hostId: string, projectIds: string[]) {
    return this.change((c) => syncHost(c, hostId, projectIds))
  }

  place(to: string, location: ProjectLocation) {
    return this.change((c) => placeLocation(c, to, location))
  }

  detach(location: ProjectLocation) {
    return this.change((c) => detachLocation(c, location))
  }

  rename(id: string, name: string | null) {
    return this.change((c) => renameProject(c, id, name))
  }

  /** Resolves with the catalog and whether it changed. */
  private change(apply: (catalog: CatalogProject[]) => CatalogProject[]): Promise<{ catalog: CatalogProject[]; changed: boolean }> {
    const run = this.queue.then(async () => {
      const before = await this.list()
      const after = apply(before)
      const changed = JSON.stringify(after) !== JSON.stringify(before)
      if (changed) await this.write(after)
      return { catalog: after, changed }
    })
    this.queue = run.catch(() => undefined)
    return run
  }

  private async write(list: CatalogProject[]): Promise<void> {
    this.catalog = Promise.resolve(list)
    await mkdir(dirname(this.file), { recursive: true })
    const temp = `${this.file}.tmp`
    await writeFile(temp, JSON.stringify(list, null, 2))
    await rename(temp, this.file)
  }
}
