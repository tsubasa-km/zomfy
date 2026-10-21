import { Code, Columns2, Eye, type LucideIcon } from 'lucide-react'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import type { MarkdownViewMode } from './editor-preferences'

// Orca's segmented Source / Rich / Preview control; the rich editor is not ported, so its slot is Split.
// The tooltip trigger overwrites data-state, so the pressed look keys off aria-checked as in Orca.
const VIEW_MODE_METADATA: Record<MarkdownViewMode, { label: string; icon: LucideIcon }> = {
  source: { label: 'Source', icon: Code },
  split: { label: 'Source and Preview', icon: Columns2 },
  preview: { label: 'Preview', icon: Eye }
}

export function EditorViewToggle({
  value,
  modes,
  onChange
}: {
  value: MarkdownViewMode
  modes: readonly MarkdownViewMode[]
  onChange: (value: MarkdownViewMode) => void
}): React.JSX.Element {
  return (
    <ToggleGroup
      type="single"
      size="sm"
      variant="outline"
      className="h-[23px] [&_[data-slot=toggle-group-item]]:h-[23px] [&_[data-slot=toggle-group-item]]:min-w-[24px] [&_[data-slot=toggle-group-item]]:px-2"
      value={value}
      onValueChange={(next) => {
        const mode = modes.find((m) => m === next)
        if (mode) onChange(mode)
      }}
    >
      {modes.map((mode) => {
        const { label, icon: Icon } = VIEW_MODE_METADATA[mode]
        return (
          <Tooltip key={mode}>
            <TooltipTrigger asChild>
              <ToggleGroupItem
                value={mode}
                aria-label={label}
                className="h-[23px] min-w-[24px] px-2 aria-[checked=true]:border-foreground/20 aria-[checked=true]:bg-foreground/10 aria-[checked=true]:text-foreground aria-[checked=true]:shadow-xs aria-[checked=true]:hover:bg-foreground/15 aria-[checked=true]:hover:text-foreground data-[state=on]:border-foreground/20 data-[state=on]:bg-foreground/10 data-[state=on]:text-foreground data-[state=on]:shadow-xs data-[state=on]:hover:bg-foreground/15 data-[state=on]:hover:text-foreground"
              >
                <Icon className="size-3.5" />
              </ToggleGroupItem>
            </TooltipTrigger>
            <TooltipContent side="top" sideOffset={4}>
              {label}
            </TooltipContent>
          </Tooltip>
        )
      })}
    </ToggleGroup>
  )
}
