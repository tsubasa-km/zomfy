import { SlidersHorizontal } from 'lucide-react'
import { setSidebarView, useStore } from '@/session-store'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { t } from '@/i18n/i18n'

// How the chat list is cut and what it leaves out.

export function ChatListOptionsMenu() {
  const view = useStore((s) => s.sidebarView)
  return (
    <DropdownMenu modal={false}>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button size="icon-xs" variant="ghost" aria-label={t('View options')} data-sidebar-view-options className="text-muted-foreground">
              <SlidersHorizontal className="size-3.5" strokeWidth={2.25} />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom" sideOffset={6}>
          {t('View options')}
        </TooltipContent>
      </Tooltip>
      <DropdownMenuContent side="right" align="start" sideOffset={8} className="w-60 pb-2">
        <DropdownMenuLabel className="pb-0 text-sm text-foreground">{t('View options')}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-xs text-muted-foreground">{t('Show')}</DropdownMenuLabel>
        <DropdownMenuCheckboxItem
          data-option="workflow-chats"
          title={t('Threads a workflow run made for its steps. They stay folded under the thread the run was started from either way.')}
          checked={view.workflowChats === true}
          onCheckedChange={(checked) => setSidebarView({ workflowChats: checked === true })}
          onSelect={(e) => e.preventDefault()}
        >
          {t('Workflow threads')}
        </DropdownMenuCheckboxItem>
        <DropdownMenuCheckboxItem
          data-option="bot-chats"
          title={t('Threads with your bots. The Bots page lists them either way; one waiting for you shows here anyway.')}
          checked={view.botChats === true}
          onCheckedChange={(checked) => setSidebarView({ botChats: checked === true })}
          onSelect={(e) => e.preventDefault()}
        >
          {t('Show bot chats')}
        </DropdownMenuCheckboxItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
