import { existsSync } from 'node:fs'
import { mkdir, readFile, realpath, writeFile, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import type {
  BranchList,
  CreateWorkspaceParams,
  HarnessState,
  HostInfo,
  Project,
  ProjectGroup,
  ProjectPatch,
  RemoveWorkspaceParams,
  Workspace,
  WorkspacePatch
} from '@acp-harness/protocol'
import { branchExists, currentBranch, git, isGitRepository, localBranches } from './git-cli.ts'
import { branchPrefixFromUserName, firstFreeCandidate, sanitizeWorkspaceName } from './worktree-naming.ts'
import { log } from './log.ts'
import { HARNESS_HOME, WORKSPACE_ROOT } from './harness-home.ts'

const STATE_PATH = join(HARNESS_HOME, 'state.json')
const FLOATING_FALLBACK = join(HARNESS_HOME, 'floating-workspace')
export const FLOATING_WORKSPACE_ID = 'floating'

interface PersistedState {
  projects: Project[]
  workspaces: Workspace[]
  projectGroups: ProjectGroup[]
  floatingCwd: string
}

export class WorkspaceManager {
  private state: PersistedState = { projects: [], workspaces: [], projectGroups: [], floatingCwd: '' }
  private readonly listeners = new Set<(state: HarnessState) => void>()

  async load(): Promise<void> {
    try {
      this.state = { ...this.state, ...JSON.parse(await readFile(STATE_PATH, 'utf8')) }
    } catch {
      // First run: nothing saved yet.
    }
  }

  onChange(listener: (state: HarnessState) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  async snapshot(): Promise<HarnessState> {
    return {
      host: hostInfo(),
      projects: this.state.projects,
      workspaces: [await this.floatingWorkspace(), ...this.state.workspaces],
      floatingWorkspaceId: FLOATING_WORKSPACE_ID,
      projectGroups: this.state.projectGroups
    }
  }

  /** Workspaces with a project, for the git summaries. */
  projectWorkspaces(): { workspace: Workspace; project: Project }[] {
    return this.state.workspaces.flatMap((workspace) => {
      const project = this.state.projects.find((p) => p.id === workspace.projectId)
      return project ? [{ workspace, project }] : []
    })
  }

  requireWorkspace(workspaceId: string): { workspace: Workspace; project: Project } {
    const workspace = this.state.workspaces.find((w) => w.id === workspaceId)
    if (!workspace) throw new Error(`Unknown workspace ${workspaceId}`)
    return { workspace, project: this.requireProject(workspace.projectId!) }
  }

  /** The project's configured base, else Orca's default chain. */
  async baseRefOf(project: Project): Promise<string> {
    return project.defaultBaseRef || (await defaultBaseRef(project.path))
  }

  workspacePath(workspaceId: string): string | null {
    if (workspaceId === FLOATING_WORKSPACE_ID) return this.state.floatingCwd || homedir()
    return this.state.workspaces.find((w) => w.id === workspaceId)?.path ?? null
  }

  async addProject(path: string): Promise<Project> {
    // realpath expands Windows 8.3 short names (SUZUKI~1), which would otherwise add the folder twice.
    const absolute = await realpath(resolve(path)).catch(() => resolve(path))
    if (!(await stat(absolute)).isDirectory()) throw new Error(`${absolute} is not a folder`)
    const existing = this.state.projects.find((p) => samePath(p.path, absolute))
    if (existing) return existing

    const isGit = await isGitRepository(absolute)
    const root = isGit ? resolve(absolute, await git(absolute, ['rev-parse', '--show-toplevel'])) : absolute
    const existingRoot = this.state.projects.find((p) => samePath(p.path, root))
    if (existingRoot) return existingRoot
    const project: Project = {
      id: crypto.randomUUID(),
      name: basename(root).replace(/\.git$/, ''),
      path: root,
      kind: isGit ? 'git' : 'folder',
      sortOrder: Math.max(-1, ...this.state.projects.map((p) => p.sortOrder ?? 0)) + 1
    }
    this.state.projects.push(project)
    // The project's own checkout is always a workspace, like Orca's main worktree.
    this.state.workspaces.push({
      id: crypto.randomUUID(),
      projectId: project.id,
      name: project.name,
      path: root,
      branch: isGit ? await currentBranch(root) : null,
      isPrimary: true,
      createdAt: Date.now()
    })
    // Worktrees made elsewhere (Orca, the git CLI) are workspaces too, as Orca lists them.
    if (isGit) {
      for (const worktree of await listWorktrees(root)) {
        if (samePath(worktree.path, root)) continue
        this.state.workspaces.push({
          id: crypto.randomUUID(),
          projectId: project.id,
          name: basename(worktree.path),
          path: worktree.path,
          branch: worktree.branch,
          isPrimary: false,
          createdAt: Date.now()
        })
      }
    }
    await this.save()
    return project
  }

  async removeProject(projectId: string): Promise<void> {
    // Worktrees on disk are kept; only the harness forgets the project.
    this.state.projects = this.state.projects.filter((p) => p.id !== projectId)
    this.state.workspaces = this.state.workspaces.filter((w) => w.projectId !== projectId)
    await this.save()
  }

  async listBranches(projectId: string): Promise<BranchList> {
    const project = this.requireProject(projectId)
    if (project.kind !== 'git') return { current: null, branches: [] }
    const remotes = await git(project.path, ['for-each-ref', '--format=%(refname:short)', 'refs/remotes'], {
      quiet: true
    }).catch(() => '')
    return {
      current: await currentBranch(project.path),
      branches: await localBranches(project.path),
      remoteBranches: remotes.split('\n').filter((r) => r && !r.endsWith('/HEAD')),
      defaultBaseRef: await this.baseRefOf(project),
      checkedOut: (await listWorktrees(project.path)).flatMap((w) => (w.branch ? [w.branch] : []))
    }
  }

  async updateProject(projectId: string, patch: ProjectPatch): Promise<Project> {
    const project = this.requireProject(projectId)
    for (const key of ['displayName', 'defaultBaseRef', 'worktreeRoot', 'groupId'] as const) {
      if (!(key in patch)) continue
      const value = patch[key]?.trim()
      if (value) project[key] = value
      else delete project[key]
    }
    if ('hooks' in patch) {
      const setup = patch.hooks?.setup?.trim()
      const archive = patch.hooks?.archive?.trim()
      if (setup || archive) project.hooks = { ...(setup ? { setup } : {}), ...(archive ? { archive } : {}) }
      else delete project.hooks
    }
    await this.save()
    return project
  }

  async reorderProjects(projectIds: string[]): Promise<void> {
    projectIds.forEach((id, index) => {
      const project = this.state.projects.find((p) => p.id === id)
      if (project) project.sortOrder = index
    })
    await this.save()
  }

  async reorderWorkspaces(workspaceIds: string[]): Promise<void> {
    workspaceIds.forEach((id, index) => {
      const workspace = this.state.workspaces.find((w) => w.id === id)
      if (workspace) workspace.sortOrder = index
    })
    await this.save()
  }

  async createProjectGroup(name: string, projectIds: string[] = []): Promise<ProjectGroup> {
    const group: ProjectGroup = {
      id: crypto.randomUUID(),
      name: name.trim() || 'Group',
      sortOrder: this.state.projectGroups.length
    }
    this.state.projectGroups.push(group)
    for (const project of this.state.projects) if (projectIds.includes(project.id)) project.groupId = group.id
    await this.save()
    return group
  }

  async updateProjectGroup(
    groupId: string,
    patch: Partial<Pick<ProjectGroup, 'name' | 'collapsed'>>
  ): Promise<ProjectGroup> {
    const group = this.state.projectGroups.find((g) => g.id === groupId)
    if (!group) throw new Error(`Unknown project group ${groupId}`)
    if (patch.name?.trim()) group.name = patch.name.trim()
    if (patch.collapsed !== undefined) group.collapsed = patch.collapsed
    await this.save()
    return group
  }

  /** Its projects move back to the top level, as Orca's group delete does. */
  async removeProjectGroup(groupId: string): Promise<void> {
    this.state.projectGroups = this.state.projectGroups.filter((g) => g.id !== groupId)
    for (const project of this.state.projects) if (project.groupId === groupId) delete project.groupId
    await this.save()
  }

  async createWorkspace(params: CreateWorkspaceParams): Promise<Workspace> {
    const project = this.requireProject(params.projectId)
    const parent = params.parentWorkspaceId
      ? this.state.workspaces.find((w) => w.id === params.parentWorkspaceId)
      : undefined
    const extra = {
      ...(parent ? { parentWorkspaceId: parent.id } : {}),
      ...(params.comment?.trim() ? { comment: params.comment.trim() } : {})
    }

    if (project.kind === 'folder') {
      // Orca's folder workspaces share the folder; nothing is created on disk.
      const name = params.name.trim() || sanitizeWorkspaceName(params.name)
      return this.addWorkspace({ projectId: project.id, name, path: project.path, branch: null, ...extra })
    }

    const projectRoot = join(project.worktreeRoot || WORKSPACE_ROOT, sanitizeWorkspaceName(project.name))
    await mkdir(projectRoot, { recursive: true })
    const add = (args: string[]) => git(project.path, ['-c', 'core.longpaths=true', 'worktree', 'add', ...args])

    if (params.existingBranch) {
      // Orca's "start from an existing branch": check it out instead of branching.
      const branch = params.existingBranch
      const slug = sanitizeWorkspaceName(params.name.trim() || branch.split('/').at(-1) || branch)
      const name = await firstFreeCandidate(slug, async (c) => !existsSync(join(projectRoot, c)))
      const path = join(projectRoot, name)
      await add([path, branch])
      log(`created worktree ${path} on existing ${branch}`)
      return this.addWorkspace({ projectId: project.id, name, path, branch, ...extra })
    }

    const override = params.branchName?.trim()
    if (override && (await branchExists(project.path, override))) {
      throw new Error(`Branch ${override} already exists; start from it as an existing branch instead`)
    }
    const slug = sanitizeWorkspaceName(params.name.trim() || override?.split('/').at(-1) || '')
    const prefix = branchPrefixFromUserName(await gitUserName(project.path))
    const name = await firstFreeCandidate(slug, async (candidate) => {
      if (existsSync(join(projectRoot, candidate))) return false
      if (override) return true
      return !(await branchExists(project.path, prefix ? `${prefix}/${candidate}` : candidate))
    })
    const branch = override || (prefix ? `${prefix}/${name}` : name)
    const path = join(projectRoot, name)
    // A child starts from its parent's branch unless the composer picked a base.
    const base = params.baseRef || parent?.branch || (await this.baseRefOf(project))

    await add(['--no-track', '-b', branch, path, base])
    log(`created worktree ${path} on ${branch} from ${base}`)
    return this.addWorkspace({ projectId: project.id, name, path, branch, ...extra })
  }

  async removeWorkspace(params: RemoveWorkspaceParams): Promise<void> {
    const workspace = this.state.workspaces.find((w) => w.id === params.workspaceId)
    if (!workspace) throw new Error(`Unknown workspace ${params.workspaceId}`)
    if (workspace.isPrimary) throw new Error("A project's own checkout cannot be removed as a workspace")
    const project = this.requireProject(workspace.projectId!)

    const sharedFolder = project.kind === 'folder'
    if (!sharedFolder) {
      await git(project.path, ['worktree', 'remove', ...(params.force ? ['--force'] : []), workspace.path])
      await git(project.path, ['worktree', 'prune']).catch(() => undefined)
      if (params.deleteBranch && workspace.branch) {
        // -d keeps unmerged work unless the user forced it, as Orca does.
        await git(project.path, ['branch', params.force ? '-D' : '-d', '--', workspace.branch]).catch((error) =>
          log(`kept branch ${workspace.branch}: ${String(error)}`)
        )
      }
    }
    this.state.workspaces = this.state.workspaces.filter((w) => w.id !== workspace.id)
    // Children move up to the removed workspace's parent rather than dangling.
    for (const child of this.state.workspaces) {
      if (child.parentWorkspaceId !== workspace.id) continue
      if (workspace.parentWorkspaceId) child.parentWorkspaceId = workspace.parentWorkspaceId
      else delete child.parentWorkspaceId
    }
    await this.save()
  }

  async updateWorkspace(workspaceId: string, patch: WorkspacePatch): Promise<Workspace> {
    const workspace = this.state.workspaces.find((w) => w.id === workspaceId)
    if (!workspace) throw new Error(`Unknown workspace ${workspaceId}`)
    if (patch.parentWorkspaceId && this.wouldCycle(workspace, patch.parentWorkspaceId)) {
      throw new Error('A workspace cannot be nested under itself or one of its children')
    }
    const allowed: (keyof WorkspacePatch)[] = [
      'displayName',
      'comment',
      'pinned',
      'status',
      'unread',
      'parentWorkspaceId'
    ]
    for (const key of allowed) {
      if (!(key in patch)) continue
      const value = patch[key]
      // An empty string or null clears the field rather than storing it.
      if (value === undefined || value === null || value === '') delete workspace[key]
      else Object.assign(workspace, { [key]: typeof value === 'string' ? value.trim() : value })
    }
    await this.save()
    return workspace
  }

  async setFloatingCwd(path: string): Promise<Workspace> {
    this.state.floatingCwd = path
    await this.save()
    return this.floatingWorkspace()
  }

  private async floatingWorkspace(): Promise<Workspace> {
    const configured = this.state.floatingCwd || homedir()
    const usable = await stat(configured).then((s) => s.isDirectory(), () => false)
    if (!usable) await mkdir(FLOATING_FALLBACK, { recursive: true })
    return {
      id: FLOATING_WORKSPACE_ID,
      projectId: null,
      name: 'Floating workspace',
      path: usable ? configured : FLOATING_FALLBACK,
      branch: null,
      isPrimary: false,
      createdAt: 0
    }
  }

  private wouldCycle(workspace: Workspace, parentId: string): boolean {
    for (let id: string | undefined = parentId; id; ) {
      if (id === workspace.id) return true
      id = this.state.workspaces.find((w) => w.id === id)?.parentWorkspaceId
    }
    return false
  }

  private async addWorkspace(
    fields: Pick<Workspace, 'projectId' | 'name' | 'path' | 'branch'> & Partial<Workspace>
  ): Promise<Workspace> {
    const workspace: Workspace = { id: crypto.randomUUID(), isPrimary: false, createdAt: Date.now(), ...fields }
    this.state.workspaces.push(workspace)
    await this.save()
    return workspace
  }

  private requireProject(projectId: string): Project {
    const project = this.state.projects.find((p) => p.id === projectId)
    if (!project) throw new Error(`Unknown project ${projectId}`)
    return project
  }

  private async save(): Promise<void> {
    await mkdir(HARNESS_HOME, { recursive: true })
    await writeFile(STATE_PATH, JSON.stringify(this.state, null, 2))
    const snapshot = await this.snapshot()
    for (const listener of this.listeners) listener(snapshot)
  }
}

/** `git worktree list --porcelain` (Git 2.7+); prunable entries whose folder is gone are skipped. */
async function listWorktrees(root: string): Promise<{ path: string; branch: string | null }[]> {
  const out = await git(root, ['worktree', 'list', '--porcelain']).catch(() => '')
  const worktrees: { path: string; branch: string | null }[] = []
  for (const block of out.split(/\n\n+/)) {
    const path = /^worktree (.+)$/m.exec(block)?.[1]
    if (!path || /^bare$/m.test(block) || !existsSync(path)) continue
    const branch = /^branch refs\/heads\/(.+)$/m.exec(block)?.[1] ?? null
    worktrees.push({ path: resolve(path), branch })
  }
  return worktrees
}

async function gitUserName(path: string): Promise<string | null> {
  return git(path, ['config', 'user.name'], { quiet: true }).catch(() => null)
}

/** Orca's order: origin/HEAD, then origin/main, origin/master, main, master, then HEAD. */
export async function defaultBaseRef(path: string): Promise<string> {
  const originHead = await git(path, ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD'], { quiet: true }).catch(() => '')
  if (originHead) return originHead
  for (const ref of ['origin/main', 'origin/master', 'main', 'master']) {
    const ok = await git(path, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], { quiet: true }).then(() => true, () => false)
    if (ok) return ref
  }
  return 'HEAD'
}

export function hostInfo(): HostInfo {
  const distro = process.env.WSL_DISTRO_NAME
  if (process.platform === 'linux' && distro) return { id: `wsl:${distro}`, label: `WSL: ${distro}`, platform: 'linux' }
  return { id: 'local', label: process.platform === 'win32' ? 'Windows' : 'This computer', platform: process.platform }
}

function samePath(a: string, b: string): boolean {
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b
}
