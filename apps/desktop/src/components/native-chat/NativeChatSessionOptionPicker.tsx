import { useRef, useState } from 'react'
import { Check, ChevronDown } from 'lucide-react'
import type { ChatEffort, ChatModel, SessionOptions } from '@acp-harness/protocol'
import { Button } from '@/components/ui/button'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { t } from '@/i18n/i18n'

// Ported from Orca's NativeChatSessionOptionPickers, NativeChatModelCombobox and
// NativeChatSessionOptionRows: one pill naming the model and effort, opening a searchable model
// list with the model's effort levels pinned under it.

const EFFORT_LABEL: Record<ChatEffort, string> = {
  low: t('Low'),
  medium: t('Medium'),
  high: t('High'),
  xhigh: t('Extra high'),
  max: t('Max')
}
const EFFORT_SHORT: Record<ChatEffort, string> = { low: t('Low'), medium: t('Med'), high: t('High'), xhigh: t('XHigh'), max: t('Max') }
/** The CLI's own default, shown when the session names none. */
const DEFAULT_MODEL = 'default'

// Why not cmdk's scorer: it matches scattered letters and reorders the host's list.
function modelChoiceFilter(value: string, search: string, keywords?: string[]): number {
  const haystack = [value, ...(keywords ?? [])].join(' ').toLowerCase()
  const terms = search.toLowerCase().split(/\s+/).filter(Boolean)
  return terms.every((term) => haystack.includes(term)) ? 1 : 0
}

export function NativeChatSessionOptionPicker({
  options,
  models,
  loading,
  onChange
}: {
  options: SessionOptions
  models: ChatModel[]
  loading: boolean
  onChange: (patch: Partial<SessionOptions>) => void
}) {
  const [open, setOpen] = useState(false)
  const search = useRef<HTMLInputElement>(null)
  const currentValue = options.model ?? models.find((m) => m.value === DEFAULT_MODEL)?.value ?? DEFAULT_MODEL
  const current = models.find((m) => m.value === currentValue)
  const modelLabel = current?.displayName ?? options.model ?? t('Model')
  const efforts = current?.efforts ?? []
  const effort = options.effort && efforts.includes(options.effort) ? options.effort : null

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="xs"
          data-native-chat-model-picker
          aria-label={effort ? t('Model {model}, Effort {effort}', { model: modelLabel, effort: EFFORT_LABEL[effort] }) : t('Model {model}', { model: modelLabel })}
          className="max-w-64 min-w-0 shrink"
          onKeyDown={(event) => {
            // A popover trigger opens on Enter and Space only; a menu also takes ArrowDown.
            if (event.key === 'ArrowDown') {
              event.preventDefault()
              setOpen(true)
            }
          }}
        >
          <span className="truncate text-chat-foreground">{modelLabel}</span>
          {effort ? <span className="shrink-0">{EFFORT_SHORT[effort]}</span> : null}
          <ChevronDown className="size-3" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        side="top"
        collisionPadding={8}
        className="flex w-96 max-w-(--radix-popover-content-available-width) flex-col p-0 select-none"
      >
        <Command surface="inline" density="menu" label={t('Search models…')} filter={modelChoiceFilter} defaultValue={currentValue}>
          <CommandInput ref={search} placeholder={t('Search models…')} />
          <CommandList
            onMouseDown={(event) => {
              // A row is not a focus target; typing keeps filtering after a click.
              event.preventDefault()
              search.current?.focus()
            }}
          >
            <CommandEmpty>{loading ? t('Loading models…') : t('No models match your search.')}</CommandEmpty>
            <CommandGroup>
              {models.map((model) => {
                const selected = model.value === currentValue
                return (
                  <CommandItem
                    key={model.value}
                    value={model.value}
                    keywords={[model.displayName, model.description]}
                    selection="palette"
                    aria-current={selected || undefined}
                    data-model={model.value}
                    onSelect={() => {
                      if (!selected) onChange({ model: model.value === DEFAULT_MODEL ? null : model.value })
                    }}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate">{model.displayName}</div>
                      {model.description ? (
                        <div className="truncate text-xs font-normal text-muted-foreground">{model.description}</div>
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
        {efforts.length > 0 ? (
          <div className="border-t border-border p-1">
            <div className="flex min-h-7 flex-wrap items-center justify-between gap-x-3 gap-y-1 pl-2">
              <span id="native-chat-effort-label" className="text-xs text-muted-foreground">
                {t('Effort')}
              </span>
              <ToggleGroup
                type="single"
                variant="segmented"
                size="xs"
                spacing={0.5}
                role="radiogroup"
                aria-labelledby="native-chat-effort-label"
                value={effort ?? ''}
                onValueChange={(value) => {
                  // Effort is the last thing set before typing, so a level closes the picker.
                  setOpen(false)
                  const picked = efforts.find((e) => e === value)
                  onChange({ effort: picked ?? null })
                }}
                className="-ml-2 flex-wrap"
              >
                {efforts.map((level) => (
                  <ToggleGroupItem key={level} value={level} title={EFFORT_LABEL[level]} data-effort={level}>
                    {EFFORT_SHORT[level]}
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
