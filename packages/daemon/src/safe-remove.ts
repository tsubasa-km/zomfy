import { existsSync } from 'node:fs'
import { lstat, readdir, rm, unlink } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { log } from './log.ts'

// One routine for every folder Zomfy deletes on its own (spec worktree-skills-and-storage B7): a
// worktree, its dependencies and build output, a leftover folder. Windows makes three things hard:
// paths past 260 characters, files another program holds open, and junctions, whose target must
// survive. Bun's recursive rm handles long absolute paths and removes a junction as a link; `rd` on
// the namespaced path is the fallback; what is still there at the end is named in the error.

const ATTEMPTS = 4
const BUSY = /EBUSY|EPERM|ENOTEMPTY|EACCES/

export interface RemoveOptions {
  /** Called once before retrying, to close what may hold the folder open (its terminals). */
  release?: () => void | Promise<void>
}

export async function removeTree(path: string, options: RemoveOptions = {}): Promise<void> {
  const target = resolve(path)
  let released = false
  let lastError: unknown = null
  // A worktree's `.git` goes last, so a removal cut short still leaves a worktree git can remove.
  if (existsSync(join(target, '.git'))) {
    for (const name of await readdir(target).catch(() => [] as string[])) {
      if (name !== '.git') await rm(join(target, name), { recursive: true, force: true }).catch((error) => (lastError = error))
    }
  }
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    if (!(await present(target))) return
    try {
      await rm(target, { recursive: true, force: true })
    } catch (error) {
      lastError = error
    }
    if (!(await present(target))) return
    if (process.platform === 'win32') await rdNamespaced(target)
    if (!(await present(target))) return
    if (!released && options.release) {
      released = true
      await options.release()
    }
    if (lastError && !BUSY.test(String(lastError))) break
    await Bun.sleep(250 * (attempt + 1))
  }
  const held = await firstUndeletable(target)
  const reason = held ? `${held} is in use by another program or cannot be deleted` : String(lastError ?? 'unknown error')
  throw new Error(`Could not delete ${target}: ${reason}`)
}

/** `\\?\C:\…`: Windows' own tools then ignore the 260-character limit. */
export function namespacedPath(path: string): string {
  const absolute = resolve(path)
  if (absolute.startsWith('\\\\?\\')) return absolute
  if (absolute.startsWith('\\\\')) return `\\\\?\\UNC\\${absolute.slice(2)}`
  return `\\\\?\\${absolute}`
}

async function present(path: string): Promise<boolean> {
  return lstat(path).then(
    () => true,
    () => existsSync(path)
  )
}

async function rdNamespaced(path: string): Promise<void> {
  const proc = Bun.spawn(['cmd.exe', '/d', '/c', 'rd', '/s', '/q', namespacedPath(path)], {
    stdout: 'ignore',
    stderr: 'pipe',
    windowsHide: true
  })
  const [code, stderr] = await Promise.all([proc.exited, new Response(proc.stderr).text()])
  if (code !== 0 && stderr.trim()) log(`rd ${path}: ${stderr.trim()}`)
}

/** The first file left that will not go, for the error; null when none can be told. */
async function firstUndeletable(dir: string, depth = 0): Promise<string | null> {
  if (depth > 40) return null
  let info
  try {
    info = await lstat(dir)
  } catch {
    return null
  }
  if (!info.isDirectory()) {
    return unlink(dir).then(
      () => null,
      () => dir
    )
  }
  const entries = await readdir(dir).catch(() => [] as string[])
  for (const name of entries) {
    const found = await firstUndeletable(join(dir, name), depth + 1)
    if (found) return found
  }
  return entries.length > 0 ? null : dir
}
