import { useId, useRef } from 'react'
import { Check } from 'lucide-react'
import type { ChatModel, SessionOptions } from '@zomfy/protocol'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { t } from '@/i18n/i18n'
import { currentChoice, DEFAULT_EFFORT, DEFAULT_MODEL, EFFORT_LABEL, EFFORT_SHORT, type DefaultEffort } from './session-option-labels'

// Ported from Orca's NativeChatSessionOptionPickers, NativeChatModelCombobox and
// NativeChatSessionOptionRows: Claude's models as a searchable list with the model's effort levels
// pinned under it. The composer's agent-and-model menu (NativeChatAgentPicker) shows it.

export { sessionOptionLabels, type DefaultEffort } from './session-option-labels'

// Why not cmdk's scorer: it matches scattered letters and reorders the host's list.
function modelChoiceFilter(value: string, search: string, keywords?: string[]): number {
  const haystack = [value, ...(keywords ?? [])].join(' ').toLowerCase()
  const terms = search.toLowerCase().split(/\s+/).filter(Boolean)
  return terms.every((term) => haystack.includes(term)) ? 1 : 0
}

export function NativeChatSessionOptionChoices({
  options,
  models,
  loading,
  defaultEffort,
  onChange,
  onDone
}: {
  options: SessionOptions
  models: ChatModel[]
  loading: boolean
  /** The level Claude's default resolved to on the chat's last turn, named on the Default choice. */
  defaultEffort?: DefaultEffort
  onChange: (patch: Partial<SessionOptions>) => void
  /** Closes the menu the list sits in. */
  onDone: () => void
}) {
  const search = useRef<HTMLInputElement>(null)
  const effortLabelId = useId()
  const { value: currentValue, model: current, effort, resolved } = currentChoice(options, models, defaultEffort)
  const efforts = current?.efforts ?? []

  return (
    <>
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
            <span id={effortLabelId} className="text-xs text-muted-foreground">
              {t('Effort')}
            </span>
            <ToggleGroup
              type="single"
              variant="segmented"
              size="xs"
              spacing={0.5}
              role="radiogroup"
              aria-labelledby={effortLabelId}
              value={effort ?? DEFAULT_EFFORT}
              onValueChange={(value) => {
                // Effort is the last thing set before typing, so a level closes the picker.
                onDone()
                // Pressing the selected choice again leaves it as it is.
                if (!value) return
                const picked = efforts.find((e) => e === value) ?? null
                if (picked !== effort) onChange({ effort: picked })
              }}
              className="-ml-2 flex-wrap"
            >
              <ToggleGroupItem
                value={DEFAULT_EFFORT}
                title={resolved ? t("Claude's default (now {effort})", { effort: EFFORT_LABEL[resolved] }) : t("Claude's default")}
                data-effort={DEFAULT_EFFORT}
              >
                {t('Default')}
              </ToggleGroupItem>
              {efforts.map((level) => (
                <ToggleGroupItem key={level} value={level} title={EFFORT_LABEL[level]} data-effort={level}>
                  {EFFORT_SHORT[level]}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </div>
        </div>
      ) : null}
    </>
  )
}
