import type { Workspace } from '@acp-harness/protocol'
import type { HostedProject } from '@/session-store'

/** Dialogs and flows the sidebar root owns; sections only ask for them. */
export interface SidebarActions {
  newWorkspace: (project: HostedProject, parent?: Workspace) => void
  update: (workspace: Workspace) => void
  remove: (workspace: Workspace) => void
  projectSettings: (project: HostedProject) => void
  cleanUp: (project: HostedProject) => void
  removeProject: (project: HostedProject) => void
}
