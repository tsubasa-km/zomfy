import { useContext, useEffect, useRef, useState } from 'react'
import { Bot, Pin, X } from 'lucide-react'
import type { Session } from '@/session-store'
import { AgentStateDot, type AgentDotState } from '@/components/AgentStateDot'
import { Input } from '@/components/ui/input'
import { isImeOwnedKeyboardEvent } from '@/lib/ime-composition-keyboard-event'
import { cn } from '@/lib/utils'
import { keepTab, setTabMeta, tabScope, useTabLayout } from '@/stores/tab-layout-store'
import { gestureOf, keepTextUnselected, tabSelection } from '@/stores/list-selection'
import { TabContextMenu } from './TabContextMenu'
import { TabKindIcon } from './TabKindIcon'
import { DragChip } from '@/components/PointerDragLayer'
import { TAB_DRAG_ACTIVATION_DISTANCE_PX, tabDrag, useInsertionMark } from './tab-drag'
import { RENAME_TAB_EVENT } from './use-tab-keyboard'
import { renameChat } from '@/chat-rename-archive'
import {
  activateTab,
  canRenameTab,
  closeWorkspaceTabs,
  defaultTabTitle,
  TabPlacesContext,
  tabWorkspaceId,
  useWorkspacePlace,
  type WorkspaceTab
} from './workspace-tab-model'
import { SshTagBadge } from '@/components/ssh/SshTagBadge'
import { t } from '@/i18n/i18n'

// Tab chrome follows Orca's SortableTab / EditorFileTab / BrowserTab (drop-indicator.ts, tab-width-rules.ts).

const TAB_DOT: Partial<Record<Session['status'], AgentDotState>> = {
  'needs-you': 'waiting',
  working: 'working',
  error: 'failed'
}

// Why: Orca's vivid insertion bar; the theme accent is too subtle for a drag cue.
const DROP_BEFORE = "before:absolute before:inset-y-0 before:left-0 before:z-10 before:w-[2px] before:bg-blue-500 before:content-['']"
const DROP_AFTER = "after:absolute after:inset-y-0 after:right-0 after:z-10 after:w-[2px] after:bg-blue-500 after:content-['']"

export function TabItem({
  workspaceId: paneWorkspaceId,
  groupId,
  tab,
  groupTabs,
  active,
  groupActiveId,
  hasSplit,
  groupFocused = true
}: {
  workspaceId: string
  groupId: string
  tab: WorkspaceTab
  groupTabs: WorkspaceTab[]
  active: boolean
  /** The group's open tab, which joins the first Ctrl-click's selection. */
  groupActiveId: string | null
  hasSplit: boolean
  /** Whether its pane is the one being worked in; only that pane's active tab is marked in colour. */
  groupFocused?: boolean
}) {
  // A tab acts in its own workspace, which among the window's tabs is not always its pane's.
  const workspaceId = tabWorkspaceId(tab) ?? paneWorkspaceId
  const showPlace = useContext(TabPlacesContext)
  const place = useWorkspacePlace(tabWorkspaceId(tab))
  const meta = useTabLayout((s) => s.meta[tab.id])
  const preview = useTabLayout((s) => s.preview[tabScope(workspaceId)] === tab.id)
  const title = meta?.customTitle ?? defaultTabTitle(tab)
  const pinned = meta?.pinned === true
  const [menu, setMenu] = useState<{ x: number; y: number; open: boolean } | null>(null)
  const [renaming, setRenaming] = useState<string | null>(null)
  const dropSide = useInsertionMark(tab.id)
  const selected = tabSelection.use((s) => s.scope === groupId && s.ids.length > 1 && s.ids.includes(tab.id))
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (active) ref.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [active])

  useEffect(() => {
    const onRename = (event: Event) => {
      if (event instanceof CustomEvent && event.detail === tab.id && canRenameTab(tab)) setRenaming(title)
    }
    window.addEventListener(RENAME_TAB_EVENT, onRename)
    return () => window.removeEventListener(RENAME_TAB_EVENT, onRename)
  }, [tab, title])

  const close = () => !pinned && closeWorkspaceTabs(workspaceId, [tab])
  const commitRename = () => {
    if (renaming === null) return
    const next = renaming.trim()
    setRenaming(null)
    const keepHere = () => setTabMeta(tab.id, { customTitle: next && next !== defaultTabTitle(tab) ? next : undefined })
    if (tab.kind !== 'chat' || !next) return keepHere()
    // A chat's name lives on its daemon; an older one cannot take it, so this window keeps it instead.
    void renameChat(tab.session.id, next).then((result) => {
      if (result === 'ok') setTabMeta(tab.id, { customTitle: undefined })
      else if (result === 'unsupported') keepHere()
    })
  }
  const dot = tab.kind === 'chat' ? TAB_DOT[tab.session.status] : undefined
  const dirty = tab.kind === 'editor' && tab.editor.dirty

  return (
    <>
      <div
        ref={ref}
        role="tab"
        aria-selected={active}
        data-tab-id={tab.id}
        data-tab-kind={tab.kind}
        data-tab-title={title}
        data-pinned={pinned ? 'true' : 'false'}
        data-tab-selected={selected || undefined}
        data-tab-preview={preview || undefined}
        title={showPlace && place ? `${title} · ${place}` : undefined}
        onPointerDown={(e) => {
          if (renaming !== null) return
          tabDrag.begin(e, {
            payload: () => ({ workspaceId, tabId: tab.id, groupId, kind: tab.kind }),
            preview: <DragChip fill icon={dot ? <AgentStateDot state={dot} size="sm" /> : <TabKindIcon tab={tab} />} label={title} />,
            previewMatchesSource: true,
            activationDistance: TAB_DRAG_ACTIVATION_DISTANCE_PX,
            // Orca turns autoscroll off for tab drags: scrolling the strip under the cursor loops.
            autoScroll: false
          })
        }}
        onClick={(e) => {
          const gesture = gestureOf(e)
          if (gesture) {
            tabSelection.gesture(groupId, tab.id, gesture, groupActiveId, groupTabs.map((t) => t.id))
            return
          }
          tabSelection.reset(groupId, tab.id)
          activateTab(workspaceId, groupId, tab.id)
        }}
        onDoubleClick={() => {
          // A preview tab's double click keeps it, as an editor's does; any other one renames.
          if (preview) keepTab(tab.id)
          else if (canRenameTab(tab)) setRenaming(title)
        }}
        onMouseDown={(e) => {
          if (e.button === 1) e.preventDefault()
          else keepTextUnselected(e)
        }}
        onAuxClick={(e) => {
          if (e.button !== 1) return
          e.preventDefault()
          close()
        }}
        onContextMenu={(e) => {
          e.preventDefault()
          setMenu({ x: e.clientX, y: e.clientY, open: true })
        }}
        className={cn(
          // Sized to its name, as VS Code's tabs are; the strip scrolls once they no longer fit.
          'group relative flex h-full max-w-[280px] min-w-[80px] shrink-0 cursor-pointer items-center gap-1.5 border-r border-border pr-1.5 pl-2.5 text-xs select-none',
          active || selected
            ? 'bg-[color-mix(in_srgb,var(--foreground)_6%,var(--card))] text-foreground'
            : 'bg-card text-muted-foreground hover:text-foreground',
          dropSide === 'before' && DROP_BEFORE,
          dropSide === 'after' && DROP_AFTER
        )}
      >
        <span className="flex size-4 shrink-0 items-center justify-center">
          {dot ? <AgentStateDot state={dot} size="sm" /> : <TabKindIcon tab={tab} />}
        </span>
        {renaming !== null ? (
          <Input
            autoFocus
            data-tab-rename-input="true"
            aria-label={t('Rename tab {title}', { title })}
            value={renaming}
            onChange={(e) => setRenaming(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (isImeOwnedKeyboardEvent(e)) return
              if (e.key === 'Enter') {
                e.preventDefault()
                commitRename()
              } else if (e.key === 'Escape') {
                e.preventDefault()
                setRenaming(null)
              }
            }}
            onClick={(e) => e.stopPropagation()}
            onDoubleClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            className="h-5 min-w-[72px] flex-1 px-1 py-0 text-xs"
            spellCheck={false}
          />
        ) : (
          // The name keeps its room; where the tab belongs gives way first, as a tab's description does in VS Code.
          <span className={cn('min-w-[4ch] flex-[1_1_auto] truncate', preview && 'italic')}>{title}</span>
        )}
        {/* A login to a saved server says how careful to be there, production above all. */}
        {tab.kind === 'terminal' && tab.terminal.connection?.tag && renaming === null && <SshTagBadge tag={tab.terminal.connection.tag} />}
        {/* An agent is typing into it (terminal_send): the bar over the terminal says who, and stops it. */}
        {tab.kind === 'terminal' && tab.terminal.agentControl?.state === 'driving' && renaming === null && (
          <Bot className="size-3 shrink-0 text-highlight" aria-label={t('An agent is typing here')} data-tab-agent-driving />
        )}
        {/* A chat says where it works in the sidebar and the header; a shell, a file or a panel needs it on the tab. */}
        {showPlace && place && tab.kind !== 'chat' && renaming === null && (
          <span className="max-w-[45%] min-w-0 flex-[0_1000_auto] truncate text-[10px] text-muted-foreground/70" data-tab-place>
            {place}
          </span>
        )}
        {meta?.color && renaming === null && (
          <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: meta.color }} />
        )}
        {/* VS Code's close slot: a pin to unpin, an unsaved file's dot that turns into the close
            button under the pointer, or the close button on the active tab and the hovered one. */}
        {renaming === null &&
          (pinned ? (
            <button
              type="button"
              aria-label={t('Unpin Tab')}
              title={t('Unpin Tab')}
              data-tab-unpin
              className="flex h-4 w-4 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:bg-muted hover:text-foreground"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation()
                setTabMeta(tab.id, { pinned: false })
              }}
            >
              <Pin className="size-3" />
            </button>
          ) : (
            <button
              type="button"
              aria-label={t('Close {title}', { title })}
              className={cn(
                'group/close flex h-4 w-4 shrink-0 items-center justify-center rounded-sm',
                active || dirty
                  ? 'text-muted-foreground hover:bg-muted hover:text-foreground'
                  : 'text-transparent group-hover:text-muted-foreground hover:!bg-muted hover:!text-foreground'
              )}
              onClick={(e) => {
                e.stopPropagation()
                close()
              }}
            >
              {dirty ? (
                <>
                  <span aria-label={t('Unsaved changes')} className="size-2 rounded-full bg-foreground/60 group-hover/close:hidden" />
                  <X className="hidden size-3 group-hover/close:block" />
                </>
              ) : (
                <X className="size-3" />
              )}
            </button>
          ))}
        {active && (
          <span
            className={cn(
              'pointer-events-none absolute inset-x-0 bottom-0 z-20 h-[2px]',
              groupFocused || !hasSplit ? 'bg-highlight' : 'bg-muted-foreground/30'
            )}
          />
        )}
      </div>
      {menu && (
        <TabContextMenu
          workspaceId={workspaceId}
          groupId={groupId}
          tab={tab}
          groupTabs={groupTabs}
          hasSplit={hasSplit}
          open={menu.open}
          point={menu}
          onOpenChange={(open) => setMenu((m) => m && { ...m, open })}
          onRename={() => {
            activateTab(workspaceId, groupId, tab.id)
            setRenaming(title)
          }}
        />
      )}
    </>
  )
}
