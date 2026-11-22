import { createExternalStore } from './external-store'

// The sidebar on the right of each split pane (components/tab-layout/PaneSidebar.tsx): whether it
// is open, which panel it shows and how wide it is, kept across restarts (docs/specs/pane-sidebars.md).
// A pane is named by its tab layout (stores/tab-layout-store tabScope) and its group id there, so
// the main window's panes, the floating panel's and a pop-out window's each keep their own.

export interface PaneSidebarState {
  open: boolean
  /** A panel id from components/tab-layout/workspace-panels.tsx. */
  panel: string
  /** The width it was dragged to; unset, the shared initial width. */
  width?: number
}

const STORAGE_KEY = 'zomfy.pane-sidebars.v1'
const DEFAULT: PaneSidebarState = { open: false, panel: 'panel:explorer' }
const SEPARATOR = '#'

/** The key of one pane's sidebar. Keys without the separator are the old one-per-layout sidebars. */
export function paneSidebarKey(scope: string, groupId: string): string {
  return `${scope}${SEPARATOR}${groupId}`
}

function readSaved(): Record<string, PaneSidebarState> {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}')
    return typeof raw === 'object' && raw !== null ? (raw as Record<string, PaneSidebarState>) : {}
  } catch {
    return {}
  }
}

const store = createExternalStore<Record<string, PaneSidebarState>>(readSaved(), (state) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch {
    // Storage can be unavailable; the sidebars then start closed next time.
  }
})

export function usePaneSidebar(key: string): PaneSidebarState {
  return store.use((state) => state[key] ?? DEFAULT)
}

export function getPaneSidebar(key: string): PaneSidebarState {
  return store.get()[key] ?? DEFAULT
}

function update(key: string, change: Partial<PaneSidebarState>): void {
  store.update((state) => ({ ...state, [key]: { ...(state[key] ?? DEFAULT), ...change } }))
}

/** Opens the pane's sidebar, on `panel` when given. */
export function showPaneSidebar(key: string, panel?: string): void {
  update(key, panel ? { open: true, panel } : { open: true })
}

export function hidePaneSidebar(key: string): void {
  update(key, { open: false })
}

/** Without `panel`, flips it; with one, shows that panel, or closes when it already shows it. */
export function togglePaneSidebar(key: string, panel?: string): void {
  const current = getPaneSidebar(key)
  if (current.open && (!panel || current.panel === panel)) hidePaneSidebar(key)
  else showPaneSidebar(key, panel)
}

/** Without a width, back to the initial one. */
export function setPaneSidebarWidth(key: string, width?: number): void {
  store.update((state) => {
    const { width: _old, ...rest } = state[key] ?? DEFAULT
    return { ...state, [key]: width === undefined ? rest : { ...rest, width } }
  })
}

/**
 * The entries of `scope`'s panes after its layout changed: those of panes that are gone are
 * dropped, and the old single sidebar of the layout (keyed by `scope` alone) moves to the focused
 * pane, unless that pane has one already. Unchanged, the same object comes back.
 */
export function prunePaneSidebars(
  state: Record<string, PaneSidebarState>,
  scope: string,
  groupIds: readonly string[],
  focusedGroupId: string
): Record<string, PaneSidebarState> {
  const prefix = scope + SEPARATOR
  const live = new Set(groupIds.map((id) => prefix + id))
  const legacy = state[scope]
  let changed = legacy !== undefined
  const next: Record<string, PaneSidebarState> = {}
  for (const [key, value] of Object.entries(state)) {
    if (key === scope) continue
    if (key.startsWith(prefix) && !live.has(key)) {
      changed = true
      continue
    }
    next[key] = value
  }
  const focused = paneSidebarKey(scope, focusedGroupId)
  if (legacy && live.has(focused) && !next[focused]) next[focused] = legacy
  return changed ? next : state
}

export function syncPaneSidebars(scope: string, groupIds: readonly string[], focusedGroupId: string): void {
  const state = store.get()
  const next = prunePaneSidebars(state, scope, groupIds, focusedGroupId)
  if (next !== state) store.update(() => next)
}
