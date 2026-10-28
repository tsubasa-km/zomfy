import { SlidersHorizontal } from 'lucide-react'
import { setSidebarView, useStore, type SidebarView } from '@/session-store'
import {
  CARD_PROPERTIES,
  setCardLayout,
  toggleCardProperty,
  useSidebarStore,
  type CardLayout
} from '@/stores/sidebar-store'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

// Orca's SidebarWorkspaceOptionsMenu: group by, sort by (with Manual), card layout and properties.

const SORT_OPTIONS: { id: SidebarView['sortBy']; label: string; description?: string }[] = [
  { id: 'created', label: 'Created' },
  { id: 'recent', label: 'Recent activity' },
  { id: 'name', label: 'Name' },
  { id: 'manual', label: 'Manual', description: 'Drag workspaces to arrange them within each group.' }
]

const LAYOUTS: { id: CardLayout; label: string }[] = [
  { id: 'detailed', label: 'Detailed' },
  { id: 'compact', label: 'Compact' }
]

function SubTriggerValue({ label, value }: { label: string; value: string }) {
  return (
    <span className="flex flex-1 items-center justify-between">
      <span>{label}</span>
      <span className="text-[11px] font-medium text-muted-foreground">{value}</span>
    </span>
  )
}

export function WorkspaceOptionsMenu() {
  const view = useStore((s) => s.sidebarView)
  const layout = useSidebarStore((s) => s.cardLayout)
  const properties = useSidebarStore((s) => s.cardProperties)
  return (
    <DropdownMenu modal={false}>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button size="icon-xs" variant="ghost" aria-label="Workspace options" className="text-muted-foreground">
              <SlidersHorizontal className="size-3.5" strokeWidth={2.25} />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom" sideOffset={6}>
          Workspace options
        </TooltipContent>
      </Tooltip>
      <DropdownMenuContent side="right" align="start" sideOffset={8} className="w-60 pb-2">
        <DropdownMenuLabel className="pb-0 text-sm text-foreground">Workspace options</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-xs text-muted-foreground">Show</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={view.rows ?? 'chats'}
          onValueChange={(v) => setSidebarView({ rows: v === 'workspaces' ? 'workspaces' : 'chats' })}
        >
          <DropdownMenuRadioItem value="chats" data-rows="chats" onSelect={(e) => e.preventDefault()}>
            Chats
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="workspaces" data-rows="workspaces" onSelect={(e) => e.preventDefault()}>
            Workspaces
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
        <DropdownMenuCheckboxItem
          data-option="show-archived"
          checked={view.showArchived === true}
          onCheckedChange={(checked) => setSidebarView({ showArchived: checked === true })}
          onSelect={(e) => e.preventDefault()}
        >
          Archived chats
        </DropdownMenuCheckboxItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-xs text-muted-foreground">Group by</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={view.groupBy}
          onValueChange={(v) => setSidebarView({ groupBy: v === 'status' ? 'status' : 'project' })}
        >
          <DropdownMenuRadioItem value="project" onSelect={(e) => e.preventDefault()}>
            Project
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="status" onSelect={(e) => e.preventDefault()}>
            Status
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuSub>
          <DropdownMenuSubTrigger data-option="sort">
            <SubTriggerValue label="Sort by" value={SORT_OPTIONS.find((o) => o.id === view.sortBy)?.label ?? ''} />
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="w-48">
            <DropdownMenuRadioGroup
              value={view.sortBy}
              onValueChange={(v) => {
                const next = SORT_OPTIONS.find((o) => o.id === v)
                if (next) setSidebarView({ sortBy: next.id })
              }}
            >
              {SORT_OPTIONS.map((o) => (
                <DropdownMenuRadioItem key={o.id} value={o.id} data-sort={o.id} title={o.description} onSelect={(e) => e.preventDefault()}>
                  {o.label}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger data-option="layout">
            <SubTriggerValue label="Card layout" value={LAYOUTS.find((l) => l.id === layout)?.label ?? ''} />
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="w-44">
            <DropdownMenuRadioGroup value={layout} onValueChange={(v) => setCardLayout(v === 'compact' ? 'compact' : 'detailed')}>
              {LAYOUTS.map((l) => (
                <DropdownMenuRadioItem key={l.id} value={l.id} data-layout={l.id} onSelect={(e) => e.preventDefault()}>
                  {l.label}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger data-option="properties">Show properties</DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="w-48">
            {CARD_PROPERTIES.map((p) => (
              <DropdownMenuCheckboxItem
                key={p.id}
                data-property={p.id}
                checked={properties.includes(p.id)}
                onCheckedChange={() => toggleCardProperty(p.id)}
                onSelect={(e) => e.preventDefault()}
              >
                {p.label}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
