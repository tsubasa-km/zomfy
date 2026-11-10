import { PanelRight } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { showPaneSidebar, togglePaneSidebar, usePaneSidebar } from '@/stores/pane-sidebar-store'
import { useSidebarWidth } from '@/stores/sidebar-width-store'
import { SidebarResizeHandle } from '@/components/SidebarResizeHandle'
import { WorkspacePanelView, useWorkspacePanels } from './workspace-panels'
import { cn } from '@/lib/utils'
import { t } from '@/i18n/i18n'

// The right sidebar, one per workspace pane, so what it shows plainly belongs to that pane's
// project. Its panel icons sit in the pane's header, beside the project's name (PaneSidebarButtons).

function PanelButton({
  label,
  active,
  onClick,
  children,
  ...rest
}: { label: string; active?: boolean; onClick: () => void; children: React.ReactNode } & React.HTMLAttributes<HTMLButtonElement>) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          aria-pressed={active}
          onClick={onClick}
          // The header drags the pane; a press on a button is a click.
          onPointerDown={(event) => event.stopPropagation()}
          className={cn(
            'flex size-6 shrink-0 items-center justify-center rounded-md transition-colors',
            active ? 'bg-accent text-foreground' : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground'
          )}
          {...rest}
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  )
}

function useShownPanel(workspaceId: string) {
  const { open, panel } = usePaneSidebar(workspaceId)
  const panels = useWorkspacePanels()
  const shown = panels.some((p) => p.id === panel) ? panel : panels[0]!.id
  return { open, panels, shown }
}

/** For the pane's header: the sidebar's panels while it is open, and the button that opens and closes it. */
export function PaneSidebarButtons({ workspaceId }: { workspaceId: string }) {
  const { open, panels, shown } = useShownPanel(workspaceId)
  return (
    <div className="flex min-w-0 items-center gap-0.5 overflow-hidden" data-pane-sidebar-buttons>
      {open &&
        panels.map(({ id, label, icon: Icon }) => (
          <PanelButton key={id} label={label} active={id === shown} onClick={() => showPaneSidebar(workspaceId, id)} data-pane-sidebar-panel={id}>
            <Icon className="size-3.5" />
          </PanelButton>
        ))}
      <PanelButton
        label={open ? t('Close sidebar') : t('Toggle sidebar for this pane')}
        onClick={() => togglePaneSidebar(workspaceId)}
        data-pane-sidebar-toggle
      >
        <PanelRight className={cn('size-3.5', open && 'text-foreground')} />
      </PanelButton>
    </div>
  )
}

export function PaneSidebar({ workspaceId }: { workspaceId: string }) {
  const { open, shown } = useShownPanel(workspaceId)
  // A chat needs more room than a file tree, so it keeps a width of its own.
  const widthKey = shown === 'panel:side-chat' ? 'right:side-chat' : 'right'
  const width = useSidebarWidth(widthKey)
  if (!open) return null
  return (
    <aside
      data-pane-sidebar={workspaceId}
      style={{ width }}
      className={cn(
        // Never more than half a narrow pane, so its tabs stay usable.
        'relative flex min-h-0 max-w-[50%] shrink-0 flex-col overflow-hidden border-l border-sidebar-border bg-sidebar text-sidebar-foreground'
      )}
    >
      <SidebarResizeHandle widthKey={widthKey} edge="left" />
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <WorkspacePanelView key={shown} id={shown} workspaceId={workspaceId} />
      </div>
    </aside>
  )
}
