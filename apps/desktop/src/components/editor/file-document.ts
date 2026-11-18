import type { SavedFile, TextEncoding } from '@acp-harness/protocol'
import { harnessRequest } from '@/daemon-connection'
import { t } from '@/i18n/i18n'
import {
  DocumentTransferError,
  readDocumentWith,
  writeDocumentWith,
  type DocumentRequest,
  type OpenedDocument,
  type TextFormat
} from './document-transfer'

// How the text editor gets a file's text from its host and puts it back. Everything about the
// transfer (how much is read at once, in what encoding) belongs here, so the editor only sees text.
//
// The host decodes and encodes: the window is sent text in pieces and sends text back in pieces, and
// the file keeps the encoding and byte order mark it had (document-transfer has the moving parts).

export type { OpenedDocument, TextFormat }

/**
 * The largest file that opens in the editor; a larger one opens in the read-only viewer, which
 * never loads it. Opening, the memory a tab holds and saving all grow in step with the size, while
 * typing does not. Measured in the app (headless Edge, local daemon, a log with Japanese on every
 * line): 53 MB opens in 2–3 s and holds 90 MB; 106 MB in 4–6 s, 190 MB, saved in 5 s; 199 MB in 10 s,
 * 350 MB, saved in 10 s, with the window frozen for 2 s while the model is built. Past this limit a
 * tab would cost more than 6 s and a quarter of a GB, and while loading the text is held about three
 * times over.
 */
export const MAX_EDITABLE_BYTES = 128 * 1024 * 1024

const request: DocumentRequest = (method, params) => harnessRequest(method, params)

export function readDocument(
  workspaceId: string,
  path: string,
  options: { encoding?: TextEncoding; onProgress?: (loadedBytes: number, totalBytes: number) => void; signal?: AbortSignal } = {}
): Promise<OpenedDocument> {
  return readDocumentWith(request, workspaceId, path, { ...options, maxEditableBytes: MAX_EDITABLE_BYTES })
}

/**
 * Saves the text `source` yields in `format`. Refused by the host when the file changed on disk
 * after `expectedMtimeMs` was read, or when the encoding cannot represent a character of the text.
 */
export function writeDocument(
  workspaceId: string,
  path: string,
  source: string | (() => Iterable<string>),
  format: TextFormat,
  expectedMtimeMs?: number,
  options: { onProgress?: (sentChars: number) => void; signal?: AbortSignal } = {}
): Promise<SavedFile> {
  const pieces = typeof source === 'string' ? () => [source] : source
  return writeDocumentWith(request, workspaceId, path, pieces, format, expectedMtimeMs, options)
}

/** A transfer failure in the window's language. */
export function describeDocumentError(error: unknown): string {
  if (error instanceof DocumentTransferError) return t(error.message)
  return error instanceof Error ? error.message : String(error)
}
