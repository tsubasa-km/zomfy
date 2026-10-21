import { homedir } from 'node:os'
import { join } from 'node:path'

/** `ACP_HARNESS_HOME` gives a preview or test daemon its own state, apart from the user's real one. */
export const HARNESS_HOME = process.env.ACP_HARNESS_HOME || join(homedir(), '.acp-harness')

/** Same shape as Orca's default `~/orca/workspaces/<repo>/<name>`. */
export const WORKSPACE_ROOT = process.env.ACP_HARNESS_HOME
  ? join(process.env.ACP_HARNESS_HOME, 'workspaces')
  : join(homedir(), 'acp-harness', 'workspaces')
