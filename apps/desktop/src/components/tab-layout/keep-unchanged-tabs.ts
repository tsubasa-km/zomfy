import type { WorkspaceTab } from './workspace-tab-model'

/** What a tab shows, compared by identity: the store keeps an unchanged chat's or terminal's object. */
function tabContent(tab: WorkspaceTab): unknown {
  switch (tab.kind) {
    case 'start':
      return null
    case 'chat':
      return tab.session
    case 'terminal':
      return tab.terminal
    case 'editor':
      return tab.editor
    case 'browser':
      return tab.browser
    case 'panel':
      return tab.panel
  }
}

/**
 * The fresh list with every tab that did not change taken from the last one, and the last list
 * itself when nothing did: a change to one tab (a terminal's title) leaves the others' views alone.
 */
export function keepUnchangedTabs(previous: WorkspaceTab[], fresh: WorkspaceTab[]): WorkspaceTab[] {
  const byId = new Map(previous.map((tab) => [tab.id, tab]))
  const tabs = fresh.map((tab) => {
    const old = byId.get(tab.id)
    return old && old.kind === tab.kind && old.createdAt === tab.createdAt && tabContent(old) === tabContent(tab) ? old : tab
  })
  return tabs.length === previous.length && tabs.every((tab, i) => tab === previous[i]) ? previous : tabs
}
