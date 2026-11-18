import { HARNESS_METHODS, type FileContent } from '@acp-harness/protocol'
import { harnessRequest } from '@/daemon-connection'

// How the text editor gets a file's text from its host and puts it back. Everything about the
// transfer (how much is read at once, in what encoding) belongs here, so the editor only sees text.

export function readDocument(workspaceId: string, path: string): Promise<FileContent> {
  return harnessRequest(HARNESS_METHODS.fsRead, { workspaceId, path })
}

/** Refused by the host when the file changed on disk after `expectedMtimeMs` was read. */
export function writeDocument(workspaceId: string, path: string, content: string, expectedMtimeMs?: number): Promise<{ mtimeMs: number }> {
  return harnessRequest(HARNESS_METHODS.fsWrite, {
    workspaceId,
    path,
    content,
    ...(expectedMtimeMs !== undefined ? { expectedMtimeMs } : {})
  })
}
