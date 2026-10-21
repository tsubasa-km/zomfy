// "Find in Folder" hands the search panel a files-to-include glob; the panel may not be mounted
// yet, so the request waits here until it is.

type FindInFolder = { workspaceId: string; include: string }

let pending: FindInFolder | null = null
const listeners = new Set<(request: FindInFolder) => void>()

export function requestFindInFolder(workspaceId: string, include: string): void {
  pending = { workspaceId, include }
  for (const listener of listeners) listener(pending)
}

/** Takes a waiting request for this workspace, if any. */
export function takeFindInFolder(workspaceId: string): string | null {
  if (pending?.workspaceId !== workspaceId) return null
  const { include } = pending
  pending = null
  return include
}

export function onFindInFolder(listener: (request: FindInFolder) => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
