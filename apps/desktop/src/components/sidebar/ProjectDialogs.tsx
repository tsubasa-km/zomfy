import { AddRepoDialog } from '@/components/sidebar/AddRepoDialog'
import { NonGitFolderDialog } from '@/components/sidebar/NonGitFolderDialog'
import { SshConnectionsDialog } from '@/components/ssh/SshConnectionsDialog'

/** The dialogs lib/project-dialogs opens from anywhere, mounted once (by the sidebar). */
export function ProjectDialogs() {
  return (
    <>
      <AddRepoDialog />
      <NonGitFolderDialog />
      <SshConnectionsDialog />
    </>
  )
}
