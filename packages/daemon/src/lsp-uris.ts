import { LSP_EXTERNAL_ROOT, encodeLspUriSegment, lspDocumentUri, parseLspDocumentUri } from '@acp-harness/protocol'

// The window names documents by its editor's model URIs; a language server needs the real path on
// its host. Everything that crosses the daemon is rewritten here, in both directions.

/** How the host spells paths; a parameter rather than `process.platform` so both are testable anywhere. */
export type PathFlavor = 'win32' | 'posix'

export const HOST_FLAVOR: PathFlavor = process.platform === 'win32' ? 'win32' : 'posix'

const UNC_MARKER = '$unc'

/** A `file://` URI as VS Code writes it (`file:///c%3A/dir/a%20b.ts` on Windows), which servers echo back. */
export function pathToFileUri(path: string, flavor: PathFlavor): string {
  if (flavor === 'posix') return `file://${path.split('/').map(encodeLspUriSegment).join('/')}`
  const forward = path.replaceAll('\\', '/')
  if (forward.startsWith('//')) {
    const [host = '', ...rest] = forward.slice(2).split('/')
    return `file://${host}/${rest.map(encodeLspUriSegment).join('/')}`
  }
  const drive = /^([A-Za-z]):/.exec(forward)
  const normal = drive ? drive[1]!.toLowerCase() + forward.slice(1) : forward
  return `file:///${normal.replace(/^\/+/, '').split('/').map(encodeLspUriSegment).join('/')}`
}

/** The host path a `file://` URI names, in the host's own separators; null for other schemes. */
export function fileUriToPath(uri: string, flavor: PathFlavor): string | null {
  const match = /^file:\/\/([^/?#]*)([^?#]*)/i.exec(uri)
  if (!match) return null
  let pathname: string
  try {
    pathname = decodeURIComponent(match[2] ?? '')
  } catch {
    return null
  }
  const host = match[1] ?? ''
  if (flavor === 'posix') return pathname || '/'
  if (host && host.toLowerCase() !== 'localhost') return `\\\\${host}${pathname.replaceAll('/', '\\')}`
  // "/C:/dir" → "C:\dir"
  return pathname.replace(/^\/(?=[A-Za-z]:)/, '').replaceAll('/', '\\')
}

function comparable(path: string, flavor: PathFlavor): string {
  if (flavor === 'posix') return path.replace(/\/+$/, '')
  return path.replaceAll('\\', '/').replace(/\/+$/, '').toLowerCase()
}

/** Rewrites URIs between one workspace's window names and its host paths. */
export class LspUriTranslator {
  private readonly roots: string[]
  /** Files outside the workspace this server has named, the only ones `externalPath` gives out. */
  private readonly externals = new Set<string>()

  /** `roots` are the workspace folder and any other spelling of it a server may answer with (its real path). */
  constructor(
    private readonly workspaceId: string,
    roots: string[],
    private readonly flavor: PathFlavor = HOST_FLAVOR
  ) {
    this.roots = [...new Set(roots)]
  }

  get rootUri(): string {
    return pathToFileUri(this.roots[0]!, this.flavor)
  }

  /** A window URI as the server must see it; anything that is not a window URI passes through. */
  toServer(uri: string): string {
    const doc = parseLspDocumentUri(uri)
    if (doc) {
      if (doc.workspaceId !== this.workspaceId) return uri
      const sep = this.flavor === 'win32' ? '\\' : '/'
      const root = this.roots[0]!.replace(/[\\/]+$/, '')
      return pathToFileUri(doc.path ? `${root}${sep}${doc.path.replaceAll('/', sep)}` : root, this.flavor)
    }
    const external = this.externalPathOf(uri)
    return external ? pathToFileUri(external, this.flavor) : uri
  }

  /** A server URI as the window names it: a workspace file, or a file outside it. */
  toClient(uri: string): string {
    const path = fileUriToPath(uri, this.flavor)
    if (path === null) return uri
    const key = comparable(path, this.flavor)
    for (const root of this.roots) {
      const rootKey = comparable(root, this.flavor)
      if (key === rootKey) return lspDocumentUri(this.workspaceId, '')
      if (key.startsWith(`${rootKey}/`)) {
        const rel = path.replaceAll('\\', '/').replace(/\/+$/, '').slice(rootKey.length + 1)
        return lspDocumentUri(this.workspaceId, rel)
      }
    }
    this.externals.add(key)
    return `${LSP_EXTERNAL_ROOT}/${this.workspaceId}/${this.externalSegments(path).map(encodeLspUriSegment).join('/')}`
  }

  /** The host path behind an external window URI, if this server pointed there; null otherwise. */
  externalPath(uri: string): string | null {
    const path = this.externalPathOf(uri)
    return path && this.externals.has(comparable(path, this.flavor)) ? path : null
  }

  private externalSegments(path: string): string[] {
    if (this.flavor === 'posix') return path.replace(/^\/+/, '').split('/')
    const forward = path.replaceAll('\\', '/')
    return forward.startsWith('//') ? [UNC_MARKER, ...forward.slice(2).split('/')] : forward.split('/')
  }

  private externalPathOf(uri: string): string | null {
    const prefix = `${LSP_EXTERNAL_ROOT}/${this.workspaceId}/`
    if (!uri.startsWith(prefix)) return null
    let segments: string[]
    try {
      segments = uri.slice(prefix.length).replace(/[?#].*$/, '').split('/').map(decodeURIComponent)
    } catch {
      return null
    }
    if (this.flavor === 'posix') return `/${segments.join('/')}`
    return segments[0] === UNC_MARKER ? `\\\\${segments.slice(1).join('\\')}` : segments.join('\\')
  }
}

const URI_KEYS = new Set(['uri', 'targetUri', 'scopeUri', 'baseUri', 'rootUri', 'newUri', 'oldUri'])
/** Values a server gets back exactly as it sent them: rewriting inside would break its own bookkeeping. */
const OPAQUE_KEYS = new Set(['data', 'arguments'])

/** A copy of an LSP params or result object with every document URI passed through `map`. */
export function translateLspUris<T>(value: T, map: (uri: string) => string): T {
  return walk(value, map, null) as T
}

function walk(value: unknown, map: (uri: string) => string, key: string | null): unknown {
  if (typeof value === 'string') return key !== null && URI_KEYS.has(key) ? map(value) : value
  if (Array.isArray(value)) return value.map((item) => walk(item, map, null))
  if (typeof value !== 'object' || value === null) return value
  const out: Record<string, unknown> = {}
  for (const [name, child] of Object.entries(value)) {
    if (OPAQUE_KEYS.has(name)) out[name] = child
    // WorkspaceEdit.changes is keyed by document URI.
    else if (name === 'changes' && typeof child === 'object' && child !== null && !Array.isArray(child)) {
      out[name] = Object.fromEntries(Object.entries(child).map(([uri, edits]) => [map(uri), walk(edits, map, null)]))
    } else out[name] = walk(child, map, name)
  }
  return out
}
