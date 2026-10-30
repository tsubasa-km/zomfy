import { useEffect, useRef, useState } from 'react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { t } from '@/i18n/i18n'

// Ported from Orca's NativeChatMessageRail: a column of ticks down the right edge of the
// transcript, one per user message; each previews its message and jumps to it.

export type RailItem = { id: string; text: string }

const ROOMY_TICKS = 12

/** How far a navigation key moves through the messages; null for any other key. */
function railKeyStep(key: string, index: number, count: number): number | null {
  if (key === 'ArrowDown') return Math.min(count - 1, index + 1)
  if (key === 'ArrowUp') return Math.max(0, index - 1)
  if (key === 'Home') return 0
  return key === 'End' ? count - 1 : null
}

function rowOf(scroller: HTMLElement, id: string): HTMLElement | null {
  return scroller.querySelector<HTMLElement>(`[data-native-chat-user-row="${CSS.escape(id)}"]`)
}

/** The user message the reader is in: the last one whose top has scrolled past the view's top. */
function readActiveId(scroller: HTMLElement, items: RailItem[]): string | null {
  const top = scroller.getBoundingClientRect().top + 48
  let active: string | null = items[0]?.id ?? null
  for (const item of items) {
    const row = rowOf(scroller, item.id)
    if (row && row.getBoundingClientRect().top <= top) active = item.id
  }
  return active
}

export function NativeChatMessageRail({
  items,
  scrollRef
}: {
  items: RailItem[]
  scrollRef: React.RefObject<HTMLDivElement | null>
}) {
  const [activeId, setActiveId] = useState<string | null>(null)
  const railRef = useRef<HTMLDivElement>(null)
  // Parents rebuild `items` every render; reading it through a ref keeps the listener stable,
  // and the frame throttle keeps a replaying transcript from cascading renders into a loop.
  const itemsRef = useRef(items)
  itemsRef.current = items
  const itemsKey = items.map((item) => item.id).join('\n')

  useEffect(() => {
    const scroller = scrollRef.current
    if (!scroller) return
    let frame = 0
    const update = () => {
      if (frame) return
      frame = requestAnimationFrame(() => {
        frame = 0
        const next = readActiveId(scroller, itemsRef.current)
        setActiveId((current) => (current === next ? current : next))
      })
    }
    update()
    scroller.addEventListener('scroll', update, { passive: true })
    return () => {
      cancelAnimationFrame(frame)
      scroller.removeEventListener('scroll', update)
    }
  }, [itemsKey, scrollRef])

  if (items.length < 2) return null

  const jump = (id: string) => {
    const scroller = scrollRef.current
    const row = scroller && rowOf(scroller, id)
    if (!scroller || !row) return
    scroller.scrollTop += row.getBoundingClientRect().top - scroller.getBoundingClientRect().top - 16
  }
  const tabId = activeId ?? items[0]?.id

  return (
    <div
      ref={railRef}
      role="toolbar"
      data-native-chat-rail
      aria-label={t('Your messages')}
      aria-orientation="vertical"
      onKeyDown={(event) => {
        const next = railKeyStep(event.key, items.findIndex((item) => item.id === tabId), items.length)
        if (next === null) return
        event.preventDefault()
        const item = items[next]
        if (!item) return
        jump(item.id)
        railRef.current?.querySelectorAll('button')[next]?.focus()
      }}
      onWheel={(event) => {
        // The rail overlays the transcript without being inside it; pass the wheel through.
        if (scrollRef.current && !event.ctrlKey) scrollRef.current.scrollTop += event.deltaY
      }}
      className="absolute top-1/2 right-2.5 z-10 flex w-6 -translate-y-1/2 flex-col"
    >
      {items.map((item) => (
        <Tooltip key={item.id}>
          <TooltipTrigger asChild>
            <button
              type="button"
              tabIndex={item.id === tabId ? 0 : -1}
              aria-label={item.text || t('Message')}
              aria-current={item.id === activeId ? 'true' : undefined}
              onClick={() => jump(item.id)}
              // Padding, not a gap, so the pointer never falls between two ticks.
              className={cn(
                'flex w-full shrink-0 cursor-pointer items-center justify-center rounded-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
                items.length > ROOMY_TICKS ? 'py-0.5' : 'py-1'
              )}
            >
              <span
                aria-hidden
                className={cn(
                  'h-[3px] rounded-full transition-[width,background-color] duration-150 motion-reduce:transition-none',
                  item.id === activeId ? 'w-5 bg-highlight' : 'w-3 bg-muted-foreground/40'
                )}
              />
            </button>
          </TooltipTrigger>
          <TooltipContent side="left" sideOffset={8} className="max-w-72">
            <p className="line-clamp-2 text-xs leading-snug">{item.text || t('Message')}</p>
          </TooltipContent>
        </Tooltip>
      ))}
    </div>
  )
}
