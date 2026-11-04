import { createExternalStore } from './external-store'

// What used to open the right sidebar (a shortcut, a side chat, a checks badge) now opens a panel in
// the pull-down drawer of the pane showing that workspace. The focused pane's drawer takes the
// request and clears it, so a drawer that mounts a moment later (a workspace just selected) still does.

export type DrawerAction = 'show' | 'hide' | 'toggle'

export interface DrawerRequest {
  workspaceId: string
  /** A drawer panel id (`panel:explorer`, `plugin:<tab>`); null keeps the panel it shows. */
  panel: string | null
  action: DrawerAction
}

const store = createExternalStore<DrawerRequest | null>(null)

export const useDrawerRequest = store.use

export function requestDrawer(workspaceId: string, panel: string | null, action: DrawerAction): void {
  store.set({ workspaceId, panel, action })
}

/** Called by the drawer that acted on it. */
export function takeDrawerRequest(request: DrawerRequest): void {
  if (store.get() === request) store.set(null)
}
