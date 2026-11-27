// What a clicked link points at, decided without touching the DOM or the store so it can be tested.

export type LinkTarget =
  /** http(s): the system browser, or an in-app browser tab with the modifier held. */
  | { kind: 'web'; url: string }
  /** mailto:, tel: — only the OS knows what handles them. */
  | { kind: 'system'; url: string }
  /** A path; relative ones are relative to the workspace root. */
  | { kind: 'file'; path: string; line?: number }
  /** In-page anchors keep the browser's own behaviour. */
  | { kind: 'anchor' }
  /** javascript:, data:, unknown schemes: never followed. */
  | { kind: 'blocked' }

const SCHEME_RE = /^([A-Za-z][A-Za-z0-9+.-]*):/
const WINDOWS_DRIVE_RE = /^[A-Za-z]:[\\/]/

export function classifyLinkHref(rawHref: string): LinkTarget {
  const href = rawHref.trim()
  if (!href || href.startsWith('#')) return { kind: 'anchor' }
  if (WINDOWS_DRIVE_RE.test(href)) return withLocation(href)
  const scheme = SCHEME_RE.exec(href)?.[1]?.toLowerCase()
  if (scheme === 'http' || scheme === 'https') return { kind: 'web', url: href }
  if (scheme === 'mailto' || scheme === 'tel') return { kind: 'system', url: href }
  if (scheme === 'file') return withLocation(fileUrlPath(href))
  if (scheme) return { kind: 'blocked' }
  // Protocol-relative URLs are web addresses, not paths.
  if (href.startsWith('//')) return { kind: 'web', url: `https:${href}` }
  return withLocation(safeDecode(href))
}

/** `file:///C:/x` → `C:/x`; `file:///home/x` → `/home/x`. */
function fileUrlPath(href: string): string {
  const path = safeDecode(href.replace(/^file:\/\/(localhost)?/i, ''))
  return /^\/[A-Za-z]:[\\/]/.test(path) ? path.slice(1) : path
}

/** Splits `#L12`, `:12` or `:12:3` off a path. */
function withLocation(path: string): LinkTarget {
  const hash = /#L(\d+)(?:C\d+)?$/i.exec(path)
  if (hash) return { kind: 'file', path: stripQuery(path.slice(0, hash.index)), line: Number(hash[1]) }
  const cleaned = stripQuery(path.replace(/#.*$/, ''))
  const suffix = /:(\d+)(?::\d+)?$/.exec(cleaned)
  // A drive letter's colon is not a line number.
  if (suffix && suffix.index > 1) return { kind: 'file', path: cleaned.slice(0, suffix.index), line: Number(suffix[1]) }
  return { kind: 'file', path: cleaned }
}

function stripQuery(path: string): string {
  return path.replace(/\?.*$/, '')
}

function safeDecode(text: string): string {
  try {
    return decodeURI(text)
  } catch {
    return text
  }
}

/**
 * A path as the editor opens it: relative to the workspace root, or null when it lies outside.
 * Compared case-insensitively on Windows-style roots, whose file systems are.
 */
export function workspaceRelativePath(path: string, root: string | null): string | null {
  const normalized = path.replaceAll('\\', '/').replace(/^\.\//, '')
  const isAbsolute = normalized.startsWith('/') || /^[A-Za-z]:\//.test(normalized)
  if (!isAbsolute) return normalized.startsWith('../') ? null : normalized || null
  if (!root) return null
  const base = root.replaceAll('\\', '/').replace(/\/+$/, '')
  const windows = /^[A-Za-z]:\//.test(base)
  const [a, b] = windows ? [normalized.toLowerCase(), base.toLowerCase()] : [normalized, base]
  if (!a.startsWith(`${b}/`)) return null
  return normalized.slice(base.length + 1) || null
}

/**
 * The workspace a full path lies in, among one host's workspaces, with the path relative to it:
 * the deepest root wins, so a worktree nested in its project's folder takes its own files. A chat's
 * agent often names files of another checkout of the same project (the main one, a sibling worktree).
 */
export function containingWorkspace(
  path: string,
  workspaces: readonly { id: string; path: string }[]
): { workspaceId: string; path: string } | null {
  let best: { workspaceId: string; path: string; depth: number } | null = null
  for (const workspace of workspaces) {
    const relative = workspaceRelativePath(path, workspace.path)
    if (relative === null || !isAbsolutePath(path)) continue
    const depth = workspace.path.replaceAll('\\', '/').replace(/\/+$/, '').length
    if (!best || depth > best.depth) best = { workspaceId: workspace.id, path: relative, depth }
  }
  return best ? { workspaceId: best.workspaceId, path: best.path } : null
}

// Extensions a bare file name (no folder) must have to read as a file rather than code (`a.b`);
// `log` is left out, as `console.log` is code far more often than a file.
const FILE_EXTENSIONS = new Set(
  'png jpg jpeg gif webp svg bmp ico pdf md mdx txt csv json jsonc yaml yml toml xml html htm css scss js jsx ts tsx mjs cjs py rb go rs java kt cs c cpp h hpp sh ps1 bat sql mmd drawio env lock'.split(' ')
)

/** `C:\x`, `\\server\share\x` or `/x/y`: a path that names where it is without a workspace. */
export function isAbsolutePath(path: string): boolean {
  return WINDOWS_DRIVE_RE.test(path) || /^\\\\[^\\]/.test(path) || path.startsWith('/')
}

/**
 * Whether inline code reads as a path worth opening: no scheme, and either a folder in it
 * (`src/a.ts`, `C:\x\y.png`, `./run.sh`) or a bare name with a file extension (`diagram.png`). A
 * `:12` line suffix is allowed. A full path may also name a folder, and a Windows one may have
 * spaces in it (`C:\Program Files\x`), since nothing but a path starts with a drive.
 */
export function looksLikeFilePath(text: string): boolean {
  const value = text.trim()
  if (!value || value.length > 400) return false
  if (SCHEME_RE.test(value) && !WINDOWS_DRIVE_RE.test(value)) return false
  const path = value.replace(/(?::\d+){1,2}$|#L\d+$/i, '')
  const windows = WINDOWS_DRIVE_RE.test(path) || /^\\\\[^\\\s]/.test(path)
  if (/\s/.test(path) && (!windows || /^\s|\s$|\s{2}/.test(path))) return false
  const name = path.split(/[\\/]/).at(-1) ?? ''
  const extension = /\.([\p{L}\p{N}]{1,8})$/u.exec(name)?.[1]?.toLowerCase()
  if (/[\\/]/.test(path)) {
    if (!/^[\p{L}\p{N}_.~:\\/@ ()+,-]+$/u.test(path) || path.includes('//')) return false
    if (extension) return true
    // A folder: only a full path, and not a lone `/word`, which is as likely a command.
    const parts = path.split(/[\\/]/).filter(Boolean)
    return (windows && parts.length >= 2) || (path.startsWith('/') && parts.length >= 2)
  }
  return extension !== undefined && FILE_EXTENSIONS.has(extension) && /^[\p{L}\p{N}_.@-]+$/u.test(name)
}

/** An image the chat can show itself, by its extension. */
export function isImagePath(path: string): boolean {
  return /\.(png|jpe?g|gif|webp)$/i.test(path.replace(/(?::\d+){1,2}$/, ''))
}

/** Set on a container (a chat) whose links belong to that workspace rather than the active one. */
export const LINK_WORKSPACE_ATTR = 'data-link-workspace-id'
/** Set beside it when the chat runs in a folder below the workspace's root: its relative paths start there. */
export const LINK_FOLDER_ATTR = 'data-link-folder'

/** The workspace, and the chat's folder below its root, that the links inside `element` belong to. */
export function linkScope(element: Element | null | undefined): { workspaceId: string | null; folder: string | null } {
  const scope = element?.closest(`[${LINK_WORKSPACE_ATTR}]`)
  return { workspaceId: scope?.getAttribute(LINK_WORKSPACE_ATTR) || null, folder: scope?.getAttribute(LINK_FOLDER_ATTR) || null }
}

/**
 * Where a chat's folder lies below its workspace's root, `/` between parts: null at the root itself
 * or outside it. A chat imported from a subfolder runs there (docs/specs/import-keeps-its-folder.md).
 */
export function chatFolderBelow(cwd: string | null | undefined, root: string | null | undefined): string | null {
  if (!cwd || !root || !isAbsolutePath(cwd)) return null
  return workspaceRelativePath(cwd, root)
}

/** A relative path the chat's agent wrote, made relative to the workspace root instead of the chat's folder. */
export function fromChatFolder(path: string, below: string | null): string {
  if (!below || isAbsolutePath(path)) return path
  const parts = below.split('/').filter(Boolean)
  const up: string[] = []
  for (const part of path.replaceAll('\\', '/').split('/')) {
    if (!part || part === '.') continue
    if (part !== '..') parts.push(part)
    else if (parts.length > 0) parts.pop()
    else up.push('..')
  }
  return [...up, ...parts].join('/')
}

/** A workspace-relative path as the chat's agent reads it from its folder (`x.ts`, `../y.ts`). */
export function toChatFolder(path: string, below: string | null): string {
  if (!below || isAbsolutePath(path)) return path
  const from = below.split('/').filter(Boolean)
  const to = path.replaceAll('\\', '/').split('/').filter(Boolean)
  let shared = 0
  // Folder names as the chat's folder and the file list spell them may differ in case on Windows.
  while (shared < from.length && shared < to.length - 1 && from[shared]!.toLowerCase() === to[shared]!.toLowerCase()) shared++
  return [...from.slice(shared).map(() => '..'), ...to.slice(shared)].join('/')
}
