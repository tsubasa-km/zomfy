import { existsSync } from 'node:fs'
import { cp, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { git } from './git-cli.ts'
import { log } from './log.ts'

// `.worktreeinclude` at the repository root lists gitignored files a new worktree needs to run
// (`.env`, local config), as Claude Code reads it: .gitignore patterns, so globs, `#` comments and
// `!` negations work. What they match is copied from the main checkout when git also ignores it, so
// a chat's own worktree runs like the checkout without the person setting anything up. Tracked files
// are never copied: the worktree already has its own, at its branch's version.

export const WORKTREE_INCLUDE_FILE = '.worktreeinclude'

/** The untracked paths in `checkout` the file's patterns match (folders as `dir/`), whether ignored or not. */
async function matched(checkout: string, file: string): Promise<string[]> {
  const out = await git(checkout, ['ls-files', '--others', '--ignored', '--directory', '-z', `--exclude-from=${file}`], { quiet: true })
  return out.split('\0').filter(Boolean)
}

/** Copies what `.worktreeinclude` matches from `checkout` into `worktree`; returns the paths copied. */
export async function copyWorktreeIncludes(checkout: string, worktree: string): Promise<string[]> {
  const file = join(checkout, WORKTREE_INCLUDE_FILE)
  if (!existsSync(file)) return []
  const copied: string[] = []
  for (const entry of await matched(checkout, file)) {
    const path = entry.replace(/\/$/, '')
    const to = join(worktree, path)
    if (existsSync(to)) continue
    // Only what git ignores: an untracked file the person has not ignored is work in progress, not config.
    const ignored = await git(checkout, ['check-ignore', '-q', '--', path], { quiet: true }).then(
      () => true,
      () => false
    )
    if (!ignored) continue
    try {
      await mkdir(dirname(to), { recursive: true })
      await cp(join(checkout, path), to, { recursive: true, errorOnExist: false, force: false })
      copied.push(path)
    } catch (error) {
      log(`could not copy ${path} into ${worktree}: ${String(error)}`)
    }
  }
  if (copied.length > 0) log(`copied ${copied.join(', ')} into ${worktree}`)
  return copied
}

/** For worktree creation: a failure here is logged, never a reason to lose the worktree just made. */
export async function copyWorktreeIncludesSafely(checkout: string, worktree: string): Promise<void> {
  await copyWorktreeIncludes(checkout, worktree).catch((error) => log(`${WORKTREE_INCLUDE_FILE} in ${checkout}: ${String(error)}`))
}
