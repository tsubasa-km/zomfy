import { createExternalStore } from './external-store'

// UI preferences for this window, persisted in localStorage. Defaults follow Orca's
// (shared/default-global-settings.ts). Settings a daemon acts on live in host-settings-store.

export type ThemePreference = 'system' | 'dark' | 'light'
/** Orca's terminal shortcut policy: app shortcuts win inside terminals, or the terminal does. */
export type TerminalShortcutPolicy = 'orca-first' | 'terminal-first'
export type TerminalCursorStyle = 'block' | 'bar' | 'underline'
/** Which Enter sends a chat message; the other one inserts a newline. */
export type ChatSendKey = 'mod-enter' | 'enter'

/** Orca's floatingTerminalTriggerLocation: where the floating workspace toggle lives. */
export type FloatingWorkspaceTriggerLocation = 'floating-button' | 'status-bar'

export interface AppSettings {
  theme: ThemePreference
  /** Chromium-style zoom level: each step of 1 scales by 1.2. */
  uiZoomLevel: number
  /** Empty keeps the bundled Geist. */
  appFontFamily: string
  terminalFontFamily: string
  terminalFontSize: number
  terminalLineHeight: number
  terminalCursorStyle: TerminalCursorStyle
  terminalCursorBlink: boolean
  terminalScrollbackRows: number
  terminalShortcutPolicy: TerminalShortcutPolicy
  /** Empty follows the terminal font, as in Orca. */
  editorFontFamily: string
  editorFontSize: number
  editorWordWrap: boolean
  editorMinimap: boolean
  notificationsEnabled: boolean
  notifyAgentFinished: boolean
  notifyAgentNeedsYou: boolean
  notifySuppressWhenFocused: boolean
  statusBarVisible: boolean
  /** Status bar item ids the user hid from its context menu. */
  statusBarHiddenItems: string[]
  /** Keybinding overrides by command id; an empty list disables the command's shortcut. */
  keybindings: Record<string, string[]>
  /** Orca's opt-in Skills button in the sidebar. */
  showSkillsButton: boolean
  /** Sidebar nav rows, each hideable from its context menu (Orca's show*Button settings). */
  showTasksButton: boolean
  showNewChatButton: boolean
  showAutomationsButton: boolean
  showAgentDashboardButton: boolean
  /** The onboarding checklist row was hidden from the sidebar. */
  setupGuideSidebarDismissed: boolean
  /** Orca's floatingTerminalEnabled. */
  floatingWorkspaceEnabled: boolean
  floatingWorkspaceTriggerLocation: FloatingWorkspaceTriggerLocation
  /** Agent new chats start with (Orca's defaultTuiAgent); 'claude' unless onboarding or settings pick another. */
  defaultChatAgent: string
  /** Host new chats and projects start on: 'auto' (where most projects are) or a host id. */
  defaultHost: string
  /** First-run flow finished or skipped; settings can reopen it. */
  onboardingDone: boolean
  /** Windows: closing the window hides it to the tray instead of quitting (Orca's minimizeToTrayOnClose). */
  minimizeToTrayOnClose: boolean
  /** Composer dictation, sent only to the transcription endpoint configured below. */
  voiceDictationEnabled: boolean
  /** OpenAI-compatible `/audio/transcriptions` base URL, e.g. https://api.openai.com/v1 or a local server. */
  dictationEndpoint: string
  dictationModel: string
  dictationApiKey: string
  /** Empty lets the service detect the language. */
  dictationLanguage: string
  /** Cmd/Ctrl+Enter by default, so Enter and Shift+Enter both write newlines in the markdown composer. */
  chatSendKey: ChatSendKey
  /** Experimental: a markdown memo per chat, kept by the session's host. */
  chatMemosEnabled: boolean
}

export const DEFAULT_SETTINGS: AppSettings = {
  theme: 'system',
  uiZoomLevel: 0,
  appFontFamily: '',
  terminalFontFamily: '',
  terminalFontSize: 14,
  terminalLineHeight: 1,
  terminalCursorStyle: 'block',
  terminalCursorBlink: true,
  terminalScrollbackRows: 5_000,
  terminalShortcutPolicy: 'orca-first',
  editorFontFamily: '',
  editorFontSize: 13,
  editorWordWrap: true,
  editorMinimap: false,
  notificationsEnabled: true,
  notifyAgentFinished: true,
  notifyAgentNeedsYou: true,
  notifySuppressWhenFocused: true,
  statusBarVisible: true,
  statusBarHiddenItems: [],
  keybindings: {},
  showSkillsButton: false,
  showTasksButton: true,
  showNewChatButton: true,
  showAutomationsButton: true,
  showAgentDashboardButton: true,
  setupGuideSidebarDismissed: false,
  floatingWorkspaceEnabled: true,
  floatingWorkspaceTriggerLocation: 'floating-button',
  defaultChatAgent: 'claude',
  defaultHost: 'auto',
  onboardingDone: false,
  minimizeToTrayOnClose: false,
  voiceDictationEnabled: false,
  dictationEndpoint: '',
  dictationModel: 'whisper-1',
  dictationApiKey: '',
  dictationLanguage: '',
  chatSendKey: 'mod-enter',
  chatMemosEnabled: true
}

export type SettingKey = keyof AppSettings

const STORAGE_KEY = 'acp-harness.settings.v1'

function readSaved(): AppSettings {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}')
    if (!saved || typeof saved !== 'object') return { ...DEFAULT_SETTINGS }
    // Drop keys whose type no longer matches, so a stale value cannot break a reader.
    const merged: Record<string, unknown> = { ...DEFAULT_SETTINGS }
    for (const [key, value] of Object.entries(saved)) {
      const fallback = (DEFAULT_SETTINGS as unknown as Record<string, unknown>)[key]
      if (fallback !== undefined && typeof value === typeof fallback && Array.isArray(value) === Array.isArray(fallback)) {
        merged[key] = value
      }
    }
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: every key comes from DEFAULT_SETTINGS with a value of the same runtime type.
    return merged as unknown as AppSettings
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

const store = createExternalStore<AppSettings>(readSaved(), (state) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch {
    // Storage can be unavailable; settings then last for this window only.
  }
})

export function getSettings(): AppSettings {
  return store.get()
}

export function getSetting<K extends SettingKey>(key: K): AppSettings[K] {
  return store.get()[key]
}

export function setSetting<K extends SettingKey>(key: K, value: AppSettings[K]): void {
  if (Object.is(store.get()[key], value)) return
  store.update((s) => ({ ...s, [key]: value }))
}

export function setSettings(patch: Partial<AppSettings>): void {
  store.update((s) => ({ ...s, ...patch }))
}

export function resetSetting(key: SettingKey): void {
  setSetting(key, DEFAULT_SETTINGS[key])
}

export function resetAllSettings(): void {
  store.set({ ...DEFAULT_SETTINGS })
}

/** One setting as React state; the component re-renders only when that value changes. */
export function useSetting<K extends SettingKey>(key: K): AppSettings[K] {
  return store.use((s) => s[key])
}

/** Selector form, for derived values; return a stable value (primitive or stored object). */
export function useSettings<T>(select: (s: AppSettings) => T): T {
  return store.use(select)
}

/** Fires after any change, with the new and previous settings; returns an unsubscribe. */
export function onSettingsChange(listener: (next: AppSettings, previous: AppSettings) => void): () => void {
  let previous = store.get()
  return store.subscribe(() => {
    const next = store.get()
    const before = previous
    previous = next
    listener(next, before)
  })
}
