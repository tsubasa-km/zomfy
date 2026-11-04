import { createExternalStore } from './external-store'

/** A workspace panel (explorer, source control, a plugin's…) opened as a tab; like browser tabs, it lives in this window. */
export interface PanelTab {
  id: string
  workspaceId: string
  createdAt: number
  /** The panel it shows (components/tab-layout/workspace-panels.tsx). */
  panel: string
}

const STORAGE_KEY = 'acp-harness.panel-tabs.v1'

function readSaved(): PanelTab[] {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]')
    return Array.isArray(raw) ? (raw as PanelTab[]) : []
  } catch {
    return []
  }
}

const store = createExternalStore<PanelTab[]>(readSaved(), (tabs) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(tabs))
  } catch {
    // Storage can be unavailable; panel tabs then do not survive a restart.
  }
})

export const usePanelTabs = (): PanelTab[] => store.use((tabs) => tabs)

export function addPanelTab(workspaceId: string, panel: string): PanelTab {
  const tab: PanelTab = { id: `paneltab:${crypto.randomUUID()}`, workspaceId, createdAt: Date.now(), panel }
  store.update((tabs) => [...tabs, tab])
  return tab
}

/** The workspace's tab already showing `panel`, if one is open. */
export function panelTabOf(workspaceId: string, panel: string): PanelTab | undefined {
  return store.get().find((t) => t.workspaceId === workspaceId && t.panel === panel)
}

export function removePanelTabs(ids: string[]): void {
  const gone = new Set(ids)
  if (store.get().some((t) => gone.has(t.id))) store.update((tabs) => tabs.filter((t) => !gone.has(t.id)))
}
