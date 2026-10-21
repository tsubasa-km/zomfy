import { realpath, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { isAbsolute, relative, resolve, sep } from 'node:path'

const MAX_PATHS = 200

/**
 * Workspace-relative paths for the path text a terminal printed, resolved on this host against
 * the terminal's cwd. A link only shows when a click can open it, as Orca's host existence check.
 */
export async function resolveTerminalPaths(cwd: string, workspaceRoot: string, paths: string[]): Promise<(string | null)[]> {
  const root = await realpath(workspaceRoot).catch(() => workspaceRoot)
  return Promise.all(
    paths.slice(0, MAX_PATHS).map(async (text) => {
      const native = toNativePath(text)
      // An unprompted stat of a network share can send the user's credentials to its server.
      if (!native || /^[\\/]{2}/.test(native)) return null
      try {
        const absolute = await realpath(isAbsolute(native) ? native : resolve(cwd, native))
        if (!(await stat(absolute)).isFile()) return null
        const rel = relative(root, absolute)
        if (!rel || rel.startsWith('..') || isAbsolute(rel)) return null
        return rel.split(sep).join('/')
      } catch {
        return null
      }
    })
  )
}

function toNativePath(text: string): string | null {
  let path = text.trim()
  if (!path) return null
  if (path.startsWith('~/') || path.startsWith('~\\')) path = homedir() + path.slice(1)
  // Git Bash and MSYS print drive paths as /c/Users/…
  if (process.platform === 'win32') path = path.replace(/^\/([A-Za-z])(?=\/)/, '$1:')
  return path
}
