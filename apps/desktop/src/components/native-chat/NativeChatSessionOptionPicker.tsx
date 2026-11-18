import { useId, useRef } from 'react'
import { Check } from 'lucide-react'
import type { ChatEffort, ChatModel, SessionOptions } from '@acp-harness/protocol'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { t } from '@/i18n/i18n'

// Ported from Orca's NativeChatSessionOptionPickers, NativeChatModelCombobox and
// NativeChatSessionOptionRows: Claude's models as a searchable list with the model's effort levels
// pinned under it. The composer's agent-and-model menu (NativeChatAgentPicker) shows it.

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

function currentChoice(options: SessionOptions, models: ChatModel[]): { value: string; model: ChatModel | undefined; effort: ChatEffort | null } {
  const value = options.model ?? models.find((m) => m.value === DEFAULT_MODEL)?.value ?? DEFAULT_MODEL
  const model = models.find((m) => m.value === value)
  return { value, model, effort: options.effort && model?.efforts.includes(options.effort) ? options.effort : null }
}

/** How the menu's trigger names Claude's options: the model (null when nothing names one), its effort, and both as a screen reader hears them. */
export function sessionOptionLabels(options: SessionOptions, models: ChatModel[]): { model: string | null; effort: string | null; spoken: string } {
  const { model, effort } = currentChoice(options, models)
  const name = model?.displayName ?? options.model
  const spoken = name ?? t('Model')
  return {
    model: name,
    effort: effort ? EFFORT_SHORT[effort] : null,
    spoken: effort ? t('Model {model}, Effort {effort}', { model: spoken, effort: EFFORT_LABEL[effort] }) : t('Model {model}', { model: spoken })
  }
}

export function NativeChatSessionOptionChoices({
  options,
  models,
  loading,
  onChange,
  onDone
}: {
  options: SessionOptions
  models: ChatModel[]
  loading: boolean
  onChange: (patch: Partial<SessionOptions>) => void
  /** Closes the menu the list sits in. */
  onDone: () => void
}) {
  const search = useRef<HTMLInputElement>(null)
  const effortLabelId = useId()
  const { value: currentValue, model: current, effort } = currentChoice(options, models)
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
              value={effort ?? ''}
              onValueChange={(value) => {
                // Effort is the last thing set before typing, so a level closes the picker.
                onDone()
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
    </>
  )
}
