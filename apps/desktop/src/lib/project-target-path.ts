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

/** Why a typed folder name cannot be a folder on any host, or null when it can. */
export type FolderNameProblem = 'empty' | 'separator' | 'character' | 'trailing' | 'dots' | 'reserved'

// Windows refuses these in a name; other hosts take them, but a project may be opened from Windows too.
const ILLEGAL_CHARACTER = /[<>:"|?*\u0000-\u001f]/u
const RESERVED_NAME = /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])(\..*)?$/i

export function folderNameProblem(input: string): FolderNameProblem | null {
  const name = input.trim()
  if (!name) return 'empty'
  if (/[\\/]/.test(name)) return 'separator'
  if (ILLEGAL_CHARACTER.test(name)) return 'character'
  if (name === '.' || name === '..') return 'dots'
  // Spaces around the name are trimmed, as the daemon trims them; a final dot Windows drops.
  if (name.endsWith('.')) return 'trailing'
  if (RESERVED_NAME.test(name)) return 'reserved'
  return null
}

/**
 * The display name to send with a new project: what was typed, else the field's default; nothing
 * when that is just the folder's own name, so an untouched field leaves the project unnamed.
 */
export function displayNameToSend(typed: string, fallback: string, folder: string): string | undefined {
  const name = typed.trim() || fallback.trim()
  return name && name !== folder ? name : undefined
}
