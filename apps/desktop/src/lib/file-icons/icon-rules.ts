// Which Material Icon Theme icon a file or a folder gets, by VS Code's rules for icon themes: a
// file's whole name first, then its extensions from the longest ("d.ts" before "ts"); a folder by
// its name. The rules are the theme's own manifest, boiled down to what a lookup needs.

/** Icons are named by their file in the theme's `icons` folder, without ".svg". */
export interface FileIconRules {
  file: string
  folder: string
  folderOpen: string
  root: string
  rootOpen: string
  /** By file name, lower case; a few are "folder/name". */
  names: Record<string, string>
  /** By extension, lower case, without the leading dot. */
  exts: Record<string, string>
  /** By folder name, lower case, without the decoration of ".name", "_name", "-name" and "__name__". */
  folders: Record<string, string>
  /** The open form of a folder icon, where it is not the icon's name plus "-open". */
  opened: Record<string, string>
  /** What differs on a light background. */
  light: { names: Record<string, string>; exts: Record<string, string>; folders: Record<string, string> }
}

/** The parts of the theme's manifest (`generateManifest()` of material-icon-theme) the rules come from. */
export interface IconThemeManifest {
  iconDefinitions?: Record<string, { iconPath: string }>
  file?: string
  folder?: string
  folderExpanded?: string
  rootFolder?: string
  rootFolderExpanded?: string
  fileNames?: Record<string, string>
  fileExtensions?: Record<string, string>
  folderNames?: Record<string, string>
  folderNamesExpanded?: Record<string, string>
  light?: IconThemeManifest
}

/** "__tests__", ".github" and "_build" are "tests", "github" and "build" to the theme. */
function plainFolderName(name: string): string {
  const plain = name.replace(/^__(.+)__$/, '$1').replace(/^[._-](?=.)/, '')
  return plain
}

const plainFolderPath = (path: string): string => path.split('/').map(plainFolderName).join('/')

export function compactIconRules(manifest: IconThemeManifest): FileIconRules {
  const definitions = manifest.iconDefinitions ?? {}
  // An icon's file is usually its name; clones are "<name>.clone.svg".
  const icon = (name: string | undefined, fallback: string): string => {
    const path = name ? definitions[name]?.iconPath : undefined
    return path ? path.slice(path.lastIndexOf('/') + 1).replace(/\.svg$/, '') : fallback
  }
  const opened: Record<string, string> = {}
  const table = (from: Record<string, string> | undefined, key: (k: string) => string = (k) => k.toLowerCase()): Record<string, string> => {
    const out: Record<string, string> = {}
    for (const [k, name] of Object.entries(from ?? {})) out[key(k)] ??= icon(name, name)
    return out
  }
  const folders = (source: IconThemeManifest): Record<string, string> => {
    const out: Record<string, string> = {}
    for (const [k, name] of Object.entries(source.folderNames ?? {})) {
      const key = plainFolderPath(k.toLowerCase())
      if (key in out) continue
      const closed = icon(name, name)
      out[key] = closed
      const open = icon(source.folderNamesExpanded?.[k], `${closed}-open`)
      if (open !== `${closed}-open`) opened[closed] = open
    }
    return out
  }
  return {
    file: icon(manifest.file, 'file'),
    folder: icon(manifest.folder, 'folder'),
    folderOpen: icon(manifest.folderExpanded, 'folder-open'),
    root: icon(manifest.rootFolder, 'folder-root'),
    rootOpen: icon(manifest.rootFolderExpanded, 'folder-root-open'),
    names: table(manifest.fileNames),
    exts: table(manifest.fileExtensions),
    folders: folders(manifest),
    opened,
    light: {
      names: table(manifest.light?.fileNames),
      exts: table(manifest.light?.fileExtensions),
      folders: manifest.light ? folders({ ...manifest.light, iconDefinitions: definitions }) : {}
    }
  }
}

export interface IconLookup {
  /** On a light background. */
  light?: boolean
  /** The name of the folder holding it, for the few rules that name one (".github/workflows"). */
  parent?: string
}

function first(key: string, tables: (Record<string, string> | false | undefined)[]): string | undefined {
  for (const table of tables) {
    // Own keys only: a file may well be called "constructor".
    if (table && Object.hasOwn(table, key)) return table[key]
  }
  return undefined
}

/** The icon for a file called `name` (a path works too: its last part is the name). */
export function fileIconName(rules: FileIconRules, name: string, { light, parent }: IconLookup = {}): string {
  const parts = name.replace(/\\/g, '/').split('/')
  const lower = parts.pop()!.toLowerCase()
  const folder = (parent ?? parts.pop())?.toLowerCase()
  const names = [light && rules.light.names, rules.names]
  const exts = [light && rules.light.exts, rules.exts]
  const named = (folder ? first(`${folder}/${lower}`, names) : undefined) ?? first(lower, names)
  if (named) return named
  for (let dot = lower.indexOf('.'); dot !== -1; dot = lower.indexOf('.', dot + 1)) {
    const found = first(lower.slice(dot + 1), exts)
    if (found) return found
  }
  return rules.file
}

/** The icon for a folder called `name` (or at that path), closed or open. */
export function folderIconName(rules: FileIconRules, name: string, { light, parent, open, root }: IconLookup & { open?: boolean; root?: boolean } = {}): string {
  if (root) return open ? rules.rootOpen : rules.root
  const parts = name.replace(/\\/g, '/').split('/').filter(Boolean)
  const plain = plainFolderName((parts.pop() ?? '').toLowerCase())
  const above = parent ?? parts.pop()
  const tables = [light && rules.light.folders, rules.folders]
  const closed = (above ? first(`${plainFolderName(above.toLowerCase())}/${plain}`, tables) : undefined) ?? first(plain, tables)
  if (!closed) return open ? rules.folderOpen : rules.folder
  return open ? (rules.opened[closed] ?? `${closed}-open`) : closed
}
