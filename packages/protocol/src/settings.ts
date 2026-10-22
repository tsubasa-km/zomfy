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

/** The Claude Code CLI a host runs turns with, against the version the daemon's Agent SDK targets. */
export interface ClaudeCliStatus {
  /** null when no `claude` was found, so turns use the SDK's bundled copy. */
  path: string | null
  /** From `claude --version`; null when it would not run. */
  version: string | null
  expected: string
  /** `version` is older than `expected`: newer SDK options may fail or be ignored. */
  outdated: boolean
}

export interface ClaudeCliUpdateResult {
  status: ClaudeCliStatus
  ok: boolean
  /** What `claude update` printed, for when it fails. */
  output: string
}

export const SETTINGS_METHODS = {
  settingsGet: '_harness/settings/get',
  settingsUpdate: '_harness/settings/update',
  claudeCliStatus: '_harness/settings/claudeCli',
  claudeCliUpdate: '_harness/settings/claudeCliUpdate'
} as const

export const SETTINGS_NOTIFICATIONS = {
  /** Every client of the host hears the full settings after any change. */
  settingsChanged: '_harness/settings/changed'
} as const

export interface SettingsRequests {
  [SETTINGS_METHODS.settingsGet]: { params: Record<string, never>; result: HostSettings }
  [SETTINGS_METHODS.settingsUpdate]: { params: { patch: Partial<HostSettings> }; result: HostSettings }
  [SETTINGS_METHODS.claudeCliStatus]: { params: Record<string, never>; result: ClaudeCliStatus }
  [SETTINGS_METHODS.claudeCliUpdate]: { params: Record<string, never>; result: ClaudeCliUpdateResult }
}
