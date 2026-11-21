import { createExternalStore } from './external-store'

// How tall the person dragged the pull-down drawer (components/tab-layout/ToolDrawer.tsx), kept
// across restarts. Every drawer shares the one height, so a drawer pulled down under any tab is the
// size the last one was left at.

/** The least a drawer can be: its bar and a few lines of a terminal. */
export const DRAWER_MIN_HEIGHT = 192

const STORAGE_KEY = 'zomfy.drawer-height.v1'

function readSaved(): number | null {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null')
    return typeof raw === 'number' && Number.isFinite(raw) ? Math.max(DRAWER_MIN_HEIGHT, raw) : null
  } catch {
    return null
  }
}

const store = createExternalStore<number | null>(readSaved(), (height) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(height))
  } catch {
    // Storage can be unavailable; the height then lasts for this session only.
  }
})

/** The height in pixels, or null while the drawer keeps its own share of the pane. */
export const useDrawerHeight = (): number | null => store.use((height) => height)

/** Without a height, back to the drawer's own share of the pane. */
export function setDrawerHeight(height?: number): void {
  store.set(height === undefined ? null : Math.max(DRAWER_MIN_HEIGHT, Math.round(height)))
}
