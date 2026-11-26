import { PanelRight } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { setPaneSidebarWidth, showPaneSidebar, togglePaneSidebar, usePaneSidebar } from '@/stores/pane-sidebar-store'
import { clampSidebarWidth, useSidebarWidth } from '@/stores/sidebar-width-store'
import { useShortcutLabel } from '@/keybindings/keybinding-registry'
import { SidebarResizeHandle } from '@/components/SidebarResizeHandle'
import { WorkspacePanelView, useWorkspacePanels } from './workspace-panels'
import { cn } from '@/lib/utils'
import { t } from '@/i18n/i18n'

// The right sidebar, one per split pane (docs/specs/pane-sidebars.md), so what it shows plainly
// belongs to the project of that pane's tab. Its panels are a row of icons along its own top, as an
// editor's side bar has; what opens and closes it is at the end of the pane's tab strip. `paneKey`
// names the pane's entry in stores/pane-sidebar-store.

function useShownPanel(paneKey: string) {
  const { open, panel } = usePaneSidebar(paneKey)
  const panels = useWorkspacePanels()
  const shown = panels.some((p) => p.id === panel) ? panel : panels[0]!.id
  return { open, panels, shown }
}

/** Opens and closes the pane's sidebar, at the end of its tab strip. */
export function PaneSidebarToggle({ paneKey }: { paneKey: string }) {
  const open = usePaneSidebar(paneKey).open
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
          onClick={() => togglePaneSidebar(paneKey)}
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
function PanelButtons({ paneKey }: { paneKey: string }) {
  const { panels, shown } = useShownPanel(paneKey)
  return (
    // One row whatever the width: the icons narrow a little rather than wrap one onto a row of its own.
    <div role="tablist" className="flex shrink-0 items-center gap-0.5 overflow-hidden border-b border-sidebar-border px-1.5 py-1" data-pane-sidebar-buttons>
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
                onClick={() => showPaneSidebar(paneKey, id)}
                className={cn(
                  'flex h-7 w-7 min-w-5 shrink items-center justify-center rounded-md transition-colors',
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

const WIDTH_KEY = 'right'

/** The sidebar of the pane `paneKey`, on `workspaceId`'s files, changes and checks. Hidden while closed. */
export function PaneSidebar({ paneKey, workspaceId }: { paneKey: string; workspaceId: string }) {
  const { open, shown } = useShownPanel(paneKey)
  // One width for every panel, so switching panels never moves the edge; each pane its own, from
  // the width the single sidebar had until it is dragged.
  const shared = useSidebarWidth(WIDTH_KEY)
  const own = usePaneSidebar(paneKey).width
  const width = own === undefined ? shared : clampSidebarWidth(WIDTH_KEY, own)
  if (!open) return null
  return (
    <aside
      data-pane-sidebar={workspaceId}
      data-pane-sidebar-key={paneKey}
      style={{ width }}
      className={cn(
        // Never more than half a narrow pane, so its tabs stay usable.
        'relative flex min-h-0 max-w-[50%] shrink-0 flex-col overflow-hidden border-l border-sidebar-border bg-sidebar text-sidebar-foreground'
      )}
    >
      <SidebarResizeHandle widthKey={WIDTH_KEY} edge="left" onWidth={(next) => setPaneSidebarWidth(paneKey, next)} />
      <PanelButtons paneKey={paneKey} />
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <WorkspacePanelView key={shown} id={shown} workspaceId={workspaceId} />
      </div>
    </aside>
  )
}
