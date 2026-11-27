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

/**
 * The tabs a pane shows (docs/specs/panes-as-workspaces.md, "One workspace's tabs at a time"): those
 * of its context's workspace, and those of no workspace (`contextOf` null, or a workspace that cannot
 * be a context), which show in every set. The pane's other tabs stay in it, hidden.
 */
export function paneTabSet<T>(
  tabs: readonly T[],
  contextOf: (tab: T) => string | null,
  context: string | null,
  carries: (workspaceId: string) => boolean
): T[] {
  return tabs.filter((tab) => {
    const own = contextOf(tab)
    return own === null || !carries(own) || own === context
  })
}

/**
 * The tab a pane brings to the front when its front tab closes: the most recently shown one of the
 * same set (its workspace's, or of no workspace), else the most recently shown one at all.
 * `recent` runs oldest to most recent, without the closed tab.
 */
export function nextFrontTab(closedSet: string | null, recent: readonly string[], setOf: (tabId: string) => string | null): string | null {
  if (closedSet !== null) {
    for (let i = recent.length - 1; i >= 0; i--) {
      const set = setOf(recent[i]!)
      if (set === closedSet || set === null) return recent[i]!
    }
  }
  return recent.at(-1) ?? null
}
