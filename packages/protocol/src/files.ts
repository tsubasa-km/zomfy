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
  search: '_harness/search',
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

/** 'HEAD' is the last commit, 'index' the staged copy: the diff editor's left side. */
export type FileRevision = 'HEAD' | 'index'

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
