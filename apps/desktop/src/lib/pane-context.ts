// The workspace a split pane of the window works in (docs/specs/panes-as-workspaces.md): the one of
// the tab it has in front. Pure, so tests can run it.

export interface PaneContextInput {
  /** The workspace of the tab in front; null when that tab carries none. */
  front: string | null | undefined
  /** The context the pane had last, while the window has been open. */
  last: string | null | undefined
  /** The workspaces of the pane's other tabs, the most recently shown first. */
  others: readonly (string | null | undefined)[]
}

/**
 * The pane's context: the front tab's workspace when it carries one, else the last one the pane
 * had, else that of its most recently shown tab that carries one, else none. `carries` says whether
 * a workspace can be a context: in the window now and a project's (not a quick thread's).
 */
export function resolvePaneContext(input: PaneContextInput, carries: (workspaceId: string) => boolean): string | null {
  const ok = (id: string | null | undefined): id is string => typeof id === 'string' && carries(id)
  if (ok(input.front)) return input.front
  if (ok(input.last)) return input.last
  return input.others.find(ok) ?? null
}
