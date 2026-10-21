import { useState } from 'react'
import { Check, ChevronsUpDown, GitBranch } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'

// Orca's ComposerBaseRefPicker: a searchable branch list in a popover.

export interface BranchOption {
  value: string
  /** Shown after the name, e.g. "current" or "checked out". */
  hint?: string
  disabled?: boolean
}

export function BranchCombobox({
  id,
  value,
  placeholder,
  groups,
  onChange
}: {
  id?: string
  value: string
  placeholder: string
  groups: { heading: string; options: BranchOption[] }[]
  onChange: (value: string) => void
}) {
  const [open, setOpen] = useState(false)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-between font-normal"
          data-branch-combobox={id}
        >
          <span className="flex min-w-0 items-center gap-1.5">
            <GitBranch className="size-3.5 shrink-0 text-muted-foreground" />
            <span className={cn('truncate font-mono text-xs', !value && 'text-muted-foreground')}>{value || placeholder}</span>
          </span>
          <ChevronsUpDown className="size-3.5 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
        <Command>
          <CommandInput placeholder="Search branches..." className="h-8 text-xs" />
          <CommandList className="max-h-60">
            <CommandEmpty className="py-4 text-xs">No branches match</CommandEmpty>
            {groups
              .filter((g) => g.options.length > 0)
              .map((g) => (
                <CommandGroup key={g.heading} heading={g.heading}>
                  {g.options.map((o) => (
                    <CommandItem
                      key={o.value}
                      value={o.value}
                      disabled={o.disabled}
                      data-branch-option={o.value}
                      onSelect={() => {
                        onChange(o.value)
                        setOpen(false)
                      }}
                      className="text-xs"
                    >
                      <span className="min-w-0 flex-1 truncate font-mono">{o.value}</span>
                      {o.hint && <span className="shrink-0 text-[10px] text-muted-foreground">{o.hint}</span>}
                      {o.value === value && <Check className="size-3 shrink-0" />}
                    </CommandItem>
                  ))}
                </CommandGroup>
              ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
