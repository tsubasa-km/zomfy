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
  fsStat: '_harness/fs/stat',
  fsReadText: '_harness/fs/readText',
  fsWriteBegin: '_harness/fs/writeBegin',
  fsWriteChunk: '_harness/fs/writeChunk',
  fsWriteCommit: '_harness/fs/writeCommit',
  fsWriteAbort: '_harness/fs/writeAbort',
  fsLineIndex: '_harness/fs/lineIndex',
  fsReadLines: '_harness/fs/readLines',
  fsFindInFile: '_harness/fs/findInFile'
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
  /**
   * One piece of a text file, decoded. `offset` is 0 or the `nextOffset` of the piece before; without
   * `encoding` the host detects it (meant for offset 0). The file is read whole by asking until
   * `nextOffset` reaches `size`.
   */
  [FILE_METHODS.fsReadText]: {
    params: { workspaceId: string; path: string; offset: number; encoding?: TextEncoding; maxBytes?: number }
    result: TextChunk
  }
  /**
   * Starts a save that goes up in pieces: the host encodes each piece into a temp file and only the
   * commit replaces the file. `content` is the first piece; with `commit` the save ends in this call.
   */
  [FILE_METHODS.fsWriteBegin]: {
    params: {
      workspaceId: string
      path: string
      encoding: TextEncoding
      bom: boolean
      expectedMtimeMs?: number
      content?: string
      commit?: boolean
    }
    result: { writeId: string; saved?: SavedFile }
  }
  /** The next piece, in order. Text the encoding cannot represent fails the call and drops the save. */
  [FILE_METHODS.fsWriteChunk]: { params: { workspaceId: string; writeId: string; content: string }; result: { bytes: number } }
  [FILE_METHODS.fsWriteCommit]: { params: { workspaceId: string; writeId: string }; result: SavedFile }
  [FILE_METHODS.fsWriteAbort]: { params: { workspaceId: string; writeId: string }; result: Record<string, never> }
  /**
   * The file's line index, built once per version of the file and kept by the host. The first call
   * starts it; ask again until `complete`. Lines counted so far can already be read.
   */
  [FILE_METHODS.fsLineIndex]: { params: { workspaceId: string; path: string; encoding?: TextEncoding }; result: FileLineIndex }
  [FILE_METHODS.fsReadLines]: { params: FileLinesParams; result: FileLines }
  [FILE_METHODS.fsFindInFile]: { params: FileFindParams; result: FileFindResult }
}

/** Encodings a text file is read and written in. */
export const TEXT_ENCODINGS = ['utf8', 'utf16le', 'utf16be', 'shiftjis', 'eucjp', 'windows1252', 'gb18030', 'big5', 'euckr'] as const
export type TextEncoding = (typeof TEXT_ENCODINGS)[number]

export interface TextChunk {
  /** The bytes from `offset` up to `nextOffset` as text; a piece never ends inside a character. */
  content: string
  /** Where the next piece starts; equal to `size` after the last one. */
  nextOffset: number
  size: number
  mtimeMs: number
  encoding: TextEncoding
  /** The file starts with the encoding's byte order mark (not part of `content`). */
  bom: boolean
  /** Not text: `content` is empty and there is nothing more to read. */
  binary: boolean
  /** Some bytes are not valid in `encoding` and read as U+FFFD: in this piece, or where detection looked. */
  malformed: boolean
}

export interface SavedFile {
  mtimeMs: number
  size: number
}

export interface FileLineIndex {
  /** Lines found so far; final once `complete`. */
  lineCount: number
  indexedBytes: number
  complete: boolean
  /** The version of the file the index describes; line reads and finds name it. */
  size: number
  mtimeMs: number
  encoding: TextEncoding
  bom: boolean
  binary: boolean
  malformed: boolean
}

export interface FileLinesParams {
  workspaceId: string
  path: string
  encoding: TextEncoding
  /** The indexed version; a file that changed since answers with an error instead of other lines. */
  mtimeMs: number
  /** 1-based. */
  startLine: number
  count: number
}

export interface FileLine {
  text: string
  /** The line is longer than the host returns; `text` is its beginning. */
  clipped?: boolean
}

export interface FileLines {
  startLine: number
  lines: FileLine[]
  lineCount: number
  complete: boolean
}

export interface FileFindParams {
  workspaceId: string
  path: string
  encoding: TextEncoding
  mtimeMs: number
  query: string
  regex?: boolean
  caseSensitive?: boolean
  wholeWord?: boolean
  /** 1-based line the scan starts at. */
  fromLine: number
  /** The scan stops after the line that reaches this many matches. */
  maxMatches?: number
}

export interface FileFindMatch {
  line: number
  /** 1-based, in UTF-16 characters. */
  column: number
  length: number
}

export interface FileFindResult {
  matches: FileFindMatch[]
  /** Where to continue; null when the scan reached the end of the file. */
  nextLine: number | null
  lineCount: number
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
