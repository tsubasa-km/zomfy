import { Circle } from 'lucide-react'
import type { WorkspaceStatusId } from '@acp-harness/protocol'
import { cn } from '@/lib/utils'
import { ConductorDoneIcon, ConductorProgressIcon, ConductorReviewIcon } from './workspace-status-icons'

// Icons and tones from Orca's default board statuses (workspace-status-icons.tsx, workspace-status.ts).
export function WorkspaceStatusIcon({ status, className }: { status?: WorkspaceStatusId; className?: string }) {
  switch (status) {
    case 'in-progress':
      return <ConductorProgressIcon className={cn('size-3.5 text-[#d4a300]', className)} />
    case 'in-review':
      return <ConductorReviewIcon className={cn('size-3.5 text-[#16a34a]', className)} />
    case 'completed':
      return <ConductorDoneIcon className={cn('size-3.5 text-[#c7a594]', className)} />
    case 'todo':
      return <Circle className={cn('size-3.5 text-muted-foreground', className)} />
    default:
      return <Circle className={cn('size-3.5 text-muted-foreground/40', className)} strokeDasharray="2 2" />
  }
}
