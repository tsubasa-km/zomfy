import { useEffect, useRef, useState, type ComponentType, type KeyboardEvent, type ReactNode, type Ref } from 'react'
import { FolderOpen, Globe, Loader2, Plus } from 'lucide-react'
import { DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { ShortcutKeyCombo } from '@/components/ShortcutKeyCombo'
import { cn } from '@/lib/utils'

// Orca's AddRepoLocalStartStep + add-repo-local-start-actions: Browse first, then "Other ways to
// add". The ⏎ chip follows keyboard focus, so Enter always runs the highlighted row; ↑/↓ move it.

interface StartAction {
  kind: 'browse' | 'clone' | 'create'
  icon: ComponentType<{ className?: string }>
  title: string
  description: string
  onClick: () => void
}

export function AddRepoStartStep({
  firstProject,
  hostSelector,
  typedPath,
  busy,
  disabled,
  onBrowse,
  onClone,
  onCreate,
  onImportOrca
}: {
  firstProject: boolean
  hostSelector: ReactNode
  /** The host has no folder picker (SSH): Browse becomes a typed host path. */
  typedPath: boolean
  busy: boolean
  disabled: boolean
  onBrowse: () => void
  onClone: () => void
  onCreate: () => void
  onImportOrca: () => void
}) {
  const browseRef = useRef<HTMLButtonElement | null>(null)
  const actionsRef = useRef<HTMLDivElement | null>(null)
  const unavailable = busy || disabled
  const primary: StartAction = {
    kind: 'browse',
    icon: FolderOpen,
    title: 'Browse folder',
    description: typedPath ? 'Existing Git repository or folder on this host' : 'Local project, Git repo, or folder',
    onClick: onBrowse
  }
  const secondary: StartAction[] = [
    { kind: 'clone', icon: Globe, title: 'Clone from URL', description: 'Clone a remote Git repository', onClick: onClone },
    { kind: 'create', icon: Plus, title: 'Create new project', description: 'Start from an empty folder', onClick: onCreate }
  ]
  const [selectedKind, setSelectedKind] = useState<StartAction['kind'] | null>('browse')
  const visibleSelected = unavailable ? null : selectedKind

  useEffect(() => {
    if (!unavailable) browseRef.current?.focus()
  }, [unavailable])

  const onArrow = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    const buttons = Array.from(actionsRef.current?.querySelectorAll<HTMLButtonElement>('button[data-add-repo-action]') ?? [])
    if (buttons.length === 0) return
    const current = buttons.findIndex((b) => b === document.activeElement)
    const delta = event.key === 'ArrowDown' ? 1 : -1
    event.preventDefault()
    buttons[(current + delta + buttons.length) % buttons.length]?.focus()
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Add a project</DialogTitle>
        {firstProject ? <DialogDescription>Add a project to get started with Zomfy.</DialogDescription> : null}
      </DialogHeader>

      <div
        className="space-y-3 pt-2"
        ref={actionsRef}
        onKeyDown={onArrow}
        onBlur={(event) => {
          const next = event.relatedTarget
          if (!(next instanceof HTMLButtonElement) || !next.matches('button[data-add-repo-action]')) setSelectedKind(null)
        }}
      >
        {hostSelector}
        <PrimaryAction
          action={primary}
          disabled={unavailable}
          selected={visibleSelected === 'browse'}
          buttonRef={browseRef}
          onFocus={() => setSelectedKind('browse')}
        />
        <div className="space-y-1.5">
          <p className="text-xs font-medium tracking-wider text-muted-foreground uppercase">Other ways to add</p>
          <div className="overflow-hidden rounded-md border border-input bg-background">
            {secondary.map((action, index) => (
              <SecondaryAction
                key={action.kind}
                action={action}
                disabled={unavailable}
                selected={visibleSelected === action.kind}
                onFocus={() => setSelectedKind(action.kind)}
                className={cn(index === 0 ? 'rounded-t-md' : 'border-t border-border/70', index === secondary.length - 1 && 'rounded-b-md')}
              />
            ))}
          </div>
        </div>
        {busy ? (
          <div className="flex items-center gap-2 rounded-md border border-border bg-muted px-3 py-2 text-xs text-muted-foreground">
            <Loader2 className="size-3.5 shrink-0 animate-spin" />
            <span className="min-w-0 flex-1">Adding project…</span>
          </div>
        ) : null}
        <div className="flex justify-end">
          <button
            type="button"
            className="text-xs text-muted-foreground transition-colors hover:text-foreground"
            data-add-repo-orca-import
            onClick={onImportOrca}
          >
            Import from Orca…
          </button>
        </div>
      </div>
    </>
  )
}

const EnterChip = () => (
  <span aria-hidden="true" className="shrink-0">
    <ShortcutKeyCombo keys={['⏎']} keyCapClassName="border-border/80 bg-background/70 text-muted-foreground" />
  </span>
)

interface ActionProps {
  action: StartAction
  disabled: boolean
  selected: boolean
  onFocus: () => void
}

function PrimaryAction({ action, disabled, selected, onFocus, buttonRef }: ActionProps & { buttonRef: Ref<HTMLButtonElement> }) {
  const Icon = action.icon
  return (
    <Button
      ref={buttonRef}
      type="button"
      variant="ghost"
      onClick={action.onClick}
      onFocus={onFocus}
      disabled={disabled}
      data-add-repo-action={action.kind}
      className={cn(
        'h-auto min-h-[3.75rem] w-full justify-start gap-3 px-3 py-2.5 text-left whitespace-normal',
        selected
          ? 'border border-ring bg-foreground/10 text-foreground focus-visible:border-ring focus-visible:ring-0 dark:bg-accent dark:text-accent-foreground'
          : 'border border-border bg-background shadow-none dark:bg-background'
      )}
    >
      <span className={cn('grid size-7 shrink-0 place-items-center rounded-md', selected ? 'bg-background/70 text-accent-foreground' : 'text-foreground')}>
        <Icon className="size-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm leading-5 font-medium">{action.title}</span>
        <span className="mt-0.5 block text-xs leading-5 font-normal text-muted-foreground">{action.description}</span>
      </span>
      {selected ? <EnterChip /> : null}
    </Button>
  )
}

function SecondaryAction({ action, disabled, selected, onFocus, className }: ActionProps & { className?: string }) {
  const Icon = action.icon
  return (
    <button
      type="button"
      data-add-repo-action={action.kind}
      disabled={disabled}
      onClick={action.onClick}
      onFocus={onFocus}
      className={cn(
        'flex min-h-[3.25rem] w-full items-center gap-3 border border-transparent px-3 py-2.5 text-left transition-colors focus-visible:outline-none disabled:pointer-events-none disabled:cursor-default disabled:opacity-40',
        className,
        selected
          ? 'border-ring bg-foreground/10 text-foreground focus-visible:ring-0 dark:bg-accent dark:text-accent-foreground'
          : 'hover:bg-accent focus-visible:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:ring-inset'
      )}
    >
      <span className={cn('grid size-7 shrink-0 place-items-center rounded-md', selected ? 'bg-background/70 text-accent-foreground' : 'text-muted-foreground')}>
        <Icon className="size-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className={cn('block text-sm leading-5 font-medium', selected ? 'text-accent-foreground' : 'text-foreground')}>{action.title}</span>
        <span className="block text-xs leading-4 text-muted-foreground">{action.description}</span>
      </span>
      {selected ? <EnterChip /> : null}
    </button>
  )
}
