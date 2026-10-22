import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

/** `ACP_HARNESS_HOME` gives a preview or test daemon its own state, apart from the user's real one. */
export const HARNESS_HOME = process.env.ACP_HARNESS_HOME || join(homedir(), '.acp-harness')

/** Same shape as Orca's default `~/orca/workspaces/<repo>/<name>`. */
export const WORKSPACE_ROOT = process.env.ACP_HARNESS_HOME
  ? join(process.env.ACP_HARNESS_HOME, 'workspaces')
  : join(homedir(), 'acp-harness', 'workspaces')

/** Orca's `~/orca`: clones land here, beside the workspaces. */
export const CLONE_ROOT = dirname(WORKSPACE_ROOT)

/** Orca's `~/orca/projects`, where "Create new project" puts new repositories. */
export const PROJECTS_ROOT = join(CLONE_ROOT, 'projects')
