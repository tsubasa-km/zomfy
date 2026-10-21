export interface FileEntry {
  name: string
  /** Workspace-relative, '/'-separated. */
  path: string
  kind: 'file' | 'dir' | 'symlink'
}

export interface FileContent {
  path: string
  content: string
  binary: boolean
  truncated: boolean
  /** For write conflict checks: saving fails if the file changed since this read. */
  mtimeMs: number
}

export interface SearchMatch {
  /** Workspace-relative, '/'-separated. */
  path: string
  line: number
  column: number
  text: string
  /** Characters the first hit on the line spans, from `column`; absent from older daemons. */
  length?: number
}

export interface SearchParams {
  workspaceId: string
  query: string
  regex?: boolean
  caseSensitive?: boolean
  wholeWord?: boolean
  /** Comma-separated globs ("files to include"), as in Orca's search filters. */
  include?: string
  /** Comma-separated globs ("files to exclude"). */
  exclude?: string
}

export interface ReplaceParams extends SearchParams {
  replacement: string
  /** Files to rewrite; each gets every match replaced. */
  paths: string[]
  /** Replace only the hits on this line (1-based) of the single path in `paths`. */
  line?: number
}

export interface ReplaceResult {
  files: number
  replacements: number
}

/** `trash-unavailable` means nothing was deleted: the host has no trash for that path; ask before deleting for good. */
export type DeleteResult = { status: 'trashed' | 'deleted' } | { status: 'trash-unavailable'; reason: string }

export interface SearchResult {
  matches: SearchMatch[]
  truncated: boolean
}

export const FILE_METHODS = {
  fsList: '_harness/fs/list',
  fsRead: '_harness/fs/read',
  fsWrite: '_harness/fs/write',
  search: '_harness/search',
  fsCreate: '_harness/fs/create',
  fsRename: '_harness/fs/rename',
  fsDelete: '_harness/fs/delete',
  fsDuplicate: '_harness/fs/duplicate',
  searchReplace: '_harness/search/replace',
  fsReadBinary: '_harness/fs/readBinary',
  fsReadRevision: '_harness/fs/readRevision',
  fsStat: '_harness/fs/stat'
} as const

export interface FileRequests {
  [FILE_METHODS.fsList]: { params: { workspaceId: string; dir: string }; result: FileEntry[] }
  [FILE_METHODS.fsRead]: { params: { workspaceId: string; path: string }; result: FileContent }
  [FILE_METHODS.fsWrite]: {
    params: { workspaceId: string; path: string; content: string; expectedMtimeMs?: number }
    result: { mtimeMs: number }
  }
  [FILE_METHODS.search]: { params: SearchParams; result: SearchResult }
  [FILE_METHODS.fsCreate]: {
    params: { workspaceId: string; path: string; kind: 'file' | 'dir' }
    result: Record<string, never>
  }
  /** Rename or move; refuses to overwrite an existing entry. */
  [FILE_METHODS.fsRename]: { params: { workspaceId: string; from: string; to: string }; result: Record<string, never> }
  [FILE_METHODS.fsDelete]: { params: { workspaceId: string; paths: string[]; permanent?: boolean }; result: DeleteResult }
  /** Copies a file or folder next to itself ("name copy.ext") and returns the new path. */
  [FILE_METHODS.fsDuplicate]: { params: { workspaceId: string; path: string }; result: { path: string } }
  [FILE_METHODS.searchReplace]: { params: ReplaceParams; result: ReplaceResult }
  [FILE_METHODS.fsReadBinary]: { params: { workspaceId: string; path: string }; result: FileBinaryContent }
  [FILE_METHODS.fsReadRevision]: { params: FileRevisionParams; result: FileRevisionContent }
  [FILE_METHODS.fsStat]: { params: { workspaceId: string; path: string }; result: FileStat }
}

/** Images and PDFs for the viewers; the text read path cannot carry bytes. */
export interface FileBinaryContent {
  path: string
  base64: string
  size: number
  mtimeMs: number
}

/** 'HEAD' is the last commit, 'index' the staged copy; any other value is a commit id (history and base-compare diffs). */
export type FileRevision = 'HEAD' | 'index' | (string & {})

export interface FileRevisionParams {
  workspaceId: string
  path: string
  revision: FileRevision
  encoding?: 'utf8' | 'base64'
}

export interface FileRevisionContent {
  path: string
  revision: FileRevision
  /** False when the path is not in that revision (added or untracked files). */
  exists: boolean
  binary: boolean
  /** utf8 text, or base64 when requested. */
  content: string
}

/** For the editor's changed-on-disk check. */
export interface FileStat {
  exists: boolean
  mtimeMs: number
  size: number
}
