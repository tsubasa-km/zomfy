import { HARNESS_METHODS, type HarnessMethod, type HarnessRequests, type SavedFile, type TextEncoding } from '@zomfy/protocol'

// Moving a document's text between the window and its host in pieces, and falling back to the
// whole-file calls of a host whose daemon predates them. Free of the app's own modules, so it runs
// against any `request` function.

export type DocumentRequest = <M extends HarnessMethod>(method: M, params: HarnessRequests[M]['params']) => Promise<HarnessRequests[M]['result']>

/** What a text file is on disk besides its text. */
export interface TextFormat {
  encoding: TextEncoding
  bom: boolean
}

export interface OpenedDocument {
  /** 'large' is a text file past `maxEditableBytes`: nothing was read beyond its first piece. */
  kind: 'text' | 'binary' | 'large'
  content: string
  format: TextFormat
  mtimeMs: number
  size: number
  /** Bytes that are not valid in the encoding were read as U+FFFD. */
  malformed: boolean
  /** An older host gave only the file's first part. */
  truncated: boolean
  /** The host's daemon predates encodings and pieces: UTF-8, whole files, 1 MB at most. */
  legacy: boolean
}

export const TRANSFER_CANCELLED = 'Cancelled.'
export const HOST_TOO_OLD = "This file's host runs an older daemon that only reads and writes UTF-8; update Zomfy there first."
export const CHANGED_WHILE_READING = 'The file kept changing while it was being read; reload it.'

/** A failure whose message is one of the constants above (the UI translates those). */
export class DocumentTransferError extends Error {}

/** Characters per piece of a save: a few hundred KB on the wire whatever the text. */
export const SAVE_PIECE_CHARS = 256 * 1024

/** A daemon from before a method answers JSON-RPC "method not found". */
export function isUnsupported(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === -32601
}

function throwIfCancelled(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new DocumentTransferError(TRANSFER_CANCELLED)
}

export async function readDocumentWith(
  request: DocumentRequest,
  workspaceId: string,
  path: string,
  options: {
    /** Read as this instead of detecting. */
    encoding?: TextEncoding
    maxEditableBytes: number
    onProgress?: (loadedBytes: number, totalBytes: number) => void
    signal?: AbortSignal
  }
): Promise<OpenedDocument> {
  for (let attempt = 0; attempt < 3; attempt++) {
    let first
    try {
      first = await request(HARNESS_METHODS.fsReadText, {
        workspaceId,
        path,
        offset: 0,
        ...(options.encoding ? { encoding: options.encoding } : {})
      })
    } catch (error) {
      if (!isUnsupported(error)) throw error
      if (options.encoding && options.encoding !== 'utf8') throw new DocumentTransferError(HOST_TOO_OLD)
      const whole = await request(HARNESS_METHODS.fsRead, { workspaceId, path })
      return {
        kind: whole.binary ? 'binary' : 'text',
        content: whole.content,
        format: { encoding: 'utf8', bom: false },
        mtimeMs: whole.mtimeMs,
        size: whole.content.length,
        malformed: false,
        truncated: whole.truncated,
        legacy: true
      }
    }
    const base = {
      format: { encoding: first.encoding, bom: first.bom },
      mtimeMs: first.mtimeMs,
      size: first.size,
      truncated: false,
      legacy: false
    }
    if (first.binary) return { ...base, kind: 'binary', content: '', malformed: false }
    if (first.size > options.maxEditableBytes) return { ...base, kind: 'large', content: '', malformed: first.malformed }
    const pieces = [first.content]
    let malformed = first.malformed
    let offset = first.nextOffset
    let changed = false
    options.onProgress?.(offset, first.size)
    while (offset < first.size) {
      throwIfCancelled(options.signal)
      const piece = await request(HARNESS_METHODS.fsReadText, { workspaceId, path, offset, encoding: first.encoding })
      // Pieces of two versions of the file do not make a document; start over.
      if (piece.size !== first.size || Math.abs(piece.mtimeMs - first.mtimeMs) > 1) {
        changed = true
        break
      }
      if (piece.nextOffset <= offset) throw new Error(`Reading ${path} made no progress`)
      pieces.push(piece.content)
      malformed ||= piece.malformed
      offset = piece.nextOffset
      options.onProgress?.(offset, first.size)
    }
    throwIfCancelled(options.signal)
    if (!changed) return { ...base, kind: 'text', content: pieces.join(''), malformed }
  }
  throw new DocumentTransferError(CHANGED_WHILE_READING)
}

/** `source` cut into strings of at most `max` characters. */
export function* piecesOf(source: Iterable<string>, max: number): Generator<string> {
  for (const part of source) {
    for (let at = 0; at < part.length; at += max) yield part.slice(at, at + max)
  }
}

/**
 * Saves the text `source` yields, in `format`. Refused by the host when the file changed on disk
 * after `expectedMtimeMs` was read, or when the text has a character the encoding cannot represent.
 */
export async function writeDocumentWith(
  request: DocumentRequest,
  workspaceId: string,
  path: string,
  source: () => Iterable<string>,
  format: TextFormat,
  expectedMtimeMs: number | undefined,
  options: { onProgress?: (sentChars: number) => void; signal?: AbortSignal; pieceChars?: number } = {}
): Promise<SavedFile> {
  const expected = expectedMtimeMs !== undefined ? { expectedMtimeMs } : {}
  const pieces = piecesOf(source(), options.pieceChars ?? SAVE_PIECE_CHARS)
  const first = pieces.next()
  let next = first.done ? first : pieces.next()
  let begun
  try {
    begun = await request(HARNESS_METHODS.fsWriteBegin, {
      workspaceId,
      path,
      ...format,
      ...expected,
      content: first.done ? '' : first.value,
      // A document of one piece is saved by this call alone.
      commit: next.done === true
    })
  } catch (error) {
    if (!isUnsupported(error)) throw error
    if (format.encoding !== 'utf8' || format.bom) throw new DocumentTransferError(HOST_TOO_OLD)
    const saved = await request(HARNESS_METHODS.fsWrite, { workspaceId, path, content: [...source()].join(''), ...expected })
    return { mtimeMs: saved.mtimeMs, size: -1 }
  }
  if (begun.saved) return begun.saved
  const { writeId } = begun
  let sent = first.done ? 0 : first.value.length
  try {
    while (!next.done) {
      throwIfCancelled(options.signal)
      options.onProgress?.(sent)
      await request(HARNESS_METHODS.fsWriteChunk, { workspaceId, writeId, content: next.value })
      sent += next.value.length
      next = pieces.next()
    }
    throwIfCancelled(options.signal)
    return await request(HARNESS_METHODS.fsWriteCommit, { workspaceId, writeId })
  } catch (error) {
    // The host drops a save that failed there; this covers the ones that failed or stopped here.
    void request(HARNESS_METHODS.fsWriteAbort, { workspaceId, writeId }).catch(() => undefined)
    throw error
  }
}
