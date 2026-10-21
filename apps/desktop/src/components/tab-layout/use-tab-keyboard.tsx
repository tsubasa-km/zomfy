import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { getTabLayoutState, type WorkspaceLayout } from '@/stores/tab-layout-store'
import { isFloating } from '@/session-store'
import { matchTabShortcut } from './tab-shortcuts'
import {
  activateTab,
  closeWorkspaceTabs,
  openBrowserTab,
  reopenClosedTab,
  tabTitle,
  type WorkspaceTab
} from './workspace-tab-model'
import { TabKindIcon } from './TabKindIcon'

export const RENAME_TAB_EVENT = 'acp-harness:rename-tab'

export function requestTabRename(tabId: string): void {
  window.dispatchEvent(new CustomEvent<string>(RENAME_TAB_EVENT, { detail: tabId }))
}

interface Switcher {
  items: WorkspaceTab[]
  selected: number
}

/**
 * Tab keyboard commands for one WorkspaceTabs surface. The surface holding focus handles them;
 * with focus elsewhere, the main (non-floating) one does.
 */
export function useTabKeyboard({
  workspaceId,
  rootRef,
  tabs,
  layout
}: {
  workspaceId: string
  rootRef: React.RefObject<HTMLElement | null>
  tabs: WorkspaceTab[]
  layout: WorkspaceLayout
}): React.ReactNode {
  const latest = useRef({ tabs, layout })
  latest.current = { tabs, layout }
  const [switcher, setSwitcherState] = useState<Switcher | null>(null)
  const switcherRef = useRef<Switcher | null>(null)
  const setSwitcher = (next: Switcher | null) => {
    switcherRef.current = next
    setSwitcherState(next)
  }

  useEffect(() => {
    const isTarget = () => {
      const root = rootRef.current
      if (!root) return false
      const focused = document.activeElement
      if (focused && root.contains(focused)) return true
      const owner = focused?.closest('[data-workspace-tabs]')
      return !owner && !isFloating(workspaceId)
    }
    const focusedGroupTabs = () => {
      const { layout, tabs } = latest.current
      const group = layout.groups[layout.focusedGroupId]
      if (!group) return { group: null, list: [] as WorkspaceTab[] }
      const byId = new Map(tabs.map((t) => [t.id, t]))
      return { group, list: group.tabOrder.flatMap((id) => byId.get(id) ?? []) }
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented && !switcherRef.current) return
      const action = matchTabShortcut(event)
      if (!action) {
        if (switcherRef.current && event.key === 'Escape') {
          event.preventDefault()
          event.stopPropagation()
          setSwitcher(null)
        }
        return
      }
      if (!isTarget()) return
      event.preventDefault()
      event.stopPropagation()
      if (event.repeat && action !== 'tab.recentSwitcher') return
      const { group, list } = focusedGroupTabs()
      const active = list.find((t) => t.id === group?.activeTabId) ?? null
      const step = (delta: number) => {
        if (!group || list.length === 0) return
        const index = active ? list.indexOf(active) : 0
        const next = list[(index + delta + list.length) % list.length]!
        activateTab(workspaceId, group.id, next.id)
      }
      switch (action) {
        case 'tab.close':
          if (active && !getTabLayoutState().meta[active.id]?.pinned) closeWorkspaceTabs(workspaceId, [active])
          break
        case 'tab.reopenClosed':
          void reopenClosedTab(workspaceId)
          break
        case 'tab.nextAllTypes':
          step(1)
          break
        case 'tab.previousAllTypes':
          step(-1)
          break
        case 'tab.newBrowser':
          openBrowserTab(workspaceId)
          break
        case 'tab.rename':
          if (active) requestTabRename(active.id)
          break
        case 'tab.selectByIndex': {
          const digit = Number(event.code.slice(-1))
          const target = digit === 9 ? list.at(-1) : list[digit - 1]
          if (group && target) activateTab(workspaceId, group.id, target.id)
          break
        }
        case 'tab.recentSwitcher': {
          // Orca's default Ctrl+Tab order is most-recently-used within the focused group.
          const direction = event.shiftKey ? -1 : 1
          const current = switcherRef.current
          if (current) {
            const n = current.items.length
            setSwitcher({ ...current, selected: (current.selected + direction + n) % n })
            break
          }
          if (!group || list.length < 2) break
          const byId = new Map(list.map((t) => [t.id, t]))
          const recent = [...group.recentTabIds].reverse().flatMap((id) => byId.get(id) ?? [])
          const items = [...recent, ...list.filter((t) => !recent.includes(t))]
          const start = active ? items.indexOf(active) : 0
          setSwitcher({ items, selected: (start + direction + items.length) % items.length })
          break
        }
      }
    }
    const commit = () => {
      const current = switcherRef.current
      if (!current) return
      setSwitcher(null)
      const chosen = current.items[current.selected]
      const groupId = latest.current.layout.focusedGroupId
      if (chosen) activateTab(workspaceId, groupId, chosen.id)
    }
    const onKeyUp = (event: KeyboardEvent) => {
      if (switcherRef.current && event.key === 'Control') {
        event.preventDefault()
        commit()
      }
    }
    const cancel = () => switcherRef.current && setSwitcher(null)
    // Capture phase: xterm and Monaco consume keys like Ctrl+W before they bubble.
    window.addEventListener('keydown', onKeyDown, { capture: true })
    window.addEventListener('keyup', onKeyUp, { capture: true })
    window.addEventListener('blur', cancel)
    return () => {
      window.removeEventListener('keydown', onKeyDown, { capture: true })
      window.removeEventListener('keyup', onKeyUp, { capture: true })
      window.removeEventListener('blur', cancel)
    }
  }, [workspaceId, rootRef])

  if (!switcher) return null
  const meta = getTabLayoutState().meta
  return createPortal(
    <div className="pointer-events-none fixed inset-0 z-[100] flex items-start justify-center pt-[12vh]">
      <div
        data-recent-tab-switcher
        role="listbox"
        aria-label="Switch tabs"
        className="w-[min(520px,calc(100vw-48px))] overflow-hidden rounded-lg border border-border bg-popover text-popover-foreground shadow-[0_10px_24px_rgba(0,0,0,0.18)]"
      >
        <div className="border-b border-border px-3 py-2 text-xs font-semibold text-muted-foreground">Switch Tab</div>
        <div className="max-h-[min(360px,60vh)] overflow-hidden py-1">
          {switcher.items.map((item, index) => (
            <div
              key={item.id}
              role="option"
              aria-selected={index === switcher.selected}
              className={
                index === switcher.selected
                  ? 'flex h-8 items-center gap-2 bg-accent px-3 text-sm text-accent-foreground'
                  : 'flex h-8 items-center gap-2 px-3 text-sm text-foreground'
              }
            >
              <TabKindIcon tab={item} className="size-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate">{tabTitle(item, meta[item.id])}</span>
              {item.kind === 'editor' && item.editor.dirty && (
                <span className="size-1.5 shrink-0 rounded-full bg-muted-foreground" />
              )}
            </div>
          ))}
        </div>
      </div>
    </div>,
    document.body
  )
}
