import { useEffect, useRef } from 'react'
import { FileIcon } from '@/components/FileIcon'
import { Package, Sparkles } from 'lucide-react'
import type { ChatCommand, ChatCommandKind } from '@zomfy/protocol'
import { ConnectorIcon } from '@/components/right-sidebar/session-panel/ConnectorIcon'
import { MCP_MENTION_QUERY, slashGroups, type MentionOption } from './composer-menu-items'
import { cn } from '@/lib/utils'
import { t } from '@/i18n/i18n'

// Ported from Orca's NativeChatAutocompleteMenus: the `/` command menu and the `@` file menu
// open above the composer; the textarea keeps focus and drives the active row. What they list, and
// in which order, is composer-menu-items.ts.

export type ComposerAutocomplete =
  | { mode: 'slash'; query: string; start: number; end: number; items: ChatCommand[]; status: 'loading' | 'ready' | 'error' }
  | { mode: 'mention'; query: string; start: number; end: number; items: MentionOption[]; status: 'loading' | 'ready' | 'error' }

const GROUP_TITLE: Record<ChatCommandKind, string> = {
  command: t('Commands'),
  skill: t('Skills'),
  'mcp-prompt': t('MCP prompts')
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
        {items.map((item, index) => {
          if (item.kind === 'mcp') {
            return (
              <PickerOptionButton
                key={`mcp:${item.server.name}`}
                id={`${listboxId}-option-${index}`}
                selected={index === activeIndex}
                onChoose={() => onChoose(index)}
              >
                <ConnectorIcon server={item.server} className="size-4" />
                <span className="flex min-w-0 items-baseline gap-1.5" data-mention-option-mcp={item.server.name}>
                  <span className="shrink-0 truncate">{item.server.name}</span>
                  <span className="min-w-0 truncate text-xs text-muted-foreground">{t('MCP server')}</span>
                </span>
              </PickerOptionButton>
            )
          }
          const path = item.path
          const slash = path.lastIndexOf('/')
          return (
            <PickerOptionButton
              key={path}
              id={`${listboxId}-option-${index}`}
              selected={index === activeIndex}
              onChoose={() => onChoose(index)}
            >
              <FileIcon name={path} className="mt-0.5 size-3.5" />
              <span className="flex min-w-0 items-baseline gap-1.5">
                <span className="shrink-0 truncate">{path.slice(slash + 1)}</span>
                {slash > 0 ? <span className="min-w-0 truncate text-xs text-muted-foreground">{path.slice(0, slash)}</span> : null}
              </span>
            </PickerOptionButton>
          )
        })}
        {items.length === 0 ? (
          <PickerStatus>
            {autocomplete.query.toLowerCase().startsWith(MCP_MENTION_QUERY)
              ? autocomplete.status === 'loading'
                ? t('Loading connectors…')
                : t('No connected MCP servers')
              : autocomplete.status === 'loading'
                ? t('Loading files...')
                : autocomplete.status === 'error'
                  ? t("Couldn't load files")
                  : t('No matching files')}
          </PickerStatus>
        ) : null}
      </PickerListbox>
    )
  }

  // The rows come in slashMenuOrder already; each group gets its heading once there are two.
  const groups = slashGroups(autocomplete.items)
  const grouped = groups.length > 1
  let optionIndex = 0
  const option = (command: ChatCommand) => {
    const index = optionIndex++
    const kind = command.kind ?? 'command'
    return (
      <PickerOptionButton
        key={`${kind}:${command.builtin ? 'b' : 'c'}:${command.name}`}
        id={`${listboxId}-option-${index}`}
        selected={index === activeIndex}
        onChoose={() => onChoose(index)}
      >
        {kind === 'skill' ? (
          <Sparkles className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
        ) : command.builtin ? null : (
          <Package className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
        )}
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
      {groups.map((group) => (
        <div key={group.kind} role="group" aria-label={GROUP_TITLE[group.kind]} data-slash-group={group.kind}>
          {grouped ? <PickerGroupHeading>{GROUP_TITLE[group.kind]}</PickerGroupHeading> : null}
          {group.items.map(option)}
        </div>
      ))}
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
