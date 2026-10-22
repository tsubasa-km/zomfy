import { toast } from 'sonner'
import { HARNESS_METHODS, NOT_A_GIT_REPOSITORY, type Project } from '@acp-harness/protocol'
import { createSession, harnessRequest } from '@/daemon-connection'
import { allProjects, getState, selectWorkspace, setDashboardOpen, setHarnessState, type HostId } from '@/session-store'
import { closeSettings } from '@/stores/app-overlay-store'
import { setBoardOpen } from '@/stores/sidebar-store'
import { setTasks } from '@/stores/tasks-store'
import { defaultChatAgent } from '@/lib/default-chat-agent'
import { addTarget, confirmNonGitFolder } from '@/lib/project-dialogs'
import { linkProjects } from '@/stores/project-links-store'

// Orca's repo-add-actions + finishProjectAddWithDefaultCheckout: toast, then land in the project's
// own checkout; a new folder project also starts a chat with the default agent.

/** What the caller runs on its host; the result is compared with the projects known before. */
export async function completeProjectAdd(hostId: HostId, add: () => Promise<Project>): Promise<Project> {
  const known = new Set(allProjects().filter((p) => p.hostId === hostId).map((p) => p.id))
  const target = addTarget()
  const project = await add()
  const alreadyAdded = known.has(project.id)
  const name = project.displayName || project.name
  if (target) {
    // "Add Workspace on Another Host": the folder joins that project instead of standing alone.
    await linkProjects({ hostId: target.hostId, projectId: target.projectId }, { hostId, projectId: project.id })
    toast.success(`Added to ${target.name}`, { description: `${name} on ${getState().hosts[hostId]?.label ?? hostId}` })
  } else if (alreadyAdded) toast.info('Project already added', { description: name })
  else toast.success(project.kind === 'git' ? 'Project added' : 'Folder added', { description: name })

  // The state broadcast may trail the reply; the primary workspace must be known to select it.
  const state = await harnessRequest(HARNESS_METHODS.stateGet, {}, hostId).catch(() => null)
  if (state) setHarnessState(hostId, state)
  const workspaces = (state ?? getState().hosts[hostId]?.harness)?.workspaces ?? []
  const primary = workspaces.find((w) => w.projectId === project.id && w.isPrimary)
  if (primary) {
    selectWorkspace(primary.id)
    setDashboardOpen(false)
    setBoardOpen(false)
    setTasks({ open: false })
    closeSettings()
    if (!alreadyAdded && !target && project.kind === 'folder') {
      void createSession(primary.id, defaultChatAgent(), { hostId }).catch(() => undefined)
    }
  }
  return project
}

/**
 * Adds a folder the user picked. A folder outside git is not added until the user confirms it
 * (Orca's NonGitFolderDialog); returns null then. An older daemon ignores `requireGit` and adds it.
 */
export async function addPickedProject(hostId: HostId, path: string): Promise<Project | null> {
  try {
    return await completeProjectAdd(hostId, () => harnessRequest(HARNESS_METHODS.projectAdd, { path, requireGit: true }, hostId))
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes(NOT_A_GIT_REPOSITORY)) throw error
    confirmNonGitFolder({ hostId, path })
    return null
  }
}

export function addFolderProject(hostId: HostId, path: string): Promise<Project> {
  return completeProjectAdd(hostId, () => harnessRequest(HARNESS_METHODS.projectAdd, { path }, hostId))
}
