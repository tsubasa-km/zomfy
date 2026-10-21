import { existsSync } from 'node:fs'
import { mkdir, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { git } from './git-cli.ts'
import { sanitizeWorkspaceName } from './worktree-naming.ts'
import { log } from './log.ts'

// Orca's Add Project dialog: "Clone from URL" and "Create new" (AddRepoCloneStep, useCreateRepo).

/** `owner/repo.git`, `git@host:owner/repo`, or a local path → `repo`. */
export function repoNameFromUrl(url: string): string {
  const last = url.trim().replace(/[\\/]+$/, '').split(/[\\/:]/).at(-1) ?? ''
  return sanitizeWorkspaceName(last.replace(/\.git$/i, ''))
}

async function requireFolder(path: string): Promise<string> {
  const absolute = resolve(path)
  const ok = await stat(absolute).then((s) => s.isDirectory(), () => false)
  if (!ok) throw new Error(`${absolute} is not a folder on this host`)
  return absolute
}

export async function cloneRepository(url: string, parentPath: string, name?: string): Promise<string> {
  if (!url.trim()) throw new Error('Enter a repository URL')
  const parent = await requireFolder(parentPath)
  const target = join(parent, name?.trim() ? sanitizeWorkspaceName(name) : repoNameFromUrl(url))
  if (existsSync(target)) throw new Error(`${target} already exists`)
  await git(parent, ['clone', '--', url.trim(), target])
  log(`cloned ${url} into ${target}`)
  return target
}

export async function createRepository(parentPath: string, name: string): Promise<string> {
  if (!name.trim()) throw new Error('Enter a name')
  const parent = await requireFolder(parentPath)
  const target = join(parent, sanitizeWorkspaceName(name))
  if (existsSync(target)) throw new Error(`${target} already exists`)
  await mkdir(target)
  // `init -b` needs Git 2.28; the host's default branch name is used instead.
  await git(target, ['init'])
  // A first commit gives worktrees something to branch from; it needs user.name, so it may be skipped.
  await git(target, ['commit', '--allow-empty', '-m', 'Initial commit']).catch(() => undefined)
  log(`created repository ${target}`)
  return target
}
