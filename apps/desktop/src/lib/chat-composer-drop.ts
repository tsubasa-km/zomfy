import type { DropTarget } from '@/lib/pointer-drag'

// The chat composer takes dropped tabs and explorer files itself: a drag released over
// `[data-chat-composer-drop]` dispatches a bubbling event there instead of moving anything, and
// `data-tab-drop-hover` marks the composer while the drag is over it.

export const CHAT_COMPOSER_DROP_SELECTOR = '[data-chat-composer-drop]'
const HOVER_ATTRIBUTE = 'data-tab-drop-hover'

export function chatComposerDropTarget<T>(eventName: string, details: (payload: T) => object[]): DropTarget<T> {
  let hovered: HTMLElement | null = null
  const clear = () => {
    hovered?.removeAttribute(HOVER_ATTRIBUTE)
    hovered = null
  }
  return {
    accepts: () => true,
    over: (_payload, { element }) => {
      if (hovered === element) return
      clear()
      hovered = element
      element.setAttribute(HOVER_ATTRIBUTE, '')
    },
    leave: clear,
    drop: (payload, { element }) => {
      for (const detail of details(payload)) element.dispatchEvent(new CustomEvent(eventName, { bubbles: true, detail }))
    }
  }
}
