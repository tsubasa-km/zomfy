import { posix, win32 } from 'node:path'

// Folders as agents and the OS write them down: one place may come as `C:\Work\app`, `c:/work/app/`
// or `\\?\C:\Work\app`. These compare them as the file system would, by the path's own form, so a
// Windows path compares the same way whichever host reads it.

const WINDOWS_PATH = /^(?:[A-Za-z]:(?:[\\/]|$)|\\\\|\/\/)/

/** `\\?\C:\x` → `C:\x`, `\\?\UNC\server\share` → `\\server\share`. */
function withoutLongPrefix(path: string): string {
  return path.replace(/^[\\/]{2}\?[\\/]UNC[\\/]/i, '\\\\').replace(/^[\\/]{2}\?[\\/]/, '')
}

/** The path resolved, its long-path prefix dropped; and whether it is a Windows one. */
function resolvedFolder(path: string): { path: string; windows: boolean } {
  const bare = withoutLongPrefix(path)
  const windows = WINDOWS_PATH.test(bare) || (process.platform === 'win32' && !bare.startsWith('/'))
  return { path: windows ? win32.resolve(bare) : posix.resolve(bare), windows }
}

/** The path resolved and, for a Windows one, with its separators and case made uniform. */
export function plainFolder(path: string): string {
  const resolved = resolvedFolder(path)
  return resolved.windows ? resolved.path.toLowerCase() : resolved.path
}

/** Whether two paths name one folder, however each agent wrote it down. */
export function sameFolder(a: string, b: string): boolean {
  return plainFolder(a) === plainFolder(b)
}

/**
 * Where `path` lies below `root`, in `path`'s own spelling with `/` between parts: `''` for `root`
 * itself, null when it lies outside.
 */
export function folderBelow(path: string, root: string): string | null {
  const own = resolvedFolder(path)
  const a = plainFolder(path)
  const b = plainFolder(root)
  if (a === b) return ''
  const prefix = /[\\/]$/.test(b) ? b : `${b}${own.windows ? '\\' : '/'}`
  if (!a.startsWith(prefix)) return null
  // Lower-cased for the comparison only: what is below keeps the case it was recorded with.
  return own.path
    .slice(prefix.length)
    .split(/[\\/]/)
    .filter(Boolean)
    .join('/')
}

/** `root` with `below` (as folderBelow gives it) under it, in `root`'s own separators. */
export function folderUnder(root: string, below: string): string {
  if (!below) return root
  const sep = resolvedFolder(root).windows ? '\\' : '/'
  return `${root.replace(/[\\/]+$/, '')}${sep}${below.split('/').join(sep)}`
}

/** Where a folder below `from` is once `from` moved to `to`: the same place below it, else `to`. */
export function folderAfterMove(folder: string, from: string, to: string): string {
  return folderUnder(to, folderBelow(folder, from) ?? '')
}

/**
 * The workspace that owns a folder: the one whose folder it is, else the deepest whose folder holds
 * it (a worktree nested in its project's folder owns its own files).
 */
export function owningWorkspace<W extends { path: string }>(folder: string, workspaces: readonly W[]): W | null {
  let best: { workspace: W; depth: number } | null = null
  for (const workspace of workspaces) {
    const below = folderBelow(folder, workspace.path)
    if (below === null) continue
    if (below === '') return workspace
    const depth = plainFolder(workspace.path).length
    if (!best || depth > best.depth) best = { workspace, depth }
  }
  return best?.workspace ?? null
}
