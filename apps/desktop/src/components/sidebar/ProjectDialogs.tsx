import { OrcaImportDialog } from '@/components/OrcaImportDialog'
import { AddRepoDialog } from '@/components/sidebar/AddRepoDialog'
import { NonGitFolderDialog } from '@/components/sidebar/NonGitFolderDialog'
import { setOrcaImportOpen, useOrcaImportOpen } from '@/lib/project-dialogs'

/** The dialogs lib/project-dialogs opens from anywhere, mounted once (by the sidebar). */
export function ProjectDialogs() {
  const importing = useOrcaImportOpen()
  return (
    <>
      <AddRepoDialog />
      <NonGitFolderDialog />
      <OrcaImportDialog open={importing} onClose={() => setOrcaImportOpen(false)} />
    </>
  )
}
