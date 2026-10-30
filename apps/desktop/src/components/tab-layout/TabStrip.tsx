import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Ellipsis, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import { NewTabMenu } from './NewTabMenu'
import { NewTerminalButton } from './terminal-commands'
import { QuickCommandsButton } from '@/components/terminal/QuickCommandsButton'
import { TabItem } from './TabItem'
import { closeGroup } from './tab-group-commands'
import type { WorkspaceTab } from './workspace-tab-model'
import { t } from '@/i18n/i18n'

// Orca's tab-bar-surface.tsx + tab-strip-overflow-navigation.ts: tabs shrink to their floor, then
// the strip scrolls (wheel, chevrons) with fading edges and keeps the active tab in view.

const SCROLL_FRACTION = 0.75
const MIN_SCROLL_STEP = 120

interface Overflow {
  hasOverflow: boolean
  canScrollStart: boolean
  canScrollEnd: boolean
}

function useStripOverflow(tabCount: number) {
  const ref = useRef<HTMLDivElement>(null)
  const [overflow, setOverflow] = useState<Overflow>({ hasOverflow: false, canScrollStart: false, canScrollEnd: false })
  const update = useCallback(() => {
    const el = ref.current
    if (!el) return
    const max = Math.max(0, el.scrollWidth - el.clientWidth)
    const next = { hasOverflow: max > 1, canScrollStart: el.scrollLeft > 1, canScrollEnd: el.scrollLeft < max - 2 }
    setOverflow((prev) =>
      prev.hasOverflow === next.hasOverflow &&
      prev.canScrollStart === next.canScrollStart &&
      prev.canScrollEnd === next.canScrollEnd
        ? prev
        : next
    )
  }, [])

  useLayoutEffect(update, [update, tabCount])

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const observer = new ResizeObserver(update)
    observer.observe(el)
    const onWheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
        e.preventDefault()
        el.scrollLeft += e.deltaY
        update()
      }
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    el.addEventListener('scroll', update, { passive: true })
    return () => {
      observer.disconnect()
      el.removeEventListener('wheel', onWheel)
      el.removeEventListener('scroll', update)
    }
  }, [update])

  const scrollBy = (direction: 'start' | 'end') => {
    const el = ref.current
    if (!el) return
    const step = Math.max(MIN_SCROLL_STEP, el.clientWidth * SCROLL_FRACTION)
    el.scrollBy({ left: direction === 'start' ? -step : step, behavior: 'smooth' })
  }
  return { ref, overflow, scrollBy }
}

function ScrollButton({ direction, disabled, onClick }: { direction: 'start' | 'end'; disabled: boolean; onClick: () => void }) {
  const label = direction === 'start' ? t('Scroll tabs left') : t('Scroll tabs right')
  return (
    <Button
      variant="ghost"
      size="icon-xs"
      className="mx-0.5 my-auto h-6 w-5 shrink-0"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
    >
      {direction === 'start' ? <ChevronLeft className="size-3.5" /> : <ChevronRight className="size-3.5" />}
    </Button>
  )
}

function PaneActionsMenu({ onCloseGroup }: { onCloseGroup: () => void }) {
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={t('Pane Actions')}
          title={t('Pane Actions')}
          className="my-auto flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent/50 hover:text-foreground focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
        >
          <Ellipsis className="size-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" side="bottom" sideOffset={4}>
        <DropdownMenuItem variant="destructive" data-menu-action="close-pane" onSelect={onCloseGroup}>
          <X className="size-4" />
          {t('Close split pane')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function TabStrip({
  workspaceId,
  groupId,
  tabs,
  activeId,
  isFocused,
  hasSplit,
  trailing
}: {
  workspaceId: string
  groupId: string
  tabs: WorkspaceTab[]
  activeId: string | null
  isFocused: boolean
  hasSplit: boolean
  trailing?: React.ReactNode
}) {
  const { ref, overflow, scrollBy } = useStripOverflow(tabs.length)
  const fade = cn(overflow.canScrollStart && 'terminal-tab-strip--fade-start', overflow.canScrollEnd && 'terminal-tab-strip--fade-end')

  return (
    <div
      data-tab-group-strip-id={groupId}
      className="flex h-9 shrink-0 items-stretch border-b border-border bg-card"
    >
      {overflow.hasOverflow && (
        <ScrollButton direction="start" disabled={!overflow.canScrollStart} onClick={() => scrollBy('start')} />
      )}
      <div
        ref={ref}
        role="tablist"
        className={cn('terminal-tab-strip flex h-full min-w-0 flex-[0_1_auto] items-stretch overflow-x-auto overflow-y-hidden', fade)}
      >
        {tabs.map((tab) => (
          <TabItem
            key={tab.id}
            workspaceId={workspaceId}
            groupId={groupId}
            tab={tab}
            groupTabs={tabs}
            active={tab.id === activeId}
            groupActiveId={activeId}
            hasSplit={hasSplit}
          />
        ))}
      </div>
      {overflow.hasOverflow && (
        <ScrollButton direction="end" disabled={!overflow.canScrollEnd} onClick={() => scrollBy('end')} />
      )}
      <NewTabMenu workspaceId={workspaceId} groupId={groupId} />
      <NewTerminalButton workspaceId={workspaceId} groupId={groupId} />
      <QuickCommandsButton workspaceId={workspaceId} />
      <div className="min-w-0 flex-1" />
      {hasSplit && (
        <div
          className={cn(
            'ml-1.5 flex shrink-0 items-center gap-0.5 pr-1.5 transition-opacity duration-150',
            !isFocused && 'opacity-50 focus-within:opacity-100 hover:opacity-100'
          )}
        >
          <PaneActionsMenu onCloseGroup={() => closeGroup(workspaceId, groupId, tabs)} />
        </div>
      )}
      {trailing}
    </div>
  )
}
