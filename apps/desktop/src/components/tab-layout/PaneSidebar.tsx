import { PanelRight } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { showPaneSidebar, togglePaneSidebar, usePaneSidebar } from '@/stores/pane-sidebar-store'
import { useSidebarWidth } from '@/stores/sidebar-width-store'
import { useShortcutLabel } from '@/keybindings/keybinding-registry'
import { SidebarResizeHandle } from '@/components/SidebarResizeHandle'
import { WorkspacePanelView, useWorkspacePanels } from './workspace-panels'
import { cn } from '@/lib/utils'
import { t } from '@/i18n/i18n'

// The right sidebar, one per workspace pane, so what it shows plainly belongs to that pane's
// project. Its panels are a row of icons along its own top, as an editor's side bar has; what
// opens and closes it is in the window's title bar, or the tab strip's end where there is none.

function useShownPanel(workspaceId: string) {
  const { open, panel } = usePaneSidebar(workspaceId)
  const panels = useWorkspacePanels()
  const shown = panels.some((p) => p.id === panel) ? panel : panels[0]!.id
  return { open, panels, shown }
}

/** Opens and closes the pane's sidebar, for where the window's title bar does not. */
export function PaneSidebarToggle({ workspaceId }: { workspaceId: string }) {
  const open = usePaneSidebar(workspaceId).open
  const shortcut = useShortcutLabel('sidebar.right.toggle')
  const label = t('Toggle right sidebar')
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          aria-pressed={open}
          data-pane-sidebar-toggle
          // The header drags the pane; a press on a button is a click.
          onPointerDown={(event) => event.stopPropagation()}
          onClick={() => togglePaneSidebar(workspaceId)}
          className={cn(
            'flex size-7 shrink-0 items-center justify-center rounded-md transition-colors',
            open ? 'text-foreground hover:bg-accent/60' : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground'
          )}
        >
          <PanelRight className="size-4" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{shortcut ? `${label} (${shortcut})` : label}</TooltipContent>
    </Tooltip>
  )
}

/** The sidebar's panels, one icon each. */
function PanelButtons({ workspaceId }: { workspaceId: string }) {
  const { panels, shown } = useShownPanel(workspaceId)
  return (
    <div role="tablist" className="flex shrink-0 flex-wrap items-center gap-0.5 border-b border-sidebar-border px-1.5 py-1" data-pane-sidebar-buttons>
      {panels.map(({ id, label, icon: Icon }) => {
        const active = id === shown
        return (
          <Tooltip key={id}>
            <TooltipTrigger asChild>
              <button
                type="button"
                role="tab"
                aria-label={label}
                aria-selected={active}
                data-pane-sidebar-panel={id}
                onClick={() => showPaneSidebar(workspaceId, id)}
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
  // One width for every panel, so switching panels never moves the edge.
  const widthKey = 'right'
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
      <PanelButtons workspaceId={workspaceId} />
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <WorkspacePanelView key={shown} id={shown} workspaceId={workspaceId} />
      </div>
    </aside>
  )
}
