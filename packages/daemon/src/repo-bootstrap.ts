import { existsSync } from 'node:fs'
import { mkdir, readdir, rm } from 'node:fs/promises'
import { homedir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'
import type { ProjectCreationDefaults } from '@acp-harness/protocol'
import { git } from './git-cli.ts'
import { CLONE_ROOT, PROJECTS_ROOT } from './harness-home.ts'
import { sanitizeWorkspaceName } from './worktree-naming.ts'
import { log } from './log.ts'

// Orca's Add Project dialog: "Clone from URL" and "Create new" (AddRepoCloneStep, useCreateRepo,
// repo-creation-handlers.ts).

/** `owner/repo.git`, `git@host:owner/repo`, or a local path → `repo`. */
export function repoNameFromUrl(url: string): string {
  const last = url.trim().replace(/[\\/]+$/, '').split(/[\\/:]/).at(-1) ?? ''
  return sanitizeWorkspaceName(last.replace(/\.git$/i, ''))
}

/** Typed host paths (SSH) often start with `~`; only the daemon knows its home. */
export function expandHome(path: string): string {
  const trimmed = path.trim()
  if (trimmed === '~') return homedir()
  if (/^~[\\/]/.test(trimmed)) return join(homedir(), trimmed.slice(2))
  return trimmed
}

/** Creates a missing parent (the default one does not exist on a fresh host), like Orca. */
async function prepareParent(parentPath: string | undefined, fallback: string): Promise<string> {
  const parent = parentPath?.trim() ? expandHome(parentPath) : fallback
  if (!isAbsolute(parent)) throw new Error('The parent folder must be an absolute path')
  await mkdir(parent, { recursive: true }).catch((error: unknown) => {
    throw new Error(`Cannot create ${parent}: ${error instanceof Error ? error.message : String(error)}`)
  })
  return resolve(parent)
}

/** Only a missing executable proves git absent; any other failure leaves it unknown. */
export async function probeGitAvailable(): Promise<boolean | null> {
  try {
    await git(homedir(), ['--version'], { quiet: true, timeoutMs: 5000 })
    return true
  } catch (error) {
    const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined
    return code === 'ENOENT' || /ENOENT|not found/i.test(String(error)) ? false : null
  }
}

export async function projectCreationDefaults(): Promise<ProjectCreationDefaults> {
  return { createParent: PROJECTS_ROOT, cloneParent: CLONE_ROOT, gitAvailable: await probeGitAvailable() }
}

async function requireGit(): Promise<void> {
  if ((await probeGitAvailable()) === false) throw new Error('Git is required, and it was not found on this host')
}

export async function cloneRepository(url: string, parentPath: string | undefined, name?: string): Promise<string> {
  if (!url.trim()) throw new Error('Enter a repository URL')
  await requireGit()
  const parent = await prepareParent(parentPath, CLONE_ROOT)
  const target = join(parent, name?.trim() ? sanitizeWorkspaceName(name) : repoNameFromUrl(url))
  if (existsSync(target)) throw new Error(`${target} already exists`)
  await git(parent, ['clone', '--', url.trim(), target])
  log(`cloned ${url} into ${target}`)
  return target
}

const IDENTITY_MISSING =
  'Git author identity is not configured. Run `git config --global user.name "Your Name"` and `git config --global user.email "you@example.com"`, then try again.'

export async function createRepository(parentPath: string | undefined, name: string): Promise<string> {
  if (!name.trim()) throw new Error('Enter a name')
  await requireGit()
  const parent = await prepareParent(parentPath, PROJECTS_ROOT)
  const target = join(parent, sanitizeWorkspaceName(name))
  // An empty folder made beforehand (in Explorer, say) is fine; files in one are never overwritten.
  let createdDir = false
  if (existsSync(target)) {
    const entries = await readdir(target).catch((error: unknown) => {
      throw new Error(`${target} exists and cannot be read: ${error instanceof Error ? error.message : String(error)}`)
    })
    if (entries.length > 0) throw new Error(`${target} already exists and is not empty`)
  } else {
    await mkdir(target)
    createdDir = true
  }
  let step: 'init' | 'commit' = 'init'
  try {
    // `init -b` needs Git 2.28; the host's default branch name is used instead.
    await git(target, ['init'])
    step = 'commit'
    // A first commit gives worktrees something to branch from.
    await git(target, ['commit', '--allow-empty', '-m', 'Initial commit'])
  } catch (error) {
    // A folder that was already there survives for a retry; only what this call made is undone.
    if (createdDir) await rm(target, { recursive: true, force: true }).catch(() => undefined)
    else await rm(join(target, '.git'), { recursive: true, force: true }).catch(() => undefined)
    const message = error instanceof Error ? error.message : String(error)
    if (step === 'commit' && /Please tell me who you are|user\.name|user\.email|empty ident/i.test(message)) {
      throw new Error(IDENTITY_MISSING)
    }
    throw new Error(`${step === 'init' ? 'Failed to initialize the git repository' : 'Failed to create the initial commit'}: ${message}`)
  }
  log(`created repository ${target}`)
  return target
}
