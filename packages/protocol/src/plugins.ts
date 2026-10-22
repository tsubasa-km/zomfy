// Orca's plugin manifest v1 (`orca-plugin.json`, shared/plugins/plugin-manifest.ts), as far as the
// harness honours it: right-sidebar panels, palette commands that alias built-in actions, and
// keybindings for them. Plugins are local folders under this computer's harness home; nothing is
// downloaded and no plugin code runs outside its sandboxed panel frame.

export const PLUGIN_MANIFEST_FILENAME = 'orca-plugin.json'

/** Orca's v0 capability kinds; the harness grants the panel-callable ones it implements. */
export const PLUGIN_CAPABILITY_KINDS = [
  'workspace:read',
  'terminal:send',
  'notifications:show',
  'storage',
  'secrets',
  'events:subscribe',
  'settings:own'
] as const

export type PluginCapabilityKind = (typeof PLUGIN_CAPABILITY_KINDS)[number]

export interface PluginPanelContribution {
  id: string
  title: string
  /** Lucide icon name for the right-sidebar activity bar. */
  icon?: string
  /** HTML entry rendered inside a sandboxed frame. */
  entry: string
}

export interface PluginCommandContribution {
  id: string
  title: string
  context?: 'global' | 'worktree'
  /** Built-in action alias; commands without one need Orca's plugin worker, which the harness lacks. */
  action?: string
}

export interface PluginKeybindingContribution {
  command: string
  key: string
  when?: 'global' | 'worktree'
}

export interface PluginManifest {
  manifestVersion: 1
  id: string
  publisher: string
  name: string
  version: string
  description?: string
  author?: { name: string; url?: string }
  repository?: string
  /** Node worker entry; listed so the user knows, never run here. */
  main?: string
  contributes: {
    panels: PluginPanelContribution[]
    commands: PluginCommandContribution[]
    keybindings: PluginKeybindingContribution[]
  }
  capabilities: { kind: PluginCapabilityKind }[]
}

export type PluginStatus = 'enabled' | 'disabled' | 'needs-review' | 'invalid'

export interface PluginListEntry {
  /** `<publisher>.<id>`, or the folder name when the manifest is unreadable. */
  pluginKey: string
  rootDir: string
  status: PluginStatus
  error?: string
  manifest?: PluginManifest
  /** What enabling consents to (capabilities + contributions); a change asks for review again. */
  consentFingerprint?: string
}

export interface PluginsSnapshot {
  /** Folder the user drops plugin folders into. */
  pluginsDir: string
  plugins: PluginListEntry[]
}

export const PLUGIN_METHODS = {
  pluginsList: '_harness/plugins/list',
  pluginSetEnabled: '_harness/plugins/set-enabled',
  pluginPanelRead: '_harness/plugins/panel'
} as const

export const PLUGIN_NOTIFICATIONS = {
  pluginsChanged: '_harness/plugins/changed'
} as const

export interface PluginRequests {
  [PLUGIN_METHODS.pluginsList]: { params: { refresh?: boolean }; result: PluginsSnapshot }
  /** Enabling must name the fingerprint the user reviewed, so a manifest changed meanwhile is refused. */
  [PLUGIN_METHODS.pluginSetEnabled]: {
    params: { pluginKey: string; enabled: boolean; consentFingerprint?: string }
    result: PluginsSnapshot
  }
  /** Issues a daemon URL path serving the panel under its own CSP, themed like the app. */
  [PLUGIN_METHODS.pluginPanelRead]: {
    params: { pluginKey: string; panelId: string; theme?: { scheme: 'dark' | 'light'; tokensCss: string } }
    result: { path: string }
  }
}
