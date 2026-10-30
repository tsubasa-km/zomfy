import type { JSX } from 'react'
import { ClipboardCopy, FolderOpen, Info, MoreHorizontal, Trash2 } from 'lucide-react'
import type { DiscoveredSkill } from '@acp-harness/protocol'
import { Button } from '@/components/ui/button'
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from '@/components/ui/context-menu'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { PROVIDER_LABELS, sourceKindLabel } from './skills-filter'
import { t } from '@/i18n/i18n'

// Orca's SkillRow.tsx / SkillRowActions.tsx, without sharing (Orca's cloud links) or selection mode.

export type SkillRowAction = {
  key: string
  label: string
  icon: JSX.Element
  disabled?: boolean
  /** Shown as the item's title, since Radix disables pointer events on a disabled item. */
  disabledReason?: string | null
  destructive?: boolean
  onSelect: () => void
}

const dateFormatter = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' })

export function skillRowActions(handlers: {
  skill: DiscoveredSkill
  deleteBlockedReason: string | null
  onOpenDetail: () => void
  onReveal: () => void
  onDelete: () => void
}): SkillRowAction[] {
  return [
    { key: 'details', label: t('View details'), icon: <Info />, onSelect: handlers.onOpenDetail },
    { key: 'reveal', label: t('Reveal file'), icon: <FolderOpen />, onSelect: handlers.onReveal },
    {
      key: 'copy-path',
      label: t('Copy path'),
      icon: <ClipboardCopy />,
      onSelect: () => void navigator.clipboard.writeText(handlers.skill.skillFilePath)
    },
    {
      key: 'delete',
      label: t('Delete…'),
      icon: <Trash2 />,
      destructive: true,
      disabled: handlers.deleteBlockedReason !== null,
      disabledReason: handlers.deleteBlockedReason,
      onSelect: handlers.onDelete
    }
  ]
}

export function SkillRow({
  skill,
  actions,
  onOpenDetail
}: {
  skill: DiscoveredSkill
  actions: SkillRowAction[]
  onOpenDetail: () => void
}) {
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          role="option"
          aria-selected={false}
          tabIndex={0}
          data-skill-row={skill.id}
          onClick={onOpenDetail}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault()
              onOpenDetail()
            }
          }}
          className="group flex w-full cursor-pointer items-start gap-3 border-b border-border/50 px-2 py-2.5 text-left transition-colors last:border-b-0 hover:bg-accent/50 focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none"
        >
          {/* Metadata is its own grid column, so the description truncates where it starts. */}
          <div className="grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-3">
            <span className="min-w-0 truncate text-sm font-medium" data-skill-name>
              {skill.name}
            </span>
            <span className="flex shrink-0 items-center gap-2 text-[11px] text-muted-foreground">
              <span>{sourceKindLabel(skill.sourceKind)}</span>
              <span className="hidden sm:inline" aria-hidden>
                ·
              </span>
              <span className="hidden sm:inline">{skill.providers.map((p) => PROVIDER_LABELS[p]).join(', ')}</span>
              <span aria-hidden>·</span>
              <span className="tabular-nums">{skill.updatedAt ? dateFormatter.format(new Date(skill.updatedAt)) : t('No date')}</span>
            </span>
            <p className="col-start-1 min-w-0 truncate text-xs leading-5 text-muted-foreground">
              {skill.description ?? t('No description found.')}
            </p>
          </div>
          <div
            className="shrink-0 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100 focus-within:opacity-100 has-[[data-state=open]]:opacity-100"
            onClick={(event) => event.stopPropagation()}
          >
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button type="button" variant="ghost" size="icon-sm" aria-label={t('Actions for {name}', { name: skill.name })}>
                  <MoreHorizontal />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {actions.map((action) => (
                  <span key={action.key} title={action.disabled ? (action.disabledReason ?? undefined) : undefined} className="block">
                      <DropdownMenuItem
                        disabled={action.disabled}
                        variant={action.destructive ? 'destructive' : 'default'}
                        onSelect={action.onSelect}
                      >
                        {action.icon}
                        {action.label}
                      </DropdownMenuItem>
                  </span>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        {actions.map((action) => (
          <span key={action.key} title={action.disabled ? (action.disabledReason ?? undefined) : undefined} className="block">
            <ContextMenuItem disabled={action.disabled} variant={action.destructive ? 'destructive' : 'default'} onSelect={action.onSelect}>
              {action.icon}
              {action.label}
            </ContextMenuItem>
          </span>
        ))}
      </ContextMenuContent>
    </ContextMenu>
  )
}
