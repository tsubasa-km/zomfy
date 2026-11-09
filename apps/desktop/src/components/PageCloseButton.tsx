import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { t } from '@/i18n/i18n'

/** The close button every sidebar page puts first in its header, so it is always top left. */
export function PageCloseButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon" className="size-7 shrink-0" aria-label={label} data-page-close onClick={onClick}>
          <X className="size-4" />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom" sideOffset={6}>
        {t('Close · Esc')}
      </TooltipContent>
    </Tooltip>
  )
}
