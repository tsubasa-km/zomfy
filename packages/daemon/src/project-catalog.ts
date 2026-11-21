import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { locationKey, type CatalogProject, type ProjectLocation } from '@zomfy/protocol'
import { HARNESS_HOME } from './harness-home.ts'
import { log } from './log.ts'

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

/** Moves `location` into entry `to`; throws when `to` is unknown, so a caller does not report it done. */
export function placeLocation(catalog: CatalogProject[], to: string, location: ProjectLocation): CatalogProject[] {
  if (!catalog.some((p) => p.id === to)) throw new Error(`No project ${to} in the catalog`)
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

/** Names entry `id`; an empty name or null takes the name away. Throws when `id` is unknown. */
export function renameProject(catalog: CatalogProject[], id: string, name: string | null): CatalogProject[] {
  if (!catalog.some((p) => p.id === id)) throw new Error(`No project ${id} in the catalog`)
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

const isLocation = (v: unknown): v is ProjectLocation =>
  typeof (v as ProjectLocation)?.hostId === 'string' && typeof (v as ProjectLocation)?.projectId === 'string'

/**
 * What a catalog file holds, cleaned: entries with an id and at least one well-formed location, a
 * host project in the first entry naming it only, and a name only when it is a string.
 */
export function cleanCatalog(raw: unknown): CatalogProject[] {
  if (!Array.isArray(raw)) throw new Error('The project catalog is not a list')
  const catalog: CatalogProject[] = []
  const ids = new Set<string>()
  for (const entry of raw as Partial<CatalogProject>[]) {
    if (typeof entry?.id !== 'string' || ids.has(entry.id) || !Array.isArray(entry.locations)) continue
    const locations = entry.locations
      .filter(isLocation)
      .filter((l) => !catalog.some((p) => p.locations.some((m) => sameLocation(m, l))))
      .map((l) => ({ hostId: l.hostId, projectId: l.projectId }))
    if (locations.length === 0) continue
    ids.add(entry.id)
    catalog.push(typeof entry.name === 'string' && entry.name.trim() ? { id: entry.id, locations, name: entry.name } : { id: entry.id, locations })
  }
  return catalog
}

const missing = (error: unknown) => (error as NodeJS.ErrnoException)?.code === 'ENOENT'

export class ProjectCatalogStore {
  private catalog: Promise<CatalogProject[]> | null = null
  /** Changes run one at a time, so two hosts syncing at once both land. */
  private queue: Promise<unknown> = Promise.resolve()

  constructor(private readonly home: string = HARNESS_HOME) {}

  private get file() {
    return join(this.home, 'project-catalog.json')
  }

  list(): Promise<CatalogProject[]> {
    // A read that failed (a locked file) is tried again next time rather than kept.
    this.catalog ??= this.load().catch((error) => {
      this.catalog = null
      throw error
    })
    return this.catalog
  }

  /**
   * The catalog file; with none yet, the links that came before it, written out at once so they are
   * read only this one time. A file that cannot be read as a catalog is kept aside, not overwritten.
   */
  private async load(): Promise<CatalogProject[]> {
    let text: string
    try {
      text = await readFile(this.file, 'utf8')
    } catch (error) {
      if (!missing(error)) throw error
      const links = await readFile(join(this.home, 'project-links.json'), 'utf8').then(
        (t) => fromLinks(JSON.parse(t)),
        () => []
      )
      await this.write(links)
      return links
    }
    try {
      return cleanCatalog(JSON.parse(text))
    } catch (error) {
      const aside = `${this.file}.unreadable-${Date.now()}`
      log(`project catalog: ${this.file} could not be read (${String(error)}); kept as ${aside}`)
      await rename(this.file, aside).catch(() => undefined)
      await this.write([])
      return []
    }
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
      if (changed) {
        await this.write(after)
        this.catalog = Promise.resolve(after)
      }
      return { catalog: after, changed }
    })
    this.queue = run.catch(() => undefined)
    return run
  }

  private async write(list: CatalogProject[]): Promise<void> {
    await mkdir(dirname(this.file), { recursive: true })
    const temp = `${this.file}.tmp`
    await writeFile(temp, JSON.stringify(list, null, 2))
    await rename(temp, this.file)
  }
}
