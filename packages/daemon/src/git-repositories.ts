import { readdir, stat } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import type { GitRepository } from '@acp-harness/protocol'
import { currentBranch, isGitRepository } from './git-cli.ts'

// Repositories inside a workspace folder: its own, and ones below it (a separate repository kept in a
// subfolder and ignored by the parent, a submodule, a monorepo of repositories), so the Source
// Control tab can work in each.

/** How deep below the workspace a repository is looked for. */
const MAX_DEPTH = 4
/** Folders read at most per scan, so a huge tree cannot stall the panel. */
const MAX_DIRS = 4000
/** Folders that hold dependencies or build output, never a repository of the person's own. */
const SKIP = new Set(['node_modules', 'vendor', 'dist', 'build', 'out', 'target', 'venv', '__pycache__', 'bower_components'])

/** A folder with its own `.git` (a folder, or a file for a submodule or worktree) is a repository's top. */
async function hasOwnGit(dir: string): Promise<boolean> {
  return stat(join(dir, '.git')).then(
    () => true,
    () => false
  )
}

/** The workspace's repository (path '') when it is in one, then those below it, nearest first. */
export async function gitRepositories(root: string): Promise<GitRepository[]> {
  const found: string[] = []
  let queue = [root]
  let read = 0
  for (let depth = 1; depth <= MAX_DEPTH && queue.length > 0 && read < MAX_DIRS; depth++) {
    const next: string[] = []
    for (const dir of queue) {
      if (read++ >= MAX_DIRS) break
      const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
      for (const entry of entries) {
        // Hidden folders hold tooling (.git, .venv, .claude worktrees), not the project's repositories.
        if (!entry.isDirectory() || entry.name.startsWith('.') || SKIP.has(entry.name)) continue
        const child = join(dir, entry.name)
        if (await hasOwnGit(child)) found.push(child)
        next.push(child)
      }
    }
    queue = next
  }
  const repos = await Promise.all(
    found.map(async (dir) => ({ path: relative(root, dir).split(sep).join('/'), branch: await currentBranch(dir) }))
  )
  return (await isGitRepository(root)) ? [{ path: '', branch: await currentBranch(root) }, ...repos] : repos
}

/**
 * The folder git runs in for a workspace and one of its repositories (a path below the workspace).
 * Refuses a folder outside the workspace or without its own `.git`: git would otherwise act on the
 * repository around it, and a commit meant for one would land in the other.
 */
export async function repositoryRoot(root: string, repo: string | undefined): Promise<string> {
  if (!repo) return root
  const dir = resolve(root, repo)
  const rel = relative(root, dir)
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) throw new Error(`${repo} is not inside the workspace`)
  if (!(await hasOwnGit(dir))) throw new Error(`${repo} is not a git repository`)
  return dir
}
