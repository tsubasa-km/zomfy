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
