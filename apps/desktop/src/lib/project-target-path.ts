// Orca's create-project-defaults.ts: the "where will it go" preview under Clone and Create.

function separatorFor(path: string): '/' | '\\' {
  return path.includes('\\') ? '\\' : '/'
}

/** Joins with the parent's own separator, since the path belongs to the host (WSL, SSH), not this OS. */
export function joinHostPath(parent: string, child: string): string {
  const raw = parent.trim()
  const name = child.trim().replace(/^[\\/]+/, '')
  let base = raw.replace(/[\\/]+$/, '')
  if (!base && raw.startsWith('/')) base = '/'
  if (!base || !name) return base || name
  if (base === '/') return `/${name}`
  if (/^[A-Za-z]:$/.test(base)) return `${base}\\${name}`
  return `${base}${separatorFor(base)}${name}`
}

/** Mirrors the daemon's sanitizeWorkspaceName, so the preview shows the folder it will really make. */
export function projectFolderName(input: string): string {
  const slug = input
    .trim()
    .replace(/[^\p{L}\p{N}._-]+/gu, '-')
    .replace(/-{2,}/g, '-')
    .replace(/\.{2,}/g, '.')
    .replace(/^[.-]+|[.-]+$/g, '')
  return slug || 'workspace'
}

/** Mirrors the daemon's repoNameFromUrl: `owner/repo.git` or `git@host:owner/repo` → `repo`. */
export function repoFolderName(url: string): string {
  const last = url.trim().replace(/[\\/]+$/, '').split(/[\\/:]/).at(-1) ?? ''
  return projectFolderName(last.replace(/\.git$/i, ''))
}
