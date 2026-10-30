import { ChevronDown, FilePenLine, Hand, NotebookPen, ShieldAlert, ShieldCheck, type LucideIcon } from 'lucide-react'
import type { ChatPermissionMode } from '@acp-harness/protocol'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { t } from '@/i18n/i18n'

// Ported from Orca's NativeChatPermissionModePicker and native-chat-permission-mode-labels, with
// Claude's Plan mode added (Orca's ask/accept-edits/auto/full-access are default/acceptEdits/auto/bypassPermissions).
const MODE_COPY: Record<ChatPermissionMode, { label: string; description: string; icon: LucideIcon }> = {
  plan: { label: t('Plan'), description: t('Explores and plans; changes nothing until you approve the plan'), icon: NotebookPen },
  default: { label: t('Ask for approval'), description: t("Asks before edits and commands your settings don't allow"), icon: Hand },
  acceptEdits: { label: t('Accept edits'), description: t('Approves file edits and file commands; asks for the rest'), icon: FilePenLine },
  auto: { label: t('Auto'), description: t("Claude Code's auto mode: reviews approval requests for you"), icon: ShieldCheck },
  bypassPermissions: { label: t('Full access'), description: t('Never asks before edits or commands'), icon: ShieldAlert }
}

/** Picker order: least to most access. */
export const MODES: readonly ChatPermissionMode[] = ['plan', 'default', 'acceptEdits', 'auto', 'bypassPermissions']

export function permissionModeLabel(mode: ChatPermissionMode): string {
  return MODE_COPY[mode].label
}

/** Icon and name; Full access reads in the warning colour wherever it is shown. */
function ModeName({ mode, truncate }: { mode: ChatPermissionMode; truncate?: boolean }) {
  const { icon: Icon, label } = MODE_COPY[mode]
  const body = (
    <>
      <Icon className="size-3.5 shrink-0" aria-hidden />
      {truncate ? <span className="truncate">{label}</span> : <span>{label}</span>}
    </>
  )
  return mode === 'bypassPermissions' ? (
    <span className="flex min-w-0 items-center gap-1.5 text-status-warning">{body}</span>
  ) : (
    <span className="flex min-w-0 items-center gap-1.5">{body}</span>
  )
}

export function NativeChatPermissionModePicker({
  current,
  autoAvailable,
  onSelect
}: {
  current: ChatPermissionMode
  /** Auto runs only on a model whose listing says it supports it. */
  autoAvailable: boolean
  onSelect: (mode: ChatPermissionMode) => void
}) {
  const modes = MODES.filter((mode) => mode !== 'auto' || autoAvailable || current === 'auto')
  const title = t('Permissions')
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="xs"
              data-native-chat-permission-picker
              aria-label={`${title} ${MODE_COPY[current].label}`}
              className="max-w-40 min-w-0 shrink"
            >
              <ModeName mode={current} truncate />
              <ChevronDown className="size-3" />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="top" sideOffset={4}>
          {title}
        </TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="start" side="top" collisionPadding={8} className="w-72 select-none">
        <DropdownMenuRadioGroup aria-label={title} value={current}>
          {modes.map((mode) => (
            <DropdownMenuRadioItem
              key={mode}
              value={mode}
              data-permission-mode={mode}
              onSelect={() => mode !== current && onSelect(mode)}
            >
              <div className="min-w-0 py-0.5">
                <ModeName mode={mode} />
                <div className="text-xs font-normal text-muted-foreground">{MODE_COPY[mode].description}</div>
              </div>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
