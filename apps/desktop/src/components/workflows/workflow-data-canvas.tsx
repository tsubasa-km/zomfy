import { memo } from 'react'
import { Handle, MarkerType, Position, type Edge, type Node, type NodeProps } from '@xyflow/react'
import { Database, Lock } from 'lucide-react'
import type { Workflow, WorkflowDataSource } from '@acp-harness/protocol'
import { cn } from '@/lib/utils'
import { t } from '@/i18n/i18n'

// Data sources on the canvas: a card per file or folder, and a dotted line to each step that uses
// it. They sit beside the flow (no outcomes, no loops); a step sees only the data linked to it.

export const DATA_PREFIX = 'data:'
export const LINK_PREFIX = 'link:'

export type DataCanvasNode = Node<{ source: WorkflowDataSource; issue: 'error' | 'warning' | null; steps: number }, 'data'>

function DataCard({ data, selected }: NodeProps<DataCanvasNode>) {
  const { source, issue, steps } = data
  return (
    <div
      className={cn(
        'relative w-52 rounded-lg border border-dashed bg-card px-3 py-2 text-card-foreground shadow-xs',
        selected ? 'border-ring ring-2 ring-ring/30' : source.localOnly ? 'border-status-warning' : 'border-border',
        issue === 'error' && !selected && 'border-destructive/60'
      )}
      data-workflow-data={source.localOnly ? 'local-only' : 'shared'}
    >
      <div className="flex items-center gap-2">
        <Database className="size-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1 truncate text-[13px] font-medium">{source.name || t('Data')}</div>
        {issue && (
          <span
            aria-label={issue === 'error' ? t('Has problems') : t('Has warnings')}
            className={cn('size-1.5 shrink-0 rounded-full', issue === 'error' ? 'bg-destructive' : 'bg-status-warning')}
          />
        )}
        {source.localOnly && (
          <span
            className="flex shrink-0 items-center gap-0.5 rounded bg-status-warning/15 px-1 text-[10px] font-medium text-status-warning"
            title={t('Only agents on a local model may see it')}
          >
            <Lock className="size-2.5" />
            {t('Local only')}
          </span>
        )}
      </div>
      <div className="mt-0.5 truncate pl-6 font-mono text-[11px] text-muted-foreground" title={source.path}>
        {source.path.trim() || t('No path yet')}
      </div>
      <div className="mt-0.5 pl-6 text-[11px] text-muted-foreground">
        {steps === 0 ? t('Drag to a step to give it access') : steps > 1 ? t('{n} steps may use it', { n: steps }) : t('{n} step may use it', { n: steps })}
      </div>
      <Handle id="data" type="source" position={Position.Bottom} className="!size-2.5 !border-border !bg-background" />
    </div>
  )
}

export const DataNode = memo(DataCard)

export function dataCanvasNodes(
  workflow: Workflow,
  selected: string | null,
  issueOf: (dataId: string) => 'error' | 'warning' | null,
  sizes: Record<string, { width: number; height: number }>
): DataCanvasNode[] {
  const links = workflow.dataLinks ?? []
  return (workflow.data ?? []).map((source) => {
    const id = `${DATA_PREFIX}${source.id}`
    return {
      id,
      type: 'data' as const,
      position: { x: source.x, y: source.y },
      data: { source, issue: issueOf(source.id), steps: new Set(links.filter((l) => l.dataId === source.id).map((l) => l.nodeId)).size },
      selected: selected === source.id,
      ...(sizes[id] ? { measured: sizes[id] } : {})
    }
  })
}

export function dataCanvasEdges(workflow: Workflow, selected: string | null, faded = false): Edge[] {
  const steps = new Set(workflow.nodes.map((n) => n.id))
  const sources = new Map((workflow.data ?? []).map((d) => [d.id, d]))
  return (workflow.dataLinks ?? []).flatMap((link) => {
    const source = sources.get(link.dataId)
    if (!source || !steps.has(link.nodeId)) return []
    const color = source.localOnly ? 'var(--status-warning)' : 'var(--muted-foreground)'
    const isSelected = selected === link.id
    return [
      {
        id: `${LINK_PREFIX}${link.id}`,
        source: `${DATA_PREFIX}${source.id}`,
        target: link.nodeId,
        sourceHandle: 'data',
        targetHandle: 'data-in',
        label: link.write ? t('reads · writes') : t('reads'),
        selected: isSelected,
        zIndex: -1,
        markerEnd: { type: MarkerType.ArrowClosed, color, width: 14, height: 14 },
        style: { stroke: color, strokeWidth: isSelected ? 2.5 : 1.5, strokeDasharray: '2 4', opacity: faded ? 0.4 : 1 },
        labelStyle: { fontSize: 10, fill: color },
        labelBgStyle: { fill: 'var(--background)' },
        labelBgPadding: [3, 1] as [number, number],
        labelBgBorderRadius: 4
      }
    ]
  })
}
