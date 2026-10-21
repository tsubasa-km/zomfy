import { createExternalStore } from './external-store'

/** Window-level surfaces that cover the workspace view: settings page, Ctrl+P, command palette. */
export interface AppOverlays {
  settings: { open: boolean; section: string }
  /** Open when it names the workspace whose files Ctrl+P lists. */
  quickOpen: { open: boolean; workspaceId: string | null }
  commandPalette: boolean
}

const store = createExternalStore<AppOverlays>({
  settings: { open: false, section: 'general' },
  quickOpen: { open: false, workspaceId: null },
  commandPalette: false
})

export const useAppOverlays = store.use
export const getAppOverlays = store.get

/** Opens the settings page, optionally at a section id from settings-navigation. */
export function openSettings(section?: string): void {
  store.update((s) => ({
    ...s,
    quickOpen: { ...s.quickOpen, open: false },
    commandPalette: false,
    settings: { open: true, section: section ?? s.settings.section }
  }))
}

export function closeSettings(): void {
  store.update((s) => ({ ...s, settings: { ...s.settings, open: false } }))
}

export function selectSettingsSection(section: string): void {
  store.update((s) => ({ ...s, settings: { ...s.settings, section } }))
}

/** Opens Ctrl+P on a workspace's files, or closes it with null. */
export function setQuickOpen(workspaceId: string | null): void {
  store.update((s) => ({
    ...s,
    quickOpen: workspaceId ? { open: true, workspaceId } : { ...s.quickOpen, open: false },
    commandPalette: workspaceId ? false : s.commandPalette
  }))
}

export function setCommandPalette(open: boolean): void {
  store.update((s) => ({ ...s, commandPalette: open, quickOpen: open ? { ...s.quickOpen, open: false } : s.quickOpen }))
}
