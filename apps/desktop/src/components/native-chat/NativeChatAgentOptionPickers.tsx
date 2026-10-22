import { useRef, useState } from 'react'
import { Check, ChevronDown } from 'lucide-react'
import type { ChatAgentOption } from '@acp-harness/protocol'
import { Button } from '@/components/ui/button'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

// The composer pickers for an external ACP agent's own session options, laid out as Claude's are
// (NativeChatSessionOptionPicker, NativeChatPermissionModePicker): its mode on the left, its model
// with the model's effort pinned under it on the right, as Orca's ACP chats show them.

type Change = (optionId: string, value: string) => void

function choiceName(option: ChatAgentOption): string {
  return option.choices.find((c) => c.value === option.currentValue)?.name ?? option.currentValue
}

function modelChoiceFilter(value: string, search: string, keywords?: string[]): number {
  const haystack = [value, ...(keywords ?? [])].join(' ').toLowerCase()
  const terms = search.toLowerCase().split(/\s+/).filter(Boolean)
  return terms.every((term) => haystack.includes(term)) ? 1 : 0
}

/** The agent's mode (OpenCode's Build/Plan, an ACP session mode…), where Claude shows permissions. */
export function NativeChatAgentModePicker({ option, onChange }: { option: ChatAgentOption; onChange: Change }) {
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="xs"
              data-native-chat-agent-option={option.id}
              aria-label={`${option.name} ${choiceName(option)}`}
              className="max-w-40 min-w-0 shrink"
            >
              <span className="truncate">{choiceName(option)}</span>
              <ChevronDown className="size-3" />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="top" sideOffset={4}>
          {option.name}
        </TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="start" side="top" collisionPadding={8} className="w-72">
        <DropdownMenuRadioGroup aria-label={option.name} value={option.currentValue}>
          {option.choices.map((choice) => (
            <DropdownMenuRadioItem
              key={choice.value}
              value={choice.value}
              data-agent-choice={choice.value}
              onSelect={() => choice.value !== option.currentValue && onChange(option.id, choice.value)}
            >
              <div className="min-w-0 py-0.5">
                <div>{choice.name}</div>
                {choice.description ? <div className="text-xs font-normal text-muted-foreground">{choice.description}</div> : null}
              </div>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** A searchable list of the agent's models, with its effort levels (when it has them) under it. */
export function NativeChatAgentModelPicker({
  model,
  effort,
  onChange
}: {
  model: ChatAgentOption
  effort: ChatAgentOption | null
  onChange: Change
}) {
  const [open, setOpen] = useState(false)
  const search = useRef<HTMLInputElement>(null)
  const modelLabel = choiceName(model)
  const effortLabel = effort ? choiceName(effort) : null
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="xs"
          data-native-chat-model-picker
          aria-label={`${model.name} ${modelLabel}${effortLabel ? `, ${effort?.name} ${effortLabel}` : ''}`}
          className="max-w-64"
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') {
              event.preventDefault()
              setOpen(true)
            }
          }}
        >
          <span className="truncate text-chat-foreground">{modelLabel}</span>
          {effortLabel ? <span className="shrink-0">{effortLabel}</span> : null}
          <ChevronDown className="size-3" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        side="top"
        collisionPadding={8}
        className="flex w-96 max-w-(--radix-popover-content-available-width) flex-col p-0"
      >
        <Command surface="inline" density="menu" label="Search models…" filter={modelChoiceFilter} defaultValue={model.currentValue}>
          <CommandInput ref={search} placeholder="Search models…" />
          <CommandList
            onMouseDown={(event) => {
              event.preventDefault()
              search.current?.focus()
            }}
          >
            <CommandEmpty>No models match your search.</CommandEmpty>
            <CommandGroup>
              {model.choices.map((choice) => {
                const selected = choice.value === model.currentValue
                return (
                  <CommandItem
                    key={choice.value}
                    value={choice.value}
                    keywords={[choice.name, choice.description ?? '']}
                    selection="palette"
                    aria-current={selected || undefined}
                    data-model={choice.value}
                    onSelect={() => {
                      if (!selected) onChange(model.id, choice.value)
                    }}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate">{choice.name}</div>
                      {choice.description ? (
                        <div className="truncate text-xs font-normal text-muted-foreground">{choice.description}</div>
                      ) : null}
                    </div>
                    <span className="ml-auto flex size-3.5 shrink-0 items-center justify-center">
                      {selected ? <Check className="size-3.5 text-muted-foreground" /> : null}
                    </span>
                  </CommandItem>
                )
              })}
            </CommandGroup>
          </CommandList>
        </Command>
        {effort && effort.choices.length > 0 ? (
          <div className="border-t border-border p-1">
            <div className="flex min-h-7 flex-wrap items-center justify-between gap-x-3 gap-y-1 pl-2">
              <span id="native-chat-agent-effort-label" className="text-xs text-muted-foreground">
                {effort.name}
              </span>
              <ToggleGroup
                type="single"
                variant="segmented"
                size="xs"
                spacing={0.5}
                role="radiogroup"
                aria-labelledby="native-chat-agent-effort-label"
                value={effort.currentValue}
                onValueChange={(value) => {
                  setOpen(false)
                  if (value && value !== effort.currentValue) onChange(effort.id, value)
                }}
                className="-ml-2 flex-wrap"
              >
                {effort.choices.map((choice) => (
                  <ToggleGroupItem key={choice.value} value={choice.value} title={choice.description ?? choice.name} data-effort={choice.value}>
                    {choice.name}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            </div>
          </div>
        ) : null}
      </PopoverContent>
    </Popover>
  )
}

/** Splits an agent's options into the pickers' slots; anything else gets a mode-style picker of its own. */
export function agentOptionSlots(options: ChatAgentOption[]): {
  mode: ChatAgentOption | null
  model: ChatAgentOption | null
  effort: ChatAgentOption | null
  others: ChatAgentOption[]
} {
  const mode = options.find((o) => o.category === 'mode') ?? null
  const model = options.find((o) => o.category === 'model') ?? null
  const effort = model ? (options.find((o) => o.category === 'thought_level') ?? null) : null
  const others = options.filter((o) => o !== mode && o !== model && o !== effort && o.choices.length > 0)
  return { mode, model, effort, others }
}
