import { PanelRight, PanelRightClose } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { hidePaneSidebar, showPaneSidebar, togglePaneSidebar, usePaneSidebar } from '@/stores/pane-sidebar-store'
import { useSidebarWidth } from '@/stores/sidebar-width-store'
import { SidebarResizeHandle } from '@/components/SidebarResizeHandle'
import { WorkspacePanelView, useWorkspacePanels } from './workspace-panels'
import { cn } from '@/lib/utils'
import { t } from '@/i18n/i18n'

// The right sidebar, one per workspace pane, so what it shows plainly belongs to that pane's
// project: it stands beside the pane's header and tabs, full height, its panels behind a row of
// icons level with the project's name.

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
          // A pane header drags the pane; a press on a button is a click.
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

/** For a header with no other way to open the sidebar (a workspace's own window). */
export function PaneSidebarToggle({ workspaceId }: { workspaceId: string }) {
  const { open } = usePaneSidebar(workspaceId)
  if (open) return null
  return (
    <PanelButton label={t('Toggle sidebar for this pane')} onClick={() => togglePaneSidebar(workspaceId)} data-pane-sidebar-toggle>
      <PanelRight className="size-3.5" />
    </PanelButton>
  )
}

/**
 * `focused` draws the pane's focus line along the top, as the pane's header does; left out (a
 * workspace's own window), there is none.
 */
export function PaneSidebar({ workspaceId, focused }: { workspaceId: string; focused?: boolean }) {
  const { open, panel } = usePaneSidebar(workspaceId)
  const panels = useWorkspacePanels()
  const shown = panels.some((p) => p.id === panel) ? panel : panels[0]!.id
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
      {/* Level with the pane's header, so the project's name and its panels read as one row. */}
      <div
        className={cn(
          'flex h-7 shrink-0 items-center gap-0.5 overflow-hidden border-b border-b-border px-1',
          focused !== undefined && 'border-t-2',
          focused ? 'border-t-highlight' : 'border-t-transparent'
        )}
      >
        {panels.map(({ id, label, icon: Icon }) => (
          <PanelButton key={id} label={label} active={id === shown} onClick={() => showPaneSidebar(workspaceId, id)} data-pane-sidebar-panel={id}>
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
