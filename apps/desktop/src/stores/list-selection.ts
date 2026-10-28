import { createExternalStore } from './external-store'

// Orca's list gestures, shared by workspace cards, tabs and sidebar chats: Ctrl/Cmd toggles one item,
// Shift extends from the anchor; a plain click clears.

export type Selection = { ids: string[]; anchor: string | null }
export type Gesture = { toggle: boolean; range: boolean }

export const IS_MAC = typeof navigator !== 'undefined' && navigator.userAgent.includes('Mac')

/** The gesture a click makes, or null for a plain click. */
export function gestureOf(e: { metaKey: boolean; ctrlKey: boolean; shiftKey: boolean }): Gesture | null {
  const toggle = IS_MAC ? e.metaKey : e.ctrlKey
  return toggle || e.shiftKey ? { toggle, range: e.shiftKey } : null
}

/** `order` is the items as drawn, for Shift ranges; the open item joins the first Ctrl-click so two clicks make a pair. */
export function nextSelection(current: Selection, id: string, gesture: Gesture, activeId: string | null, order: string[]): Selection {
  if (gesture.range) {
    const anchor = current.anchor ?? activeId ?? id
    const from = order.indexOf(anchor)
    const to = order.indexOf(id)
    if (from !== -1 && to !== -1) {
      const range = order.slice(Math.min(from, to), Math.max(from, to) + 1)
      return { ids: gesture.toggle ? [...new Set([...current.ids, ...range])] : range, anchor }
    }
  }
  const base = current.ids.length === 0 && activeId && activeId !== id ? [activeId] : current.ids
  return { ids: base.includes(id) ? base.filter((v) => v !== id) : [...base, id], anchor: id }
}

/** A selection of one list's items; `scope` (a tab group, say) resets it when the click lands elsewhere. */
export function createListSelection() {
  const store = createExternalStore<Selection & { scope: string | null }>({ ids: [], anchor: null, scope: null })
  return {
    get: store.get,
    use: store.use,
    gesture(scope: string, id: string, gesture: Gesture, activeId: string | null, order: string[]): void {
      const current = store.get().scope === scope ? store.get() : { ids: [], anchor: null }
      store.set({ ...nextSelection(current, id, gesture, activeId, order), scope })
    },
    /** A plain click: nothing selected, and the clicked item anchors the next Shift range. */
    reset(scope: string | null = null, anchor: string | null = null): void {
      const s = store.get()
      if (s.ids.length === 0 && s.anchor === anchor && s.scope === scope) return
      store.set({ ids: [], anchor, scope })
    },
    /** The selected ids when `id` is one of them (an action on a selected item acts on all), else just `id`. */
    targets(id: string): string[] {
      const { ids } = store.get()
      return ids.length > 1 && ids.includes(id) ? ids : [id]
    }
  }
}

export const tabSelection = createListSelection()
export const chatSelection = createListSelection()
