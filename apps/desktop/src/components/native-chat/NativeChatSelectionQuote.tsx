import { useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { MessagesSquare, Quote } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover'
import { t } from '@/i18n/i18n'

// Ported from Orca's NativeChatSelectionQuote and native-chat-quote-selection.

/** Marks the prose of an agent reply; only a selection inside one of these can be quoted. */
export const NATIVE_CHAT_QUOTE_SOURCE_PROPS = { 'data-native-chat-quote-source': '' } as const
const QUOTE_SOURCE_SELECTOR = '[data-native-chat-quote-source]'
// Why: shown at once, a double-click's action would sit under the pointer and take the third click.
const DOUBLE_CLICK_SETTLE_MS = 500

/** The selection when all of it sits inside one agent reply of this chat, else null. */
function readQuotableSelection(root: HTMLElement): { text: string; range: Range } | null {
  const selection = window.getSelection()
  if (!selection || selection.isCollapsed || selection.rangeCount !== 1) return null
  const range = selection.getRangeAt(0)
  if (!root.contains(range.commonAncestorContainer)) return null
  const start = range.startContainer instanceof Element ? range.startContainer : range.startContainer.parentElement
  const source = start?.closest(QUOTE_SOURCE_SELECTOR)
  const text = selection.toString().trim()
  if (!source || !source.contains(range.endContainer) || text === '') return null
  return { text, range }
}

/** The text as a markdown blockquote, then the blank line that ends it so a reply can follow. */
export function formatNativeChatQuote(text: string): string {
  const lines = text.trim().split(/\r?\n/)
  return `${lines.map((line) => (line.trim() ? `> ${line}` : '>')).join('\n')}\n\n`
}

type QuoteRequest = { text: string; anchor: { getBoundingClientRect: () => DOMRect } }

/** Offers "Add to chat" (and, in a main chat, "Ask in side chat") beside a selection in an agent's reply. */
export function NativeChatSelectionQuote({
  rootRef,
  onQuote,
  onAskInSideChat
}: {
  rootRef: RefObject<HTMLElement | null>
  onQuote: (markdown: string) => void
  onAskInSideChat?: (markdown: string) => void
}) {
  const [request, setRequest] = useState<QuoteRequest | null>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const virtualRef = useMemo(() => ({ current: request?.anchor ?? null }), [request])

  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    let timer: number | undefined
    const close = () => {
      window.clearTimeout(timer)
      setRequest(null)
    }
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && contentRef.current?.contains(event.target)) return
      close()
    }
    const offer = (point: { x: number; y: number } | null, delay: number) => {
      window.clearTimeout(timer)
      timer = window.setTimeout(() => {
        const quotable = readQuotableSelection(root)
        if (!quotable) {
          setRequest(null)
          return
        }
        const { text, range } = quotable
        const held = range.getBoundingClientRect()
        const end = [...range.getClientRects()].at(-1) ?? held
        const dx = (point?.x ?? end.right) - held.left
        const dy = (point?.y ?? end.top) - held.top
        setRequest({
          text,
          anchor: {
            getBoundingClientRect: () => {
              const now = range.getBoundingClientRect()
              return new DOMRect(now.left + dx, now.top + dy)
            }
          }
        })
      }, delay)
    }
    const onMouseUp = (event: MouseEvent) => {
      if (event.button === 0) offer({ x: event.clientX, y: event.clientY }, event.detail === 2 ? DOUBLE_CLICK_SETTLE_MS : 0)
    }
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.shiftKey || event.key === 'Shift') offer(null, 0)
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    window.addEventListener('mouseup', onMouseUp)
    document.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', close)
    return () => {
      close()
      document.removeEventListener('pointerdown', onPointerDown, true)
      window.removeEventListener('mouseup', onMouseUp)
      document.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', close)
    }
  }, [rootRef])

  return (
    <Popover open={request !== null} onOpenChange={(open) => !open && setRequest(null)}>
      <PopoverAnchor virtualRef={virtualRef} />
      {request ? (
        <PopoverContent
          ref={contentRef}
          align="start"
          side="top"
          sideOffset={6}
          collisionPadding={8}
          hideWhenDetached
          className="w-auto"
          onOpenAutoFocus={(event) => event.preventDefault()}
          onCloseAutoFocus={(event) => event.preventDefault()}
          // Keeps the selection, and the focus, where they are until the quote is taken.
          onMouseDown={(event) => event.preventDefault()}
        >
          <div className="flex items-center gap-0.5 p-0.5">
            <Button
              variant="ghost"
              size="xs"
              data-native-chat-quote
              onClick={() => {
                onQuote(formatNativeChatQuote(request.text))
                setRequest(null)
              }}
            >
              <Quote />
              {t('Add to chat')}
            </Button>
            {onAskInSideChat ? (
              <Button
                variant="ghost"
                size="xs"
                data-native-chat-ask-side
                onClick={() => {
                  onAskInSideChat(formatNativeChatQuote(request.text))
                  setRequest(null)
                }}
              >
                <MessagesSquare />
                {t('Ask in side chat')}
              </Button>
            ) : null}
          </div>
        </PopoverContent>
      ) : null}
    </Popover>
  )
}
