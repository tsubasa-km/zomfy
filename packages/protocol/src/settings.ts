/**
 * Settings the daemon must know, kept per host under the harness home. UI preferences live in
 * the desktop's own settings store instead; only what a host acts on belongs here.
 */
export interface HostSettings {
  /** Shell new terminal tabs start with on this host; null uses the first detected shell. */
  defaultShellId: string | null
  /** Claude Code CLI the agent runs; null finds `claude` on PATH. */
  claudeExecutablePath: string | null
}

export const DEFAULT_HOST_SETTINGS: HostSettings = {
  defaultShellId: null,
  claudeExecutablePath: null
}

export const SETTINGS_METHODS = {
  settingsGet: '_harness/settings/get',
  settingsUpdate: '_harness/settings/update'
} as const

export const SETTINGS_NOTIFICATIONS = {
  /** Every client of the host hears the full settings after any change. */
  settingsChanged: '_harness/settings/changed'
} as const

export interface SettingsRequests {
  [SETTINGS_METHODS.settingsGet]: { params: Record<string, never>; result: HostSettings }
  [SETTINGS_METHODS.settingsUpdate]: { params: { patch: Partial<HostSettings> }; result: HostSettings }
}
