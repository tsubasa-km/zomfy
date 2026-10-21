import { useSyncExternalStore, type ReactNode } from 'react'

// Slots for Orca-style status bar segments. Areas add their own (ports, git sync, usage…) with
// registerStatusBarItem at module load; the bar's context menu lets the user hide any of them.

export interface StatusBarItem {
  id: string
  /** Name in the right-click visibility menu. */
  label: string
  side: 'left' | 'right'
  /** Lower comes first within its side. */
  order: number
  /** Kept visible even when the user hides others (settings entry). */
  pinned?: boolean
  render: () => ReactNode
}

let items: readonly StatusBarItem[] = []
const listeners = new Set<() => void>()

export function registerStatusBarItem(item: StatusBarItem): () => void {
  items = [...items.filter((i) => i.id !== item.id), item].sort((a, b) => a.order - b.order)
  for (const listener of listeners) listener()
  return () => {
    items = items.filter((i) => i !== item)
    for (const listener of listeners) listener()
  }
}

export function useStatusBarItems(): readonly StatusBarItem[] {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => items
  )
}
