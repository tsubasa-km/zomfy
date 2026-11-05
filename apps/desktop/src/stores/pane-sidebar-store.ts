import { createExternalStore } from './external-store'

// Each workspace pane's own sidebar on its right (components/tab-layout/PaneSidebar.tsx): whether it
// is open and which panel it shows, by workspace, kept across restarts.

export interface PaneSidebarState {
  open: boolean
  /** A panel id from components/tab-layout/workspace-panels.tsx. */
  panel: string
}

const STORAGE_KEY = 'acp-harness.pane-sidebars.v1'
const DEFAULT: PaneSidebarState = { open: false, panel: 'panel:explorer' }

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

export function usePaneSidebar(workspaceId: string): PaneSidebarState {
  return store.use((state) => state[workspaceId] ?? DEFAULT)
}

function update(workspaceId: string, change: Partial<PaneSidebarState>): void {
  store.update((state) => ({ ...state, [workspaceId]: { ...(state[workspaceId] ?? DEFAULT), ...change } }))
}

/** Opens the pane's sidebar, on `panel` when given. */
export function showPaneSidebar(workspaceId: string, panel?: string): void {
  update(workspaceId, panel ? { open: true, panel } : { open: true })
}

export function hidePaneSidebar(workspaceId: string): void {
  update(workspaceId, { open: false })
}

/** Without `panel`, flips it; with one, shows that panel, or closes when it already shows it. */
export function togglePaneSidebar(workspaceId: string, panel?: string): void {
  const current = store.get()[workspaceId] ?? DEFAULT
  if (current.open && (!panel || current.panel === panel)) hidePaneSidebar(workspaceId)
  else showPaneSidebar(workspaceId, panel)
}
