import { EyeOff } from 'lucide-react'
import { ContextMenuContent, ContextMenuItem } from '@/components/ui/context-menu'
import { t } from '@/i18n/i18n'

/** Orca's sidebar-nav-controls: the context menu every optional nav row shares. */
export function HideSidebarMenu({ onHide }: { onHide: () => void }) {
  return (
    <ContextMenuContent>
      <ContextMenuItem onSelect={onHide}>
        <EyeOff className="size-3.5" />
        {t('Hide from sidebar')}
      </ContextMenuItem>
    </ContextMenuContent>
  )
}
