import { createExternalStore } from './external-store'

// Widths the person dragged the sidebars to, kept across restarts. The left sidebar has one; the
// pane sidebars on the right share one, and the side chat (which wants more room) has its own.

export type SidebarWidthKey = 'left' | 'right' | 'right:side-chat'

export const SIDEBAR_WIDTHS: Record<SidebarWidthKey, { initial: number; min: number; max: number }> = {
  left: { initial: 280, min: 200, max: 520 },
  right: { initial: 300, min: 220, max: 720 },
  'right:side-chat': { initial: 420, min: 300, max: 900 }
}

const STORAGE_KEY = 'acp-harness.sidebar-widths.v1'

function readSaved(): Partial<Record<SidebarWidthKey, number>> {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}')
    return typeof raw === 'object' && raw !== null ? (raw as Partial<Record<SidebarWidthKey, number>>) : {}
  } catch {
    return {}
  }
}

const store = createExternalStore<Partial<Record<SidebarWidthKey, number>>>(readSaved(), (state) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch {
    // Storage can be unavailable; the widths then last for this session only.
  }
})

export function clampSidebarWidth(key: SidebarWidthKey, width: number): number {
  const { min, max } = SIDEBAR_WIDTHS[key]
  return Math.round(Math.min(max, Math.max(min, width)))
}

export function useSidebarWidth(key: SidebarWidthKey): number {
  return store.use((state) => clampSidebarWidth(key, state[key] ?? SIDEBAR_WIDTHS[key].initial))
}

/** Without a width, back to the initial one. */
export function setSidebarWidth(key: SidebarWidthKey, width?: number): void {
  store.update((state) => {
    const next = { ...state }
    if (width === undefined) delete next[key]
    else next[key] = clampSidebarWidth(key, width)
    return next
  })
}
