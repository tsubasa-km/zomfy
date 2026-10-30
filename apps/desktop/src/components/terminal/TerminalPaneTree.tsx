import { useEffect, useRef, useState } from 'react'
import type { TerminalInfo } from '@acp-harness/protocol'
import { useStore } from '@/session-store'
import { TerminalView } from '@/components/TerminalView'
import {
  setActivePane,
  setPaneRatio,
  useTerminalPaneLayout,
  type PaneNode,
  type PaneSplitDirection
} from '@/stores/terminal-pane-store'
import { cn } from '@/lib/utils'
import { focusPaneTerminal } from './terminal-pane-commands'
import { t } from '@/i18n/i18n'

// Orca's split terminal panes: panes are laid out absolutely from the tree so splitting or closing
// one never remounts the others' xterm (their screens and scroll stay put).

const MIN_RATIO = 0.1
const MAX_RATIO = 0.9
/** Orca's terminal inactive pane opacity. */
const INACTIVE_PANE_OPACITY = 0.9

interface Rect {
  x: number
  y: number
  w: number
  h: number
}

interface Divider {
  path: string
  direction: PaneSplitDirection
  /** The split's own box, which a drag measures the ratio against. */
  box: Rect
  ratio: number
}

function layoutPanes(node: PaneNode, box: Rect, path: string, ratios: Record<string, number>, leaves: Map<string, Rect>, dividers: Divider[]): void {
  if (node.type === 'leaf') {
    leaves.set(node.terminalId, box)
    return
  }
  const ratio = ratios[path] ?? node.ratio ?? 0.5
  const child = (side: 'first' | 'second') => (path ? `${path}.${side}` : side)
  if (node.direction === 'horizontal') {
    layoutPanes(node.first, { ...box, w: box.w * ratio }, child('first'), ratios, leaves, dividers)
    layoutPanes(node.second, { ...box, x: box.x + box.w * ratio, w: box.w * (1 - ratio) }, child('second'), ratios, leaves, dividers)
  } else {
    layoutPanes(node.first, { ...box, h: box.h * ratio }, child('first'), ratios, leaves, dividers)
    layoutPanes(node.second, { ...box, y: box.y + box.h * ratio, h: box.h * (1 - ratio) }, child('second'), ratios, leaves, dividers)
  }
  dividers.push({ path, direction: node.direction, box, ratio })
}

const pct = (value: number) => `${value * 100}%`

function PaneDivider({ tabId, divider, onPreview }: { tabId: string; divider: Divider; onPreview: (path: string, ratio: number | null) => void }) {
  const [dragging, setDragging] = useState(false)
  const vertical = divider.direction === 'horizontal'
  const { box, ratio } = divider
  const style: React.CSSProperties = vertical
    ? { left: `calc(${pct(box.x + box.w * ratio)} - 4.5px)`, top: pct(box.y), height: pct(box.h), width: 9 }
    : { top: `calc(${pct(box.y + box.h * ratio)} - 4.5px)`, left: pct(box.x), width: pct(box.w), height: 9 }
  return (
    <div
      data-pane-divider={divider.path || 'root'}
      className={cn('tab-group-split-resize-handle terminal-pane-divider absolute z-10', vertical ? 'is-vertical' : 'is-horizontal', dragging && 'is-dragging')}
      style={style}
      onPointerDown={(event) => {
        if (event.button !== 0) return
        event.preventDefault()
        event.currentTarget.setPointerCapture(event.pointerId)
        setDragging(true)
      }}
      onPointerMove={(event) => {
        if (!dragging) return
        const root = event.currentTarget.parentElement?.getBoundingClientRect()
        if (!root) return
        const raw = vertical
          ? (event.clientX - root.left - box.x * root.width) / (box.w * root.width)
          : (event.clientY - root.top - box.y * root.height) / (box.h * root.height)
        onPreview(divider.path, Math.min(MAX_RATIO, Math.max(MIN_RATIO, raw)))
      }}
      onPointerUp={() => {
        if (!dragging) return
        setDragging(false)
        setPaneRatio(tabId, divider.path, divider.ratio)
        onPreview(divider.path, null)
      }}
      onLostPointerCapture={() => {
        if (dragging) {
          setDragging(false)
          setPaneRatio(tabId, divider.path, divider.ratio)
          onPreview(divider.path, null)
        }
      }}
    />
  )
}

function Pane({ terminalId, rect, active, dimmed, hidden, tabId }: { terminalId: string; rect: Rect; active: boolean; dimmed: boolean; hidden: boolean; tabId: string }) {
  const terminal = useStore((s) => s.terminals.find((t) => t.id === terminalId))
  return (
    <div
      data-terminal-pane={terminalId}
      data-active={active ? 'true' : 'false'}
      className={cn('absolute flex min-h-0 min-w-0 transition-opacity duration-150', hidden && 'invisible')}
      style={{ left: pct(rect.x), top: pct(rect.y), width: pct(rect.w), height: pct(rect.h), opacity: dimmed ? INACTIVE_PANE_OPACITY : 1, zIndex: active ? 1 : 0 }}
      onFocusCapture={() => setActivePane(tabId, terminalId)}
      onPointerDown={() => setActivePane(tabId, terminalId)}
    >
      {terminal ? <TerminalView terminal={terminal} /> : <div className="m-auto text-xs text-muted-foreground">{t('Starting terminal…')}</div>}
    </div>
  )
}

/** A terminal tab's body: Orca's pane tree, which is a single pane until the tab is split. */
export function TerminalTabBody({ tabId, terminal }: { tabId: string; terminal: TerminalInfo }) {
  const layout = useTerminalPaneLayout(tabId)
  const [preview, setPreview] = useState<Record<string, number>>({})
  const activeId = layout?.activeTerminalId
  const shownRef = useRef(false)

  // Showing a split tab focuses its active pane, not whichever xterm mounted last.
  useEffect(() => {
    if (!activeId || shownRef.current) return
    shownRef.current = true
    requestAnimationFrame(() => focusPaneTerminal(activeId))
  }, [activeId])

  const leaves = new Map<string, Rect>()
  const dividers: Divider[] = []
  // An unsplit tab is a one-leaf tree, so its first split keeps the existing xterm mounted.
  layoutPanes(layout?.root ?? { type: 'leaf', terminalId: terminal.id }, { x: 0, y: 0, w: 1, h: 1 }, '', preview, leaves, dividers)
  const expanded = layout?.expandedTerminalId && leaves.has(layout.expandedTerminalId) ? layout.expandedTerminalId : null
  const split = leaves.size > 1
  // Sorted so React keeps each pane's node (and xterm) however the tree reshapes.
  const ids = [...leaves.keys()].sort()

  return (
    <div className="relative min-h-0 min-w-0 flex-1 overflow-hidden" data-terminal-pane-tree={tabId} data-expanded={expanded ?? undefined}>
      {ids.map((id) => (
        <Pane
          key={id}
          tabId={tabId}
          terminalId={id}
          rect={expanded === id ? { x: 0, y: 0, w: 1, h: 1 } : leaves.get(id)!}
          active={!split || id === activeId}
          dimmed={split && !expanded && id !== activeId}
          hidden={expanded !== null && expanded !== id}
        />
      ))}
      {expanded
        ? null
        : dividers.map((divider) => (
            <PaneDivider
              key={divider.path || 'root'}
              tabId={tabId}
              divider={divider}
              onPreview={(path, ratio) =>
                setPreview((current) => {
                  const next = { ...current }
                  if (ratio === null) delete next[path]
                  else next[path] = ratio
                  return next
                })
              }
            />
          ))}
    </div>
  )
}
