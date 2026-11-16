import { isSshHost } from '@/daemon-connection'
import { findWorkspace } from '@/session-store'
import { openWorkspaceIn } from '@/components/sidebar/WorkspaceMenu'
import { absolutePath } from '@/components/right-sidebar/explorer-paths'

// A workspace file handed to the OS: shown selected in its file manager, or opened in the app the
// OS opens it with. Neither reaches an SSH host's files, which no local app can see.

/** Whether a workspace's files can be opened outside the app. */
export function canOpenFileExternally(workspaceId: string): boolean {
  const workspace = findWorkspace(workspaceId)
  return workspace !== null && !isSshHost(workspace.hostId)
}

function open(target: 'reveal' | 'default', workspaceId: string, path: string): void {
  const workspace = findWorkspace(workspaceId)
  if (!workspace || isSshHost(workspace.hostId)) return
  openWorkspaceIn(target, workspace.hostId, absolutePath(workspace.path, path))
}

/** The file manager on the file's folder, with the file selected. */
export const revealFile = (workspaceId: string, path: string): void => open('reveal', workspaceId, path)

/** The app the OS opens the file with (it asks when there is none). */
export const openFileWithDefaultApp = (workspaceId: string, path: string): void => open('default', workspaceId, path)
