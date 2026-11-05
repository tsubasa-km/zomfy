import { useState } from 'react'
import { CopyPlus, Loader2 } from 'lucide-react'
import { HARNESS_METHODS, type Workflow } from '@acp-harness/protocol'
import { harnessRequest } from '@/daemon-connection'
import { allProjects } from '@/session-store'
import { projectLabel } from '@/components/sidebar/workspace-visibility'
import {
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger
} from '@/components/ui/dropdown-menu'
import { t } from '@/i18n/i18n'

// "Copy from another project" in the workflow picker: the other projects' saved workflows, read
// from their hosts when the submenu opens; the pick becomes an unsaved copy in this project.

type Listing = { projectId: string; name: string; workflows: Workflow[] }[]

export function WorkflowCopyMenu({ projectId, onPick }: { projectId: string; onPick: (workflow: Workflow) => void }) {
  const [listing, setListing] = useState<Listing | null>(null)

  const load = async () => {
    setListing(null)
    const others = allProjects().filter((p) => p.id !== projectId)
    const lists = await Promise.all(
      others.map(async (p) => ({
        projectId: p.id,
        name: projectLabel(p),
        // A project on a host out of contact simply lists nothing.
        workflows: await harnessRequest(HARNESS_METHODS.workflowsList, { projectId: p.id }, p.hostId).catch(() => [])
      }))
    )
    setListing(lists.filter((l) => l.workflows.length > 0))
  }

  return (
    <DropdownMenuSub onOpenChange={(open) => open && void load()}>
      <DropdownMenuSubTrigger data-workflow-copy-from>
        <CopyPlus className="size-3.5" />
        {t('Copy from another project')}
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="max-h-80 w-64 overflow-y-auto">
        {listing === null ? (
          <div className="flex items-center gap-2 px-2 py-1.5 text-xs text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" />
            {t('Loading…')}
          </div>
        ) : listing.length === 0 ? (
          <div className="px-2 py-1.5 text-xs text-muted-foreground">{t('No other project has workflows.')}</div>
        ) : (
          listing.map((project) => (
            <div key={project.projectId}>
              <DropdownMenuLabel className="text-xs text-muted-foreground">{project.name}</DropdownMenuLabel>
              {project.workflows.map((w) => (
                <DropdownMenuItem key={w.id} data-workflow-copy-item={w.name} onSelect={() => onPick(w)}>
                  <span className="min-w-0 truncate">{w.name}</span>
                </DropdownMenuItem>
              ))}
            </div>
          ))
        )}
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  )
}
