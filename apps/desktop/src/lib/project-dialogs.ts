import { allProjects, findWorkspace, getState, type HostId } from '@/session-store'
import { createExternalStore } from '@/stores/external-store'
import { openNewWorkspace } from '@/stores/tasks-store'

// Orca's activeModal 'add-repo' / 'confirm-non-git-folder' and the new-workspace composer, openable
// from anywhere (sidebar, onboarding, the empty view, Mod+N); ProjectDialogs mounts them once.

export type AddProjectStep = 'start' | 'clone' | 'create'

export interface AddProjectRequest {
  hostId?: HostId
  step: AddProjectStep
  /** Reopening with the same options still resets the dialog. */
  nonce: number
}

export interface NonGitFolderRequest {
  hostId: HostId
  path: string
}

const addProjectRequests = createExternalStore<AddProjectRequest | null>(null)
const nonGitFolderRequests = createExternalStore<NonGitFolderRequest | null>(null)
const orcaImportOpen = createExternalStore(false)
let nonce = 0

export const useAddProjectRequest = () => addProjectRequests.use((r) => r)
export const useNonGitFolderRequest = () => nonGitFolderRequests.use((r) => r)
export const useOrcaImportOpen = () => orcaImportOpen.use((open) => open)

export function openAddProjectDialog(opts: { hostId?: HostId; step?: AddProjectStep } = {}): void {
  addProjectRequests.set({ ...(opts.hostId ? { hostId: opts.hostId } : {}), step: opts.step ?? 'start', nonce: ++nonce })
}

export function closeAddProjectDialog(): void {
  addProjectRequests.set(null)
}

export function confirmNonGitFolder(request: NonGitFolderRequest | null): void {
  nonGitFolderRequests.set(request)
}

export function setOrcaImportOpen(open: boolean): void {
  orcaImportOpen.set(open)
}

/**
 * Orca's Mod+N composer: the given project, else the active workspace's, else the host's (or any)
 * first one. With no project at all it opens Add Project instead, as Orca's empty composer does.
 */
export function openNewWorkspaceDialog(opts: { projectId?: string; hostId?: HostId } = {}): void {
  const projects = allProjects()
  const onHost = (hostId: HostId) => projects.filter((p) => p.hostId === hostId)
  const active = findWorkspace(getState().activeWorkspaceId ?? '')
  const project =
    (opts.projectId ? projects.find((p) => p.id === opts.projectId && (!opts.hostId || p.hostId === opts.hostId)) : undefined) ??
    (active?.projectId && (!opts.hostId || active.hostId === opts.hostId)
      ? projects.find((p) => p.id === active.projectId && p.hostId === active.hostId)
      : undefined) ??
    (opts.hostId ? onHost(opts.hostId)[0] : projects[0])
  if (!project) {
    openAddProjectDialog(opts.hostId ? { hostId: opts.hostId } : {})
    return
  }
  openNewWorkspace({ project })
}
