import { ArrowDownUp, ArrowUp, Check, ChevronDown, CloudUpload, Loader2, Plus, RefreshCw, Sparkles, Square } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import type { DropdownActionKind, DropdownEntry, PrimaryAction, PrimaryActionKind } from './source-control-actions'

// Orca's commit/commit-area.tsx, commit-message-composer.tsx and commit-action-menu.tsx: the
// message box with the AI sparkle, the primary split button, and the notices under it.

// Pull stays icon-less (a down arrow reads as download).
const PRIMARY_ICONS: Partial<Record<PrimaryActionKind, React.ComponentType<{ className?: string }>>> = {
  commit: Check,
  stage: Plus,
  push: ArrowUp,
  force_push: ArrowUp,
  sync: ArrowDownUp,
  publish: CloudUpload
}

const isMac = navigator.userAgent.includes('Mac')

export function CommitArea({
  message,
  onMessageChange,
  onSubmitShortcut,
  messageDisabled,
  primary,
  dropdown,
  showSpinner,
  showChevronSpinner,
  onPrimary,
  onDropdown,
  generate,
  notices
}: {
  message: string
  onMessageChange: (message: string) => void
  onSubmitShortcut: () => void
  messageDisabled: boolean
  primary: PrimaryAction
  dropdown: DropdownEntry[]
  showSpinner: boolean
  showChevronSpinner: boolean
  onPrimary: () => void
  onDropdown: (kind: DropdownActionKind) => void
  generate: { running: boolean; disabled: boolean; tooltip: string; onGenerate: () => void; onCancel: () => void }
  notices: { id: string; text: string }[]
}) {
  // Cap at 12 rows so a pasted multi-page message can't push the button off-screen.
  const rows = Math.min(12, Math.max(2, message.split('\n').length))
  const PrimaryIcon = PRIMARY_ICONS[primary.kind]
  const moreLabel = 'More commit and remote actions'

  return (
    <div className="px-3 pb-2">
      <div className="relative">
        <textarea
          rows={rows}
          value={message}
          disabled={messageDisabled}
          onChange={(e) => onMessageChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (isMac ? e.metaKey : e.ctrlKey)) {
              e.preventDefault()
              onSubmitShortcut()
            }
          }}
          placeholder={`Message (${isMac ? '⌘' : 'Ctrl+'}Enter to commit)`}
          aria-label="Commit message"
          aria-describedby={notices.map((n) => n.id).join(' ') || undefined}
          className="mt-0.5 min-h-14 w-full resize-none appearance-none rounded-md border border-input bg-background px-2 py-1.5 pr-8 text-xs text-foreground shadow-xs outline-none placeholder:text-muted-foreground/70 focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:border-input disabled:bg-background disabled:text-foreground disabled:shadow-xs dark:bg-input/30 dark:disabled:bg-input/30"
        />
        <GenerateButton {...generate} />
      </div>

      {/* Action + chevron form one split button so edit → commit → push stays in one band. */}
      <div className="mt-1 flex items-stretch">
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="flex flex-1">
              <Button
                type="button"
                variant="outline"
                size="xs"
                disabled={primary.disabled}
                onClick={onPrimary}
                className="w-full rounded-r-none px-3 text-[11px]"
                data-primary-action={primary.kind}
              >
                {showSpinner ? <Loader2 className="size-3.5 animate-spin" /> : PrimaryIcon ? <PrimaryIcon className="size-3.5" /> : null}
                {primary.label}
              </Button>
            </span>
          </TooltipTrigger>
          <TooltipContent side="top" sideOffset={6} className="max-w-72">
            {primary.title}
          </TooltipContent>
        </Tooltip>
        <DropdownMenu>
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="inline-flex shrink-0">
                <DropdownMenuTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    size="xs"
                    // The chevron stays clickable when Commit is disabled: push/fetch/pull remain valid.
                    className={cn('shrink-0 rounded-l-none border-l border-border px-1.5', primary.disabled && 'opacity-50')}
                    aria-label={moreLabel}
                  >
                    {showChevronSpinner ? <Loader2 className="size-3.5 animate-spin" /> : <ChevronDown className="size-3.5" />}
                  </Button>
                </DropdownMenuTrigger>
              </span>
            </TooltipTrigger>
            <TooltipContent side="top" sideOffset={6}>
              {moreLabel}
            </TooltipContent>
          </Tooltip>
          <DropdownMenuContent align="end" className="min-w-[14rem]">
            {dropdown.map((entry) =>
              entry.kind === 'separator' ? (
                <DropdownMenuSeparator key={entry.id} />
              ) : (
                <Tooltip key={entry.kind}>
                  <TooltipTrigger asChild>
                    <div className="block">
                      <DropdownMenuItem
                        disabled={entry.disabled}
                        className="w-full"
                        data-dropdown-action={entry.kind}
                        onSelect={(event) => {
                          if (entry.disabled) {
                            event.preventDefault()
                            return
                          }
                          onDropdown(entry.kind)
                        }}
                      >
                        {entry.label}
                      </DropdownMenuItem>
                    </div>
                  </TooltipTrigger>
                  <TooltipContent side="left" sideOffset={8} className="max-w-72">
                    {entry.title}
                  </TooltipContent>
                </Tooltip>
              )
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {notices.map((notice) => (
        <p
          key={notice.id}
          id={notice.id}
          role="alert"
          aria-live="polite"
          className="mt-1 text-[11px] break-words whitespace-pre-wrap text-destructive [overflow-wrap:anywhere]"
        >
          {notice.text}
        </p>
      ))}
    </div>
  )
}

function GenerateButton({
  running,
  disabled,
  tooltip,
  onGenerate,
  onCancel
}: {
  running: boolean
  disabled: boolean
  tooltip: string
  onGenerate: () => void
  onCancel: () => void
}) {
  if (running) {
    // While generating, the icon doubles as cancel: hover/focus swaps the spinner for a stop square.
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={onCancel}
            aria-label="Stop generating commit message"
            className="group absolute top-1.5 right-1.5 inline-flex size-5 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive focus-visible:bg-destructive/10 focus-visible:text-destructive focus-visible:ring-1 focus-visible:ring-destructive/40 focus-visible:outline-none"
          >
            <RefreshCw className="size-3.5 animate-spin group-hover:hidden group-focus-visible:hidden" />
            <Square className="hidden size-3.5 fill-current group-hover:block group-focus-visible:block" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="left" sideOffset={6}>
          Generating commit message. Click to stop.
        </TooltipContent>
      </Tooltip>
    )
  }
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-disabled={disabled}
          onClick={(event) => {
            if (disabled) {
              event.preventDefault()
              return
            }
            onGenerate()
          }}
          aria-label="Generate commit message with AI"
          className={cn(
            'absolute top-1.5 right-1.5 inline-flex size-5 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none',
            disabled && 'cursor-not-allowed opacity-40 hover:bg-transparent hover:text-muted-foreground'
          )}
        >
          <Sparkles className="size-3.5" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="left" sideOffset={6}>
        {tooltip}
      </TooltipContent>
    </Tooltip>
  )
}
