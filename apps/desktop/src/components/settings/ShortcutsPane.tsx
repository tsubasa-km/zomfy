import { useEffect, useMemo, useRef, useState } from 'react'
import { Ban, Plus, RotateCcw, Search, X } from 'lucide-react'
import { setSetting, useSetting } from '@/stores/settings-store'
import { chordFromEvent, formatChord, keyTokenFromCode, parseChord } from '@/keybindings/keybinding-chords'
import { defaultBindingsFor, keybindingDefinitions, type KeybindingDefinition } from '@/keybindings/keybinding-definitions'
import { effectiveBindings, useCommandRegistryVersion } from '@/keybindings/keybinding-registry'
import { ShortcutKeyCombo } from '@/components/ShortcutKeyCombo'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { matchesSettingsSearch } from './settings-navigation'
import { SettingsSubsectionHeader } from './settings-form-controls'
import { t } from '@/i18n/i18n'

// Orca's ShortcutsPane (ShortcutFilterRail, ShortcutCommandBlock, ShortcutRecorderButton): every
// command with its chords, recorded by pressing them, plus reset, disable and conflict warnings.

type Filter = 'all' | 'modified' | 'unassigned' | 'conflicts'
type Recording = { id: string; index: number } | null

/** Identity of a chord for conflict checks, so `Mod+P` and `Ctrl+P` collide on Windows. */
function chordIdentity(binding: string): string {
  const c = parseChord(binding)
  return c ? `${c.meta}|${c.ctrl}|${c.alt}|${c.shift}|${c.key}` : binding
}

function sameBindings(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value, i) => value === b[i])
}

function digitRange(keys: string[]): string[] {
  const last = keys.at(-1)
  return last && /^[1-9]$/.test(last) ? [...keys.slice(0, -1), `${last}–9`] : keys
}

function RecorderButton({
  definition,
  binding,
  recording,
  onStart,
  onCapture,
  onCancel
}: {
  definition: KeybindingDefinition
  binding: string | null
  recording: boolean
  onStart: () => void
  onCapture: (event: React.KeyboardEvent) => void
  onCancel: () => void
}) {
  const ref = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (recording) ref.current?.focus()
  }, [recording])
  const keys = binding ? formatChord(binding) : []
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          ref={ref}
          type="button"
          aria-label={
            recording
              ? t('Press shortcut keys for {command}. Escape cancels.', { command: t(definition.title) })
              : t('Change shortcut for {command}', { command: t(definition.title) })
          }
          aria-pressed={recording}
          data-shortcut-recorder=""
          data-shortcut-recorder-active={recording ? '' : undefined}
          onClick={() => {
            if (!recording) onStart()
          }}
          onBlur={() => {
            if (recording) onCancel()
          }}
          onKeyDown={(event) => {
            if (!recording) {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                onStart()
              }
              return
            }
            event.preventDefault()
            event.stopPropagation()
            if (event.key === 'Escape' && !event.ctrlKey && !event.metaKey && !event.altKey) {
              onCancel()
              return
            }
            if (keyTokenFromCode(event.code) === null) return
            onCapture(event)
          }}
          className={cn(
            'flex min-h-7 max-w-[14rem] min-w-[5.5rem] items-center justify-end gap-1.5 overflow-hidden rounded-md border px-2 py-1 text-xs outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50',
            recording ? 'border-ring bg-accent text-accent-foreground ring-[3px] ring-ring/30' : 'border-transparent hover:border-border/70 hover:bg-background'
          )}
        >
          {recording || !binding ? (
            <span className="px-1 text-muted-foreground">{t('Press keys…')}</span>
          ) : (
            <ShortcutKeyCombo keys={definition.digitIndex ? digitRange(keys) : keys} />
          )}
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" sideOffset={4}>
        {recording ? t('Listening for shortcut') : binding ? t('Change shortcut') : t('Add shortcut')}
      </TooltipContent>
    </Tooltip>
  )
}

function IconAction({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button type="button" variant="ghost" size="icon-xs" className="text-muted-foreground hover:text-foreground" aria-label={label} onClick={onClick}>
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="top" sideOffset={4}>
        {label}
      </TooltipContent>
    </Tooltip>
  )
}

export function ShortcutsPane({ searchQuery }: { searchQuery: string }) {
  useCommandRegistryVersion()
  const overrides = useSetting('keybindings')
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [recording, setRecording] = useState<Recording>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const definitions = keybindingDefinitions()

  const owners = useMemo(() => {
    const map = new Map<string, string[]>()
    for (const definition of definitions) {
      for (const binding of effectiveBindings(definition, overrides)) {
        const identity = chordIdentity(binding)
        map.set(identity, [...(map.get(identity) ?? []), definition.id])
      }
    }
    return map
  }, [definitions, overrides])

  const titleOf = (id: string) => t(definitions.find((d) => d.id === id)?.title ?? id)

  const rows = definitions.map((definition) => {
    const effective = effectiveBindings(definition, overrides)
    const modified = definition.id in overrides && !sameBindings(overrides[definition.id] ?? [], defaultBindingsFor(definition))
    // Commands in different scopes (Settings' Ctrl+F) may share a chord; only flag same-group clashes.
    const conflicts = [
      ...new Set(
        effective.flatMap((b) =>
          (owners.get(chordIdentity(b)) ?? []).filter(
            (other) => other !== definition.id && definitions.find((d) => d.id === other)?.group === definition.group
          )
        )
      )
    ]
    return { definition, effective, modified, conflicts }
  })

  const combinedQuery = [searchQuery, query].filter((q) => q.trim()).join(' ')
  const visible = rows.filter((row) => {
    if (filter === 'modified' && !row.modified) return false
    if (filter === 'unassigned' && row.effective.length > 0) return false
    if (filter === 'conflicts' && row.conflicts.length === 0) return false
    return matchesSettingsSearch(combinedQuery, {
      title: `${row.definition.title} ${t(row.definition.title)}`,
      description: `${row.definition.group} ${t(row.definition.group)}`,
      keywords: [...(row.definition.keywords ?? []), ...row.effective.map((b) => formatChord(b).join(' '))]
    })
  })
  const groups = [...new Set(visible.map((row) => row.definition.group))]
  const counts: Record<Filter, number> = {
    all: rows.length,
    modified: rows.filter((r) => r.modified).length,
    unassigned: rows.filter((r) => r.effective.length === 0).length,
    conflicts: rows.filter((r) => r.conflicts.length > 0).length
  }

  const save = (id: string, bindings: string[]) => {
    const definition = definitions.find((d) => d.id === id)
    const next = { ...overrides }
    if (definition && sameBindings(bindings, defaultBindingsFor(definition))) delete next[id]
    else next[id] = bindings
    setSetting('keybindings', next)
  }

  const capture = (row: (typeof rows)[number], index: number, event: React.KeyboardEvent) => {
    const chord = chordFromEvent(event.nativeEvent)
    if (!chord) {
      setErrors((e) => ({ ...e, [row.definition.id]: t('Shortcuts need Ctrl, Alt or ⌘ (function keys may stand alone).') }))
      return
    }
    const bindings = [...row.effective]
    if (index >= bindings.length) bindings.push(chord)
    else bindings[index] = chord
    save(row.definition.id, [...new Set(bindings)])
    setErrors(({ [row.definition.id]: _cleared, ...rest }) => rest)
    setRecording(null)
  }

  const FILTERS: { id: Filter; label: string }[] = [
    { id: 'all', label: t('All') },
    { id: 'modified', label: t('Modified') },
    { id: 'unassigned', label: t('Unassigned') },
    { id: 'conflicts', label: t('Conflicts') }
  ]

  return (
    <div className="space-y-6">
      <SettingsSubsectionHeader
        title={t('Keyboard Shortcuts')}
        description={t('Click a shortcut and press the keys you want. Changes apply immediately in this window.')}
        action={
          Object.keys(overrides).length > 0 ? (
            <Button variant="outline" size="sm" onClick={() => setSetting('keybindings', {})}>
              <RotateCcw className="size-3.5" />
              {t('Reset all')}
            </Button>
          ) : null
        }
      />
      <div className="grid gap-6 xl:grid-cols-[14rem_minmax(0,1fr)]">
        <div className="space-y-3">
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('Filter shortcuts')}
              aria-label={t('Filter shortcuts')}
              className="h-8 pr-7 pl-8 text-[13px]"
            />
            {query ? (
              <button
                type="button"
                aria-label={t('Clear filter')}
                className="absolute top-1/2 right-2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                onClick={() => setQuery('')}
              >
                <X className="size-3.5" />
              </button>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-1 xl:flex-col">
            {FILTERS.map((f) => (
              <button
                key={f.id}
                type="button"
                aria-pressed={filter === f.id}
                onClick={() => setFilter(f.id)}
                className={cn(
                  'flex items-center justify-between gap-3 rounded-md px-2.5 py-1.5 text-left text-[13px] transition-colors',
                  filter === f.id ? 'bg-accent font-medium text-accent-foreground' : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'
                )}
              >
                {f.label}
                <span className="text-xs text-muted-foreground tabular-nums">{counts[f.id]}</span>
              </button>
            ))}
          </div>
          <p className="px-1 text-xs text-muted-foreground">
            {t('{n} of {total} shortcuts', { n: visible.length, total: rows.length })}
          </p>
        </div>

        {visible.length === 0 ? (
          <div className="rounded-md border border-dashed border-border/70 px-4 py-8 text-center text-sm text-muted-foreground">
            {t('No shortcuts match those filters.')}
          </div>
        ) : (
          <div className="flex min-w-0 flex-col gap-8">
            {groups.map((group) => (
              <div key={group} className="space-y-3">
                <h3 className="border-b border-border/50 pb-2 text-sm font-medium text-muted-foreground">{t(group)}</h3>
                <div className="flex flex-col gap-1">
                  {visible
                    .filter((row) => row.definition.group === group)
                    .map((row) => {
                      const { definition, effective, modified, conflicts } = row
                      const disabled = modified && effective.length === 0
                      const recIndex = recording?.id === definition.id ? recording.index : null
                      const isRecording = recIndex !== null
                      const appendSlot = recIndex !== null && recIndex >= effective.length
                      const error = errors[definition.id]
                      const helper = error
                        ? error
                        : isRecording
                          ? t('Press a shortcut. Esc cancels.')
                          : conflicts.length > 0
                            ? t('Also used by {commands}.', { commands: conflicts.map(titleOf).join(', ') })
                            : ''
                      return (
                        <div key={definition.id} className="group/shortcut flex flex-col" data-shortcut-row={definition.id}>
                          <div className="flex min-h-9 items-center gap-3 rounded-md px-2 py-1 transition-colors focus-within:bg-accent/40 hover:bg-accent/40">
                            <div className="flex min-w-0 flex-1 items-center gap-2">
                              <span className={cn('truncate text-sm', disabled ? 'text-muted-foreground' : 'text-foreground')}>
                                {t(definition.title)}
                              </span>
                              {modified ? (
                                <Badge variant="outline" className="shrink-0 text-[11px]">
                                  {t('Modified')}
                                </Badge>
                              ) : null}
                              {disabled ? (
                                <Badge variant="outline" className="shrink-0 text-[11px] text-muted-foreground">
                                  {t('Disabled')}
                                </Badge>
                              ) : null}
                            </div>
                            <div className="flex shrink-0 items-center gap-1">
                              <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-focus-within/shortcut:opacity-100 group-hover/shortcut:opacity-100">
                                {effective.length > 0 && !appendSlot ? (
                                  <IconAction label={t('Add another shortcut')} onClick={() => setRecording({ id: definition.id, index: effective.length })}>
                                    <Plus className="size-3" />
                                  </IconAction>
                                ) : null}
                                {modified ? (
                                  <IconAction label={t('Reset to default')} onClick={() => save(definition.id, [...defaultBindingsFor(definition)])}>
                                    <RotateCcw className="size-3" />
                                  </IconAction>
                                ) : null}
                                {effective.length > 0 ? (
                                  <IconAction label={t('Remove all shortcuts')} onClick={() => save(definition.id, [])}>
                                    <Ban className="size-3" />
                                  </IconAction>
                                ) : null}
                              </div>
                              <div className="flex flex-col items-end gap-1">
                                {effective.map((binding, index) => (
                                  <div key={`${binding}-${index}`} className="flex items-center gap-0.5">
                                    <RecorderButton
                                      definition={definition}
                                      binding={binding}
                                      recording={recIndex === index}
                                      onStart={() => setRecording({ id: definition.id, index })}
                                      onCapture={(event) => capture(row, index, event)}
                                      onCancel={() => setRecording(null)}
                                    />
                                    {effective.length > 1 ? (
                                      <IconAction label={t('Remove this shortcut')} onClick={() => save(definition.id, effective.filter((_, i) => i !== index))}>
                                        <X className="size-3" />
                                      </IconAction>
                                    ) : null}
                                  </div>
                                ))}
                                {effective.length === 0 || appendSlot ? (
                                  <RecorderButton
                                    definition={definition}
                                    binding={null}
                                    recording={appendSlot}
                                    onStart={() => setRecording({ id: definition.id, index: effective.length })}
                                    onCapture={(event) => capture(row, effective.length, event)}
                                    onCancel={() => setRecording(null)}
                                  />
                                ) : null}
                              </div>
                            </div>
                          </div>
                          {helper ? (
                            <p className={cn('px-2 pb-1 text-xs', error || (!isRecording && conflicts.length > 0) ? 'text-destructive' : 'text-muted-foreground')}>
                              {helper}
                            </p>
                          ) : null}
                        </div>
                      )
                    })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
