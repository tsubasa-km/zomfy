import { existsSync } from 'node:fs'
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, parse, resolve } from 'node:path'
import {
  DEFAULT_WORKTREE_CLEANUP_POLICY,
  type CleanupCandidate,
  type CleanupList,
  type CleanupRun,
  type LeftoverFolder,
  type Project,
  type TerminalInfo,
  type Workspace,
  type WorktreeCleanupPolicy
} from '@zomfy/protocol'
import { git } from './git-cli.ts'
import { log } from './log.ts'
import { removeTree } from './safe-remove.ts'
import { inspectWorkspace, workspaceSummary } from './workspace-git-summary.ts'
import type { WorkspaceManager } from './workspace-manager.ts'
import { measureTree, type WorkspaceSizes } from './workspace-sizes.ts'
import { sanitizeWorkspaceName } from './worktree-naming.ts'

// Cleaning up worktrees (spec worktree-skills-and-storage B4–B6): the dialog's list, Free space,
// leftover folders, and the policy the daemon runs by itself. Nothing with uncommitted, untracked or
// unpushed work is deleted, and nothing a turn, a terminal or a running split is using.

const DAY_MS = 24 * 60 * 60 * 1000

export interface CleanupSession {
  id: string
  workspaceId: string | null
  status: string
  createdAt: number
  lastActivityAt?: number
}

export interface CleanupDeps {
  workspaces: WorkspaceManager
  sizes: WorkspaceSizes
  sessions: () => CleanupSession[]
  terminals: () => TerminalInfo[]
  closeTerminals: (workspaceId: string) => void
  /** Moves a chat out of a worktree about to go, and tells it why. */
  moveChat: (sessionId: string, workspaceId: string, notice: string) => Promise<void>
  /** Why a chat's folder must stay (its split parts merge there); null when it may go. */
  splitBusy: (sessionId: string) => string | null
  runArchiveHook: (project: Project, path: string) => Promise<void>
  hostPolicy: () => Promise<WorktreeCleanupPolicy | undefined>
  /** The project's worktree root, under which leftover folders are looked for. */
  worktreeRoot: (project: Project) => string
  /** Where the policy keeps when it first saw each worktree merged, and its last run. */
  statePath: string
  now?: () => number
}

interface PolicyState {
  mergedSince: Record<string, number>
  lastRun: CleanupRun | null
}

export class WorktreeCleanup {
  private state: PolicyState | null = null
  private timer: ReturnType<typeof setTimeout> | null = null
  private running: Promise<CleanupRun> | null = null

  constructor(private readonly deps: CleanupDeps) {}

  private now(): number {
    return this.deps.now?.() ?? Date.now()
  }

  /** The policy runs 2 minutes after start and hourly; the timers never keep the process alive. */
  start(firstDelayMs = 2 * 60 * 1000, everyMs = 60 * 60 * 1000): void {
    const tick = (delay: number) => {
      this.timer = setTimeout(() => {
        void this.runPolicy()
          .catch((error) => log(`worktree cleanup failed: ${String(error)}`))
          .finally(() => tick(everyMs))
      }, delay)
      this.timer.unref?.()
    }
    tick(firstDelayMs)
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
  }

  async lastRun(): Promise<CleanupRun | null> {
    return (await this.load()).lastRun
  }

  // ── The dialog ──

  async list(projectId: string): Promise<CleanupList> {
    const project = (await this.deps.workspaces.snapshot()).projects.find((p) => p.id === projectId)
    if (!project) throw new Error(`Unknown project ${projectId}`)
    if (project.kind !== 'git') return { mergeTarget: null, candidates: [], leftovers: [] }
    const [base, target] = await Promise.all([this.deps.workspaces.baseRefOf(project), this.deps.workspaces.mergeTargetOf(project)])
    const own = this.worktreesOf(project.id)
    const sizes = new Map((await this.deps.sizes.get(own)).map((s) => [s.workspaceId, s]))
    const candidates: CleanupCandidate[] = []
    for (const workspace of own) {
      const [summary, inspection] = await Promise.all([
        workspaceSummary(workspace, base, target).catch(() => null),
        inspectWorkspace(workspace, target).catch(() => null)
      ])
      candidates.push({
        workspaceId: workspace.id,
        merged: summary?.merged ?? false,
        modifiedFiles: inspection?.modifiedFiles ?? 0,
        untrackedFiles: inspection?.untrackedFiles ?? 0,
        unpushedCommits: inspection?.unpushedCommits ?? null,
        lastActivityAt: this.lastActivity(workspace),
        busy: this.busy(workspace),
        size: sizes.get(workspace.id) ?? null
      })
    }
    candidates.sort((a, b) => (b.size?.total.ownBytes ?? 0) - (a.size?.total.ownBytes ?? 0))
    return {
      mergeTarget: target,
      candidates,
      leftovers: await this.leftovers(project),
      cacheElsewhere: await cacheOnOtherVolume(project, this.deps.worktreeRoot(project))
    }
  }

  /** Deletes a worktree's dependencies and build output (git-ignored ones only), keeping the rest. */
  async freeSpace(workspaceId: string): Promise<{ freedBytes: number }> {
    const { workspace, project } = this.deps.workspaces.requireWorkspace(workspaceId)
    if (workspace.isPrimary || project.kind !== 'git') throw new Error('Only a worktree can have its space freed')
    const busy = this.busy(workspace)
    if (busy) throw new Error(busy === 'turn' ? 'A chat is working in this worktree.' : 'A terminal is running in this worktree.')
    const before = await this.deps.sizes.refresh(workspace)
    const roots = await this.deps.sizes.freeableRoots(workspace)
    for (const path of [...roots.dependencyRoots, ...roots.buildRoots]) {
      if (!(await ignoredByGit(workspace.path, path))) continue
      await removeTree(path, { release: () => this.deps.closeTerminals(workspace.id) })
    }
    await this.deps.workspaces.setSpaceFreed(workspace.id, this.now())
    const after = await this.deps.sizes.refresh(workspace)
    return { freedBytes: Math.max(0, before.total.ownBytes - after.total.ownBytes) }
  }

  async removeLeftover(projectId: string, path: string): Promise<void> {
    const project = (await this.deps.workspaces.snapshot()).projects.find((p) => p.id === projectId)
    if (!project) throw new Error(`Unknown project ${projectId}`)
    // Only a folder the list offered: never anything a caller names.
    const offered = (await this.leftovers(project, false)).some((l) => samePath(l.path, path))
    if (!offered) throw new Error(`${path} is not a leftover folder of ${project.name}`)
    await removeTree(path)
  }

  // ── The policy ──

  async runPolicy(): Promise<CleanupRun> {
    this.running ??= this.policyPass().finally(() => (this.running = null))
    return this.running
  }

  private async policyPass(): Promise<CleanupRun> {
    const state = await this.load()
    const host = { ...DEFAULT_WORKTREE_CLEANUP_POLICY, ...(await this.deps.hostPolicy()) }
    const run: CleanupRun = { at: this.now(), deleted: 0, freed: 0, freedBytes: 0, errors: [] }
    const snapshot = await this.deps.workspaces.snapshot()
    const known = new Set<string>()
    for (const project of snapshot.projects.filter((p) => p.kind === 'git' && existsSync(p.path))) {
      const policy = { ...host, ...project.cleanup }
      const primary = snapshot.workspaces.find((w) => w.projectId === project.id && w.isPrimary)
      const [base, target] = await Promise.all([this.deps.workspaces.baseRefOf(project), this.deps.workspaces.mergeTargetOf(project)])
      for (const workspace of this.worktreesOf(project.id)) {
        known.add(workspace.id)
        if (!existsSync(workspace.path)) continue
        const summary = await workspaceSummary(workspace, base, target).catch(() => null)
        if (summary?.merged) state.mergedSince[workspace.id] ??= this.now()
        else delete state.mergedSince[workspace.id]
        if (policy.keepPinned && workspace.pinned) continue
        if (this.busy(workspace) || this.splitRunning(workspace)) continue
        const idleFor = this.now() - this.lastActivity(workspace)
        const mergedFor = summary?.merged ? this.now() - state.mergedSince[workspace.id]! : -1
        try {
          if (policy.deleteMerged && primary && mergedFor >= policy.deleteMergedAfterDays * DAY_MS && idleFor >= policy.deleteMergedAfterDays * DAY_MS) {
            if (await this.deleteMerged(project, workspace, primary, target)) {
              run.deleted++
              delete state.mergedSince[workspace.id]
              known.delete(workspace.id)
            }
            continue
          }
          if (policy.freeIdle && !workspace.spaceFreedAt && idleFor >= policy.freeIdleAfterDays * DAY_MS) {
            const { freedBytes } = await this.freeSpace(workspace.id)
            run.freed++
            run.freedBytes += freedBytes
          }
        } catch (error) {
          run.errors.push(`${workspace.path}: ${error instanceof Error ? error.message : String(error)}`)
        }
      }
    }
    for (const id of Object.keys(state.mergedSince)) if (!known.has(id)) delete state.mergedSince[id]
    state.lastRun = run
    await this.save()
    if (run.deleted || run.freed || run.errors.length) log(`worktree cleanup: deleted ${run.deleted}, freed ${run.freed} (${run.freedBytes} bytes), ${run.errors.length} errors`)
    return run
  }

  /** Checks again right before deleting: anything uncommitted, untracked or unpushed keeps it. */
  private async deleteMerged(project: Project, workspace: Workspace, primary: Workspace, target: string): Promise<boolean> {
    const inspection = await inspectWorkspace(workspace, target)
    if (inspection.modifiedFiles || inspection.untrackedFiles || inspection.unpushedCommits !== 0) return false
    const before = (await this.deps.sizes.get([workspace])).at(0)?.total.ownBytes ?? 0
    const label = workspace.branch ?? workspace.name
    for (const session of this.deps.sessions().filter((s) => s.workspaceId === workspace.id)) {
      await this.deps.moveChat(session.id, primary.id, `Zomfy removed the merged worktree ${label}; this chat moved to the main checkout`)
    }
    // A chat that could not move keeps the worktree.
    if (this.deps.sessions().some((s) => s.workspaceId === workspace.id)) return false
    this.deps.closeTerminals(workspace.id)
    await this.deps.runArchiveHook(project, workspace.path)
    await this.deps.workspaces.removeWorkspace({ workspaceId: workspace.id, deleteBranch: true })
    this.deps.sizes.forget(workspace.id)
    log(`worktree cleanup deleted merged ${workspace.path} (${before} bytes of its own)`)
    return true
  }

  // ── Facts about a worktree ──

  private worktreesOf(projectId: string): Workspace[] {
    return this.deps.workspaces
      .projectWorkspaces()
      .filter(({ workspace, project }) => project.id === projectId && !workspace.isPrimary && !workspace.scratch)
      .map(({ workspace }) => workspace)
  }

  /** The latest turn, terminal or creation in it. */
  lastActivity(workspace: Workspace): number {
    let latest = workspace.createdAt
    for (const s of this.deps.sessions()) if (s.workspaceId === workspace.id) latest = Math.max(latest, s.lastActivityAt ?? s.createdAt)
    for (const t of this.deps.terminals()) if (t.workspaceId === workspace.id) latest = Math.max(latest, t.startedAt ?? t.createdAt, t.exitCode === null ? this.now() : 0)
    return latest
  }

  busy(workspace: Workspace): 'turn' | 'terminal' | null {
    if (this.deps.sessions().some((s) => s.workspaceId === workspace.id && (s.status === 'working' || s.status === 'needs-you'))) return 'turn'
    if (this.deps.terminals().some((t) => t.workspaceId === workspace.id && t.exitCode === null)) return 'terminal'
    return null
  }

  private splitRunning(workspace: Workspace): boolean {
    return this.deps.sessions().some((s) => s.workspaceId === workspace.id && this.deps.splitBusy(s.id) !== null)
  }

  /** Folders under the project's worktree root that are no workspace and no git worktree. */
  private async leftovers(project: Project, measure = true): Promise<LeftoverFolder[]> {
    const root = this.deps.worktreeRoot(project)
    const names = await readdir(root).catch(() => [] as string[])
    const snapshot = await this.deps.workspaces.snapshot()
    const listed = await git(project.path, ['worktree', 'list', '--porcelain'], { quiet: true }).catch(() => '')
    const worktrees = [...listed.matchAll(/^worktree (.+)$/gm)].map((m) => resolve(m[1]!))
    const out: LeftoverFolder[] = []
    for (const name of names) {
      const path = join(root, name)
      if (!(await stat(path).then((s) => s.isDirectory(), () => false))) continue
      if (snapshot.workspaces.some((w) => samePath(w.path, path)) || worktrees.some((w) => samePath(w, path))) continue
      // A folder with a .git of its own is a checkout somebody may still use: never offered.
      if (existsSync(join(path, '.git'))) continue
      out.push({ path, size: measure ? (await measureTree(path).catch(() => null))?.total ?? null : null })
    }
    return out
  }

  private async load(): Promise<PolicyState> {
    if (this.state) return this.state
    const loaded = await readFile(this.deps.statePath, 'utf8')
      .then((text) => JSON.parse(text) as Partial<PolicyState>)
      .catch(() => ({}) as Partial<PolicyState>)
    this.state = { mergedSince: loaded.mergedSince ?? {}, lastRun: loaded.lastRun ?? null }
    return this.state
  }

  private async save(): Promise<void> {
    if (!this.state) return
    await mkdir(dirname(this.deps.statePath), { recursive: true })
    await writeFile(this.deps.statePath, JSON.stringify(this.state, null, 2))
  }
}

/** The project's folder of worktrees, as createWorkspace makes it. */
export function projectWorktreeRoot(project: Project, defaultRoot: string): string {
  return join(project.worktreeRoot || defaultRoot, sanitizeWorkspaceName(project.name))
}

/** bun's cache, when the project uses bun and the cache sits on another volume than its worktrees. */
export async function cacheOnOtherVolume(project: Project, worktrees: string, env = process.env, home = homedir()): Promise<{ cache: string; worktrees: string } | null> {
  if (!existsSync(join(project.path, 'bun.lock')) && !existsSync(join(project.path, 'bun.lockb'))) return null
  const cache = env.BUN_INSTALL_CACHE_DIR || join(env.BUN_INSTALL || join(home, '.bun'), 'install', 'cache')
  const volume = (p: string) => parse(resolve(p)).root.toLowerCase()
  return volume(cache) === volume(worktrees) ? null : { cache, worktrees }
}

async function ignoredByGit(cwd: string, path: string): Promise<boolean> {
  return git(cwd, ['check-ignore', '-q', '--', path], { quiet: true }).then(
    () => true,
    () => false
  )
}

function samePath(a: string, b: string): boolean {
  const norm = (p: string) => resolve(p).replace(/[\\/]+$/, '')
  return process.platform === 'win32' ? norm(a).toLowerCase() === norm(b).toLowerCase() : norm(a) === norm(b)
}

/**
 * The note a freed worktree's next turn starts with: its setup script runs first when it has one;
 * otherwise the agent is told to put the dependencies back. Null when nothing was freed.
 */
export async function restoreFreedWorkspace(
  workspaces: WorkspaceManager,
  workspaceId: string | null,
  runSetup: (project: Project, path: string) => Promise<string | null>,
  hasSetup: (project: Project, path: string) => Promise<boolean>,
  notice: (title: string) => Promise<void>
): Promise<string | null> {
  if (!workspaceId) return null
  const found = workspaces.projectWorkspaces().find((x) => x.workspace.id === workspaceId)
  if (!found?.workspace.spaceFreedAt) return null
  const { workspace, project } = found
  await workspaces.setSpaceFreed(workspace.id, null)
  if (await hasSetup(project, workspace.path)) {
    await notice("Running the project's setup script to put back this worktree's dependencies")
    const failed = await runSetup(project, workspace.path)
    if (!failed) return null
    return `Zomfy removed this worktree's node_modules and build output to save space and ran the project's setup script to put them back, which failed: ${failed}. Run it (or the install command) before building.`
  }
  return "Zomfy removed this worktree's node_modules and build output to save space; run the setup script or `bun install` before building."
}
