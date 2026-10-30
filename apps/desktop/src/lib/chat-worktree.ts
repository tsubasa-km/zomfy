import { toast } from 'sonner'
import { HARNESS_METHODS } from '@acp-harness/protocol'
import { createSession, harnessRequest } from '@/daemon-connection'
import { allWorkspaces, getState, selectWorkspace, type HostedProject } from '@/session-store'
import { defaultChatAgent } from '@/lib/default-chat-agent'
import { suggestWorkspaceName } from '@/lib/workspace-name-suggestion'
import { t } from '@/i18n/i18n'

// One chat, one worktree: a new chat in a git project gets a worktree of its own, so chats working at
// the same time never edit the same checkout. A folder project has only its folder.

/** Starts a chat in a new worktree of `project` (its own folder for a folder project, or when asked). */
export async function startChat(project: HostedProject, where: 'worktree' | 'checkout' = 'worktree'): Promise<void> {
  try {
    let workspaceId: string | undefined
    if (project.kind === 'git' && where === 'worktree') {
      const workspace = await harnessRequest(
        HARNESS_METHODS.workspaceCreate,
        { projectId: project.id, name: suggestWorkspaceName(), runSetup: true },
        project.hostId
      )
      workspaceId = workspace.id
    } else {
      workspaceId = allWorkspaces(getState()).find((w) => w.projectId === project.id && w.isPrimary)?.id
    }
    if (!workspaceId) throw new Error(t('The project has no folder to start a chat in.'))
    selectWorkspace(workspaceId)
    await createSession(workspaceId, defaultChatAgent())
  } catch (error) {
    toast.error(t("Couldn't start a chat"), { description: error instanceof Error ? error.message : String(error) })
  }
}
