import { Fragment } from 'react'
import { Check } from 'lucide-react'
import { setSetting, useSetting } from '@/stores/settings-store'
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuLabel, ContextMenuSeparator, ContextMenuTrigger } from '@/components/ui/context-menu'
import { useStatusBarItems, type StatusBarItem } from './status-bar-registry'
import './status-bar-segments'

// Orca's status bar (status-bar/StatusBarSurface.tsx): one 24px line along the bottom, segments
// left and right, and a right-click menu that chooses which segments show.

export function StatusBar() {
  const visible = useSetting('statusBarVisible')
  const hidden = useSetting('statusBarHiddenItems')
  const items = useStatusBarItems()
  if (!visible) return null

  const shown = (item: StatusBarItem) => item.pinned || !hidden.includes(item.id)
  const toggle = (id: string) =>
    setSetting('statusBarHiddenItems', hidden.includes(id) ? hidden.filter((h) => h !== id) : [...hidden, id])
  const render = (side: StatusBarItem['side']) =>
    items.filter((item) => item.side === side && shown(item)).map((item) => <Fragment key={item.id}>{item.render()}</Fragment>)

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <footer
          data-status-bar
          className="relative flex h-6 min-h-[24px] shrink-0 items-center gap-4 overflow-clip border-t border-border bg-card px-3 text-xs whitespace-nowrap select-none"
        >
          <div className="flex min-w-0 flex-1 items-center gap-3 overflow-hidden">{render('left')}</div>
          <div className="flex shrink-0 items-center gap-3">{render('right')}</div>
        </footer>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuLabel>Status bar items</ContextMenuLabel>
        {items
          .filter((item) => !item.pinned)
          .map((item) => (
            <ContextMenuItem key={item.id} onSelect={() => toggle(item.id)}>
              <Check className={hidden.includes(item.id) ? 'invisible' : undefined} />
              {item.label}
            </ContextMenuItem>
          ))}
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={() => setSetting('statusBarVisible', false)}>Hide status bar</ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}
