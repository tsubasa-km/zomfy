import { useEffect, useRef } from 'react'
import { FileText, Package } from 'lucide-react'
import type { ChatCommand } from '@acp-harness/protocol'
import { cn } from '@/lib/utils'
import { t } from '@/i18n/i18n'

// Ported from Orca's NativeChatAutocompleteMenus: the `/` command menu and the `@` file menu
// open above the composer; the textarea keeps focus and drives the active row.

export type ComposerAutocomplete =
  | { mode: 'slash'; query: string; start: number; end: number; items: ChatCommand[]; status: 'loading' | 'ready' | 'error' }
  | { mode: 'mention'; query: string; start: number; end: number; items: string[]; status: 'loading' | 'ready' | 'error' }

const MAX_FILE_MATCHES = 50

/** What the caret sits in: a leading `/command`, an `@path`, or neither. */
export function composerAutocompleteQuery(
  text: string,
  caret: number
): { mode: 'slash' | 'mention'; query: string; start: number; end: number } | null {
  const before = text.slice(0, caret)
  const slash = /^\/(\S*)$/.exec(before)
  if (slash) return { mode: 'slash', query: slash[1] ?? '', start: 0, end: caret }
  const mention = /(^|\s)@([^\s@]*)$/.exec(before)
  if (mention) {
    const query = mention[2] ?? ''
    return { mode: 'mention', query, start: caret - query.length - 1, end: caret }
  }
  return null
}

export function matchCommands(commands: ChatCommand[], query: string): ChatCommand[] {
  const q = query.toLowerCase()
  const starts = commands.filter((c) => c.name.toLowerCase().startsWith(q))
  const contains = commands.filter((c) => !c.name.toLowerCase().startsWith(q) && c.name.toLowerCase().includes(q))
  // Claude's own commands first, then the user's, project's and plugins'.
  return [...starts, ...contains].sort((a, b) => Number(Boolean(b.builtin)) - Number(Boolean(a.builtin)))
}

/** Filename matches before path matches, shorter paths first, like Orca's quick open. */
export function matchFiles(files: string[], query: string): string[] {
  const q = query.toLowerCase().replaceAll('\\', '/')
  if (!q) return files.slice(0, MAX_FILE_MATCHES)
  const scored: { path: string; score: number }[] = []
  for (const path of files) {
    const lower = path.toLowerCase()
    const name = lower.slice(lower.lastIndexOf('/') + 1)
    const score = name.startsWith(q) ? 0 : name.includes(q) ? 1 : lower.includes(q) ? 2 : -1
    if (score >= 0) scored.push({ path, score })
  }
  return scored
    .sort((a, b) => a.score - b.score || a.path.length - b.path.length)
    .slice(0, MAX_FILE_MATCHES)
    .map((s) => s.path)
}

function PickerListbox({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <div
      id={id}
      role="listbox"
      data-native-chat-autocomplete
      className="scrollbar-sleek absolute right-0 bottom-full left-0 z-20 mb-1 max-h-72 overflow-y-auto rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-[0_10px_24px_rgba(0,0,0,0.18)] select-none"
    >
      {children}
    </div>
  )
}

function PickerStatus({ children }: { children: React.ReactNode }) {
  return <div className="flex items-center gap-2 px-2 py-1.5 text-xs text-muted-foreground">{children}</div>
}

function PickerGroupHeading({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-2 pt-1.5 pb-1 text-2xs font-semibold tracking-[0.05em] text-muted-foreground uppercase">{children}</div>
  )
}

function PickerOptionButton({
  id,
  selected,
  onChoose,
  children
}: {
  id: string
  selected: boolean
  onChoose: () => void
  children: React.ReactNode
}) {
  const ref = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (selected) ref.current?.scrollIntoView({ block: 'nearest' })
  }, [selected])
  return (
    <button
      id={id}
      ref={ref}
      role="option"
      aria-selected={selected}
      type="button"
      onPointerDown={(event) => {
        // The textarea owns query and caret state, so acceptance runs before focus could move.
        event.preventDefault()
        if (event.button === 0) onChoose()
      }}
      className={cn(
        'flex w-full items-start gap-2 rounded-md border border-transparent px-2 py-1.5 text-left text-sm hover:bg-accent hover:text-accent-foreground',
        selected && 'border-border bg-accent text-accent-foreground'
      )}
    >
      {children}
    </button>
  )
}

export function NativeChatAutocompleteMenu({
  autocomplete,
  activeIndex,
  listboxId,
  onChoose
}: {
  autocomplete: ComposerAutocomplete
  activeIndex: number
  listboxId: string
  onChoose: (index: number) => void
}) {
  if (autocomplete.mode === 'mention') {
    const { items } = autocomplete
    return (
      <PickerListbox id={listboxId}>
        {items.map((path, index) => {
          const slash = path.lastIndexOf('/')
          return (
            <PickerOptionButton
              key={path}
              id={`${listboxId}-option-${index}`}
              selected={index === activeIndex}
              onChoose={() => onChoose(index)}
            >
              <FileText className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
              <span className="flex min-w-0 items-baseline gap-1.5">
                <span className="shrink-0 truncate">{path.slice(slash + 1)}</span>
                {slash > 0 ? <span className="min-w-0 truncate text-xs text-muted-foreground">{path.slice(0, slash)}</span> : null}
              </span>
            </PickerOptionButton>
          )
        })}
        {items.length === 0 ? (
          <PickerStatus>
            {autocomplete.status === 'loading'
              ? t('Loading files...')
              : autocomplete.status === 'error'
                ? t("Couldn't load files")
                : t('No matching files')}
          </PickerStatus>
        ) : null}
      </PickerListbox>
    )
  }

  const builtin = autocomplete.items.filter((c) => c.builtin)
  const custom = autocomplete.items.filter((c) => !c.builtin)
  const grouped = builtin.length > 0 && custom.length > 0
  let optionIndex = 0
  const option = (command: ChatCommand) => {
    const index = optionIndex++
    return (
      <PickerOptionButton
        key={`${command.builtin ? 'b' : 'c'}:${command.name}`}
        id={`${listboxId}-option-${index}`}
        selected={index === activeIndex}
        onChoose={() => onChoose(index)}
      >
        {command.builtin ? null : <Package className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />}
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-baseline gap-1.5">
            <span className="max-w-full shrink-0 truncate font-mono text-chat-code font-medium">/{command.name}</span>
            {command.argumentHint ? (
              <span className="min-w-0 truncate font-mono text-2xs text-muted-foreground">{command.argumentHint}</span>
            ) : null}
          </span>
          {command.description ? <span className="block truncate text-xs text-muted-foreground">{command.description}</span> : null}
        </span>
      </PickerOptionButton>
    )
  }
  return (
    <PickerListbox id={listboxId}>
      {grouped ? <PickerGroupHeading>{t('Commands')}</PickerGroupHeading> : null}
      {builtin.map(option)}
      {grouped ? <PickerGroupHeading>{t('Skills and custom commands')}</PickerGroupHeading> : null}
      {custom.map(option)}
      {autocomplete.items.length === 0 ? (
        <PickerStatus>
          {autocomplete.status === 'loading'
            ? t('Loading commands...')
            : autocomplete.status === 'error'
              ? t("Couldn't load commands")
              : t('No matching commands')}
        </PickerStatus>
      ) : null}
    </PickerListbox>
  )
}

/** The commands in the order the menu draws them, so the active index means the same row. */
export function slashMenuOrder(items: ChatCommand[]): ChatCommand[] {
  return [...items.filter((c) => c.builtin), ...items.filter((c) => !c.builtin)]
}
