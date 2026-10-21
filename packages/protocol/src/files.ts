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
}

export interface SearchParams {
  workspaceId: string
  query: string
  regex?: boolean
  caseSensitive?: boolean
}

export interface SearchResult {
  matches: SearchMatch[]
  truncated: boolean
}

export const FILE_METHODS = {
  fsList: '_harness/fs/list',
  fsRead: '_harness/fs/read',
  fsWrite: '_harness/fs/write',
  search: '_harness/search'
} as const

export interface FileRequests {
  [FILE_METHODS.fsList]: { params: { workspaceId: string; dir: string }; result: FileEntry[] }
  [FILE_METHODS.fsRead]: { params: { workspaceId: string; path: string }; result: FileContent }
  [FILE_METHODS.fsWrite]: {
    params: { workspaceId: string; path: string; content: string; expectedMtimeMs?: number }
    result: { mtimeMs: number }
  }
  [FILE_METHODS.search]: { params: SearchParams; result: SearchResult }
}
