import { useEffect, useState } from 'react'
import { ensureSessionLoaded } from '@/daemon-connection'
import { ThreadView } from '@/components/ThreadView'
import { TerminalTabBody } from '@/components/terminal/TerminalPaneTree'
import { DiffTabView } from '@/components/EditorTabViews'
import { FileEditorView } from '@/components/FileEditorView'
import { cn } from '@/lib/utils'
import { BrowserTabView } from './BrowserTabView'
import { ToolDrawer } from './ToolDrawer'
import { TabStrip } from './TabStrip'
import { resolveTabDropTarget, setInsertionMark, tabDrag, type DropZone } from './tab-drag'
import { focusGroup, moveTabTo, splitTabTo } from './tab-group-commands'
import './pane-split-commands'
import type { WorkspaceTab } from './workspace-tab-model'
import { t } from '@/i18n/i18n'

const OVERLAY_RECT: Record<DropZone, React.CSSProperties> = {
  up: { top: 0, left: 0, width: '100%', height: '50%' },
  down: { top: '50%', left: 0, width: '100%', height: '50%' },
  left: { top: 0, left: 0, width: '50%', height: '100%' },
  right: { top: 0, left: '50%', width: '50%', height: '100%' },
  center: { inset: 0 }
}

function TabBody({ tab }: { tab: WorkspaceTab }) {
  switch (tab.kind) {
    case 'chat':
      return <ThreadView key={tab.id} session={tab.session} />
    case 'terminal':
      return <TerminalTabBody key={tab.id} tabId={tab.id} terminal={tab.terminal} />
    case 'editor':
      return tab.editor.kind === 'file' ? (
        <FileEditorView key={tab.id} tab={tab.editor} />
      ) : (
        <DiffTabView key={tab.id} tab={tab.editor} />
      )
    case 'browser':
      return <BrowserTabView key={tab.id} tab={tab.browser} />
  }
}

/** Orca's TabGroupPanel: one split pane with its own tab row, body, and drop targets. */
export function TabGroupPane({
  workspaceId,
  groupId,
  tabs,
  activeId,
  isFocused,
  hasSplit,
  trailing,
  emptyHint
}: {
  workspaceId: string
  groupId: string
  tabs: WorkspaceTab[]
  activeId: string | null
  isFocused: boolean
  hasSplit: boolean
  trailing?: React.ReactNode
  emptyHint: string
}) {
  const active = tabs.find((t) => t.id === activeId) ?? null
  const activeChatId = active?.kind === 'chat' ? active.id : undefined
  const [zone, setZone] = useState<DropZone | null>(null)

  useEffect(() => {
    if (activeChatId) void ensureSessionLoaded(activeChatId)
  }, [activeChatId])

  // Tabs move only within their own workspace, as before; the floating panel is another workspace.
  const dropRef = tabDrag.useDropTarget({
    accepts: (drag) => drag.workspaceId === workspaceId,
    over: (drag, { point, element }) => {
      const target = resolveTabDropTarget(drag, groupId, element, point)
      setInsertionMark(target.kind === 'insert' ? target.mark : null)
      setZone(target.kind === 'split' ? target.side : target.kind === 'move' ? 'center' : null)
    },
    leave: () => {
      setInsertionMark(null)
      setZone(null)
    },
    drop: (drag, { point, element }) => {
      const target = resolveTabDropTarget(drag, groupId, element, point)
      if (target.kind === 'insert') moveTabTo(workspaceId, drag.tabId, target.groupId, target.index)
      else if (target.kind === 'split') splitTabTo(workspaceId, drag.tabId, target.groupId, target.side)
      else if (target.kind === 'move') moveTabTo(workspaceId, drag.tabId, target.groupId, tabs.length)
    }
  })

  return (
    <div
      ref={dropRef}
      data-tab-group-id={groupId}
      data-focused={isFocused ? 'true' : 'false'}
      className={cn('relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden', hasSplit && !isFocused && 'opacity-95')}
      onPointerDown={() => !isFocused && focusGroup(workspaceId, groupId)}
    >
      <TabStrip
        workspaceId={workspaceId}
        groupId={groupId}
        tabs={tabs}
        activeId={active?.id ?? null}
        isFocused={isFocused}
        hasSplit={hasSplit}
        trailing={trailing}
      />
      <div data-tab-group-body-id={groupId} className="relative flex min-h-0 min-w-0 flex-1 flex-col">
        {active ? <TabBody tab={active} /> : <div className="m-auto px-4 text-center text-sm text-muted-foreground">{emptyHint}</div>}
        <ToolDrawer workspaceId={workspaceId} exclude={active?.id} />
      </div>
      {zone && (
        <div aria-hidden data-tab-drop-zone={zone} className="tab-drop-overlay" style={OVERLAY_RECT[zone]}>
          {zone !== 'center' && (
            <span className="tab-drop-overlay__label pointer-events-none absolute bottom-2 left-2 rounded-sm px-1.5 py-0.5 font-medium">
              {t('New split')}
            </span>
          )}
        </div>
      )}
    </div>
  )
}
