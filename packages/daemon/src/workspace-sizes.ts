import type { Dirent } from 'node:fs'
import { lstat, mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import type { SizeSplit, Workspace, WorkspaceSize } from '@zomfy/protocol'
import { log } from './log.ts'

// A worktree's size on disk (spec worktree-skills-and-storage B2), measured one folder at a time in
// the background. bun hardlinks packages from its cache, so a file with more than one link is
// counted in `bytes` but not in `ownBytes`: deleting it frees nothing.

/** Folder names counted as build output; `node_modules` is dependencies. */
export const BUILD_FOLDERS = new Set(['target', 'dist', '.turbo', '.expo', '.next', '.svelte-kit', '.parcel-cache'])
export const DEPENDENCY_FOLDER = 'node_modules'
export const SIZE_MAX_AGE_MS = 24 * 60 * 60 * 1000

export interface MeasuredTree {
  total: SizeSplit
  dependencies: SizeSplit
  build: SizeSplit
  /** The outermost `node_modules` folders, which Free space deletes. */
  dependencyRoots: string[]
  /** The outermost build folders outside `node_modules`. */
  buildRoots: string[]
}

const zero = (): SizeSplit => ({ bytes: 0, ownBytes: 0 })

/** Walks `root` without following links; files that vanish or cannot be read are skipped. */
export async function measureTree(root: string): Promise<MeasuredTree> {
  const out: MeasuredTree = { total: zero(), dependencies: zero(), build: zero(), dependencyRoots: [], buildRoots: [] }
  let seen = 0
  async function visit(dir: string, kind: 'rest' | 'dependencies' | 'build'): Promise<void> {
    let entries: Dirent[]
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const path = join(dir, entry.name)
      // Give the daemon's other work a turn now and then; a worktree has tens of thousands of files.
      if (++seen % 400 === 0) await new Promise((r) => setTimeout(r, 0))
      if (entry.isDirectory()) {
        let next = kind
        if (kind === 'rest' && entry.name === DEPENDENCY_FOLDER) {
          next = 'dependencies'
          out.dependencyRoots.push(path)
        } else if (kind === 'rest' && BUILD_FOLDERS.has(entry.name)) {
          next = 'build'
          out.buildRoots.push(path)
        }
        await visit(path, next)
        continue
      }
      if (!entry.isFile()) continue
      const info = await lstat(path).catch(() => null)
      if (!info) continue
      const own = info.nlink > 1 ? 0 : info.size
      out.total.bytes += info.size
      out.total.ownBytes += own
      if (kind !== 'rest') {
        out[kind].bytes += info.size
        out[kind].ownBytes += own
      }
    }
  }
  await visit(resolve(root), 'rest')
  return out
}

interface Persisted {
  sizes: Record<string, WorkspaceSize & { path: string }>
}

/** Measured sizes, kept across restarts; one measurement runs at a time. */
export class WorkspaceSizes {
  private sizes = new Map<string, WorkspaceSize & { path: string }>()
  private roots = new Map<string, Pick<MeasuredTree, 'dependencyRoots' | 'buildRoots'>>()
  private queue: { workspace: Workspace; done: Array<() => void> }[] = []
  private running: Promise<void> | null = null
  private loaded: Promise<void> | null = null

  constructor(
    private readonly file: string,
    private readonly now = () => Date.now()
  ) {}

  private load(): Promise<void> {
    this.loaded ??= readFile(this.file, 'utf8')
      .then((text) => {
        const data = JSON.parse(text) as Persisted
        for (const [id, size] of Object.entries(data.sizes ?? {})) this.sizes.set(id, size)
      })
      .catch(() => undefined)
    return this.loaded
  }

  /** Sizes known for these workspaces; missing or stale ones are measured, and `wait` waits for them. */
  async get(workspaces: Workspace[], options: { wait?: boolean } = {}): Promise<WorkspaceSize[]> {
    await this.load()
    const waits: Promise<void>[] = []
    for (const workspace of workspaces) {
      const known = this.sizes.get(workspace.id)
      const fresh = known && known.path === workspace.path && this.now() - known.measuredAt < SIZE_MAX_AGE_MS
      if (!fresh) waits.push(this.enqueue(workspace))
    }
    if (options.wait) await Promise.all(waits)
    return workspaces.flatMap((w) => {
      const size = this.sizes.get(w.id)
      if (!size) return []
      const { path: _path, ...rest } = size
      return [rest]
    })
  }

  /** Measures now, ahead of the queue (after a Free space, say). */
  async refresh(workspace: Workspace): Promise<WorkspaceSize> {
    await this.load()
    return this.measure(workspace)
  }

  /** The folders Free space would delete, from a fresh walk. */
  async freeableRoots(workspace: Workspace): Promise<Pick<MeasuredTree, 'dependencyRoots' | 'buildRoots'>> {
    await this.measure(workspace)
    return this.roots.get(workspace.id) ?? { dependencyRoots: [], buildRoots: [] }
  }

  forget(workspaceId: string): void {
    this.sizes.delete(workspaceId)
    this.roots.delete(workspaceId)
    void this.save()
  }

  private enqueue(workspace: Workspace): Promise<void> {
    const queued = this.queue.find((q) => q.workspace.id === workspace.id)
    const promise = new Promise<void>((done) => {
      if (queued) queued.done.push(done)
      else this.queue.push({ workspace, done: [done] })
    })
    this.running ??= this.drain().finally(() => (this.running = null))
    return promise
  }

  private async drain(): Promise<void> {
    for (let next = this.queue.shift(); next; next = this.queue.shift()) {
      await this.measure(next.workspace).catch((error) => log(`measuring ${next!.workspace.path} failed: ${String(error)}`))
      for (const done of next.done) done()
    }
  }

  private async measure(workspace: Workspace): Promise<WorkspaceSize> {
    const tree = await measureTree(workspace.path)
    const size = { workspaceId: workspace.id, path: workspace.path, total: tree.total, dependencies: tree.dependencies, build: tree.build, measuredAt: this.now() }
    this.sizes.set(workspace.id, size)
    this.roots.set(workspace.id, { dependencyRoots: tree.dependencyRoots, buildRoots: tree.buildRoots })
    await this.save()
    const { path: _path, ...rest } = size
    return rest
  }

  private async save(): Promise<void> {
    try {
      await mkdir(dirname(this.file), { recursive: true })
      await writeFile(this.file, JSON.stringify({ sizes: Object.fromEntries(this.sizes) } satisfies Persisted))
    } catch (error) {
      log(`saving worktree sizes failed: ${String(error)}`)
    }
  }
}
