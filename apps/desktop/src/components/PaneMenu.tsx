import { AppWindow, MoreHorizontal, PanelRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { canPopOutWorkspace, popOutWorkspace } from '@/lib/workspace-window'
import { togglePaneSidebar, usePaneSidebar } from '@/stores/pane-sidebar-store'
import { t } from '@/i18n/i18n'

// The "…" at the right end of a tab strip: what is about the set of tabs itself.

/** Stops a press from starting the header's pane drag. */
const keepFromDrag = (event: React.PointerEvent) => event.stopPropagation()

/** "…": the pane's own actions. */
export function PaneMoreMenu({ workspaceId }: { workspaceId: string }) {
  const sidebarOpen = usePaneSidebar(workspaceId).open
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          size="icon-sm"
          variant="ghost"
          className="size-7 shrink-0 text-muted-foreground"
          aria-label={t('Pane actions')}
          data-pane-menu
          onPointerDown={keepFromDrag}
        >
          <MoreHorizontal className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        {canPopOutWorkspace() && (
          <DropdownMenuItem data-pane-action="pop-out" onSelect={() => void popOutWorkspace(workspaceId)}>
            <AppWindow className="size-3.5" />
            {t('Open in New Window')}
          </DropdownMenuItem>
        )}
        <DropdownMenuItem data-pane-action="sidebar" onSelect={() => togglePaneSidebar(workspaceId)}>
          <PanelRight className="size-3.5" />
          {sidebarOpen ? t('Close sidebar') : t('Open sidebar')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
