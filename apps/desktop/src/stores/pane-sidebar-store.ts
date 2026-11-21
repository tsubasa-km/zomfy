import { createExternalStore } from './external-store'
import { tabScope } from './tab-layout-store'

// The sidebar on the right of a set of tabs (components/tab-layout/PaneSidebar.tsx): whether it is
// open and which panel it shows, kept across restarts. The main window has one for all the
// workspaces whose tabs it holds, so switching tabs changes what the sidebar shows and not whether
// it is there; the floating panel and a pop-out window each have their own.

export interface PaneSidebarState {
  open: boolean
  /** A panel id from components/tab-layout/workspace-panels.tsx. */
  panel: string
}

const STORAGE_KEY = 'zomfy.pane-sidebars.v1'
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
  return store.use((state) => state[tabScope(workspaceId)] ?? DEFAULT)
}

function update(workspaceId: string, change: Partial<PaneSidebarState>): void {
  const key = tabScope(workspaceId)
  store.update((state) => ({ ...state, [key]: { ...(state[key] ?? DEFAULT), ...change } }))
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
  const current = store.get()[tabScope(workspaceId)] ?? DEFAULT
  if (current.open && (!panel || current.panel === panel)) hidePaneSidebar(workspaceId)
  else showPaneSidebar(workspaceId, panel)
}
