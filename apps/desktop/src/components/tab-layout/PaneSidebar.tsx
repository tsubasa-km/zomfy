import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { togglePaneSidebar, usePaneSidebar } from '@/stores/pane-sidebar-store'
import { useSidebarWidth } from '@/stores/sidebar-width-store'
import { SidebarResizeHandle } from '@/components/SidebarResizeHandle'
import { WorkspacePanelView, useWorkspacePanels } from './workspace-panels'
import { cn } from '@/lib/utils'

// The right sidebar, one per workspace pane, so what it shows plainly belongs to that pane's
// project. Its panels are icons on the pane's header (PaneSidebarButtons), as the Claude app's
// session header opens its side panes.

function useShownPanel(workspaceId: string) {
  const { open, panel } = usePaneSidebar(workspaceId)
  const panels = useWorkspacePanels()
  const shown = panels.some((p) => p.id === panel) ? panel : panels[0]!.id
  return { open, panels, shown }
}

/** The pane header's panel icons: one opens its panel, and closes the sidebar when it is the one shown. */
export function PaneSidebarButtons({ workspaceId }: { workspaceId: string }) {
  const { open, panels, shown } = useShownPanel(workspaceId)
  return (
    <div className="flex shrink-0 items-center gap-0.5" data-pane-sidebar-buttons>
      {panels.map(({ id, label, icon: Icon }) => {
        const active = open && id === shown
        return (
          <Tooltip key={id}>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label={label}
                aria-pressed={active}
                data-pane-sidebar-panel={id}
                // The header drags the pane; a press on a button is a click.
                onPointerDown={(event) => event.stopPropagation()}
                onClick={() => togglePaneSidebar(workspaceId, id)}
                className={cn(
                  'flex size-7 shrink-0 items-center justify-center rounded-md transition-colors',
                  active ? 'bg-accent text-foreground' : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground'
                )}
              >
                <Icon className="size-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom">{label}</TooltipContent>
          </Tooltip>
        )
      })}
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
