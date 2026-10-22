import { useEffect, useState } from 'react'
import { ensureSessionLoaded } from '@/daemon-connection'
import { ThreadView } from '@/components/ThreadView'
import { TerminalTabBody } from '@/components/terminal/TerminalPaneTree'
import { DiffTabView } from '@/components/EditorTabViews'
import { FileEditorView } from '@/components/FileEditorView'
import { cn } from '@/lib/utils'
import { BrowserTabView } from './BrowserTabView'
import { TabStrip } from './TabStrip'
import { endTabDrag, resolveDropZone, useDraggedTab, type DropZone } from './tab-drag'
import { focusGroup, moveTabTo, splitTabTo } from './tab-group-commands'
import './pane-split-commands'
import type { WorkspaceTab } from './workspace-tab-model'

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
  const drag = useDraggedTab()
  const [zone, setZone] = useState<DropZone | null>(null)

  useEffect(() => {
    if (activeChatId) void ensureSessionLoaded(activeChatId)
  }, [activeChatId])
  useEffect(() => {
    if (!drag) setZone(null)
  }, [drag])

  const draggingHere = drag !== null && drag.workspaceId === workspaceId
  // Dropping a group's only tab on its own pane changes nothing.
  const pointlessDrop = drag?.groupId === groupId && tabs.length <= 1

  return (
    <div
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
        {active ? <TabBody tab={active} /> : <div className="m-auto text-sm text-muted-foreground">{emptyHint}</div>}
        {draggingHere && !pointlessDrop && (
          // Covers terminals, editors and frames, which would otherwise swallow the drag events.
          <div
            data-tab-drop-target={groupId}
            className="absolute inset-0 z-40"
            onDragOver={(e) => {
              e.preventDefault()
              setZone(resolveDropZone(e.currentTarget.getBoundingClientRect(), { x: e.clientX, y: e.clientY }))
            }}
            onDragLeave={() => setZone(null)}
            onDrop={(e) => {
              e.preventDefault()
              const target = resolveDropZone(e.currentTarget.getBoundingClientRect(), { x: e.clientX, y: e.clientY })
              if (target === 'center') {
                if (drag.groupId !== groupId) moveTabTo(workspaceId, drag.tabId, groupId, tabs.length)
              } else splitTabTo(workspaceId, drag.tabId, groupId, target)
              setZone(null)
              endTabDrag()
            }}
          >
            {zone && (
              <div aria-hidden className="tab-drop-overlay" style={OVERLAY_RECT[zone]}>
                {zone !== 'center' && (
                  <span className="tab-drop-overlay__label pointer-events-none absolute bottom-2 left-2 rounded-sm px-1.5 py-0.5 font-medium">
                    New split
                  </span>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
