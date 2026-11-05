import { PanelRightClose } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { hidePaneSidebar, showPaneSidebar, usePaneSidebar } from '@/stores/pane-sidebar-store'
import { WorkspacePanelView, useWorkspacePanels } from './workspace-panels'
import { cn } from '@/lib/utils'
import { t } from '@/i18n/i18n'

// The right sidebar, one per workspace pane, so what it shows plainly belongs to that pane's
// project: the workspace's panels behind a row of icons, opened from the pane's header.

function PanelButton({ label, active, onClick, children }: { label: string; active?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          aria-pressed={active}
          onClick={onClick}
          className={cn(
            'flex size-7 shrink-0 items-center justify-center rounded-md transition-colors',
            active ? 'bg-accent text-foreground' : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground'
          )}
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  )
}

export function PaneSidebar({ workspaceId }: { workspaceId: string }) {
  const { open, panel } = usePaneSidebar(workspaceId)
  const panels = useWorkspacePanels()
  if (!open) return null
  const shown = panels.some((p) => p.id === panel) ? panel : panels[0]!.id
  return (
    <aside
      data-pane-sidebar={workspaceId}
      className={cn(
        // Never more than half a narrow pane, so its tabs stay usable.
        'flex min-h-0 max-w-[50%] shrink-0 flex-col overflow-hidden border-l border-sidebar-border bg-sidebar text-sidebar-foreground',
        // A chat needs more room than a file tree.
        shown === 'panel:side-chat' ? 'w-[420px]' : 'w-[300px]'
      )}
    >
      <div className="flex h-9 shrink-0 items-center gap-0.5 overflow-hidden border-b border-border px-1">
        {panels.map(({ id, label, icon: Icon }) => (
          <PanelButton key={id} label={label} active={id === shown} onClick={() => showPaneSidebar(workspaceId, id)}>
            <Icon className="size-4" />
          </PanelButton>
        ))}
        <div className="ml-auto">
          <PanelButton label={t('Close sidebar')} onClick={() => hidePaneSidebar(workspaceId)}>
            <PanelRightClose className="size-4" />
          </PanelButton>
        </div>
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <WorkspacePanelView key={shown} id={shown} workspaceId={workspaceId} />
      </div>
    </aside>
  )
}
