import { ArrowDown } from 'lucide-react'
import { t } from '@/i18n/i18n'

/**
 * Orca's way back to the latest message once the reader has scrolled up. It stays mounted so it
 * can fade rather than pop; while hidden it is inert.
 */
export function NativeChatJumpToLatest({ visible, onJump }: { visible: boolean; onJump: () => void }) {
  return (
    <button
      type="button"
      data-shown={visible}
      data-native-chat-jump-latest
      inert={!visible}
      aria-hidden={!visible || undefined}
      // A pointer press never moves focus out of the composer.
      onMouseDown={(event) => event.preventDefault()}
      onClick={onJump}
      className="absolute bottom-3 left-1/2 flex h-8 -translate-x-1/2 items-center gap-1.5 rounded-full border border-border bg-popover px-3 text-xs font-medium text-popover-foreground shadow-floating transition-[opacity,translate] duration-150 ease-out hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none motion-reduce:transition-none data-[shown=false]:pointer-events-none data-[shown=false]:translate-y-1 data-[shown=false]:opacity-0"
    >
      <ArrowDown className="size-3.5" />
      <span>{t('Jump to latest')}</span>
    </button>
  )
}
