import { createExternalStore } from './external-store'

export type CommandPaletteMode = 'all' | 'workspaces'

/** Window-level surfaces that cover the workspace view: settings page, Ctrl+P, command palette. */
export interface AppOverlays {
  settings: { open: boolean; section: string }
  /** Open when it names the workspace whose files Ctrl+P lists. */
  quickOpen: { open: boolean; workspaceId: string | null }
  commandPalette: boolean
  /** 'workspaces' is Orca's worktree palette (sidebar Search, Switch Workspace): commands are left out. */
  commandPaletteMode: CommandPaletteMode
  /** Orca's Skills page, which also replaces the app view. */
  skills: boolean
  /** Orca's first-run flow; reopened from Settings › General. */
  onboarding: boolean
  /** The guided tour over the live window. */
  tour: boolean
}

const store = createExternalStore<AppOverlays>({
  settings: { open: false, section: 'general' },
  quickOpen: { open: false, workspaceId: null },
  commandPalette: false,
  commandPaletteMode: 'all',
  skills: false,
  onboarding: false,
  tour: false
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

export function setCommandPalette(open: boolean, mode: CommandPaletteMode = 'all'): void {
  store.update((s) => ({
    ...s,
    commandPalette: open,
    commandPaletteMode: open ? mode : s.commandPaletteMode,
    quickOpen: open ? { ...s.quickOpen, open: false } : s.quickOpen
  }))
}

export function setSkillsPageOpen(open: boolean): void {
  store.update((s) => ({ ...s, skills: open, settings: open ? { ...s.settings, open: false } : s.settings, commandPalette: false }))
}

export function setOnboardingOpen(open: boolean): void {
  store.update((s) => ({ ...s, onboarding: open, settings: open ? { ...s.settings, open: false } : s.settings, commandPalette: false }))
}

/** The tour lights up the workspace view, so the pages covering it close first. */
export function setTourOpen(open: boolean): void {
  store.update((s) => ({
    ...s,
    tour: open,
    ...(open ? { settings: { ...s.settings, open: false }, skills: false, commandPalette: false, quickOpen: { ...s.quickOpen, open: false } } : {})
  }))
}
