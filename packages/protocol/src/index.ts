// Harness extension methods carried over the ACP connection. ACP reserves `_`-prefixed method
// names for extensions, so these never collide with protocol methods. Each area keeps its types,
// method names and request shapes in its own file; this one only composes them.

import { FILE_METHODS, type FileRequests } from './files'
import { GIT_METHODS, type GitRequests } from './git'
import { QUICK_OPEN_METHODS, type QuickOpenRequests } from './quick-open'
import { SESSION_METHODS, type SessionRequests } from './sessions'
import { SETTINGS_METHODS, type SettingsRequests } from './settings'
import { TERMINAL_METHODS, type TerminalRequests } from './terminals'
import { WORKSPACE_METHODS, type WorkspaceRequests } from './workspaces'

export * from './files'
export * from './git'
export * from './quick-open'
export * from './sessions'
export * from './settings'
export * from './terminals'
export * from './workspaces'

export const HARNESS_METHODS = {
  ...WORKSPACE_METHODS,
  ...SESSION_METHODS,
  ...TERMINAL_METHODS,
  ...FILE_METHODS,
  ...GIT_METHODS,
  ...SETTINGS_METHODS,
  ...QUICK_OPEN_METHODS
} as const

export const HARNESS_NOTIFICATIONS = {
  stateChanged: '_harness/state/changed',
  sessionsChanged: '_harness/sessions/changed',
  terminalsChanged: '_harness/terminals/changed',
  terminalOutput: '_harness/terminals/output'
} as const

export interface HarnessRequests
  extends WorkspaceRequests,
    SessionRequests,
    TerminalRequests,
    FileRequests,
    GitRequests,
    SettingsRequests,
    QuickOpenRequests {}

export type HarnessMethod = keyof HarnessRequests
