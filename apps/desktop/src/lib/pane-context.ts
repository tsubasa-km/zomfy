// The workspace a split pane of the window works in (docs/specs/panes-as-workspaces.md). Pure, so
// tests can run it.

export interface PaneContext {
  /** The workspace the pane acts on; null for no project. */
  context: string | null
  /** A workspace to keep as the pane's context from now on, when it had none set; else null. */
  settle: string | null
}

/**
 * `stored` is the pane's saved context (null: no project, undefined: not set). `candidates` are, in
 * order, the workspaces of the tab it shows, of its other tabs, and of the New thread tab when it
 * holds that. A saved workspace that is not in the window now (its host not yet back, popped out,
 * deleted) is not overwritten: the pane acts on its first candidate meanwhile.
 */
export function resolvePaneContext(
  stored: string | null | undefined,
  candidates: readonly (string | null | undefined)[],
  live: (workspaceId: string) => boolean
): PaneContext {
  if (stored === null) return { context: null, settle: null }
  if (stored !== undefined && live(stored)) return { context: stored, settle: null }
  const first = candidates.find((id): id is string => typeof id === 'string' && live(id)) ?? null
  return { context: first, settle: stored === undefined ? first : null }
}
