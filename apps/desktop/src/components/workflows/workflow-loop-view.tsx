import { Panel } from '@xyflow/react'
import { RefreshCw } from 'lucide-react'
import type { WorkflowCycle } from '@acp-harness/protocol'
import { createExternalStore } from '@/stores/external-store'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { t } from '@/i18n/i18n'

// How the canvas shows loops (cycles): several ways side by side, picked on the canvas and kept per
// window, so they can be compared on real workflows. Only the drawing changes; the harness counts
// rounds the same way in every one.

export type LoopView = 'frames' | 'tint' | 'arrows' | 'badge' | 'none'

export const LOOP_VIEWS: { value: LoopView; label: string; hint: string }[] = [
  { value: 'frames', label: t('Frames'), hint: t('A dashed frame with its name around each loop') },
  { value: 'tint', label: t('Tinted areas'), hint: t('A coloured area per loop, named in a legend') },
  { value: 'arrows', label: t('Loop arrows'), hint: t('The arrows going back carry the loop and its rounds') },
  { value: 'badge', label: t('Badge on loop start'), hint: t('The step a loop comes back to says so') },
  { value: 'none', label: t('None'), hint: t('Steps and arrows only') }
]

const KEY = 'acp-harness.workflow-loop-view.v1'

function readSaved(): LoopView {
  try {
    const saved = localStorage.getItem(KEY)
    return LOOP_VIEWS.find((v) => v.value === saved)?.value ?? 'frames'
  } catch {
    return 'frames'
  }
}

const store = createExternalStore<LoopView>(readSaved(), (view) => {
  try {
    localStorage.setItem(KEY, view)
  } catch {
    // The choice lasts for this session when storage is unavailable.
  }
})

export const useLoopView = () => store.use((view) => view)

export function setLoopView(view: LoopView): void {
  store.set(view)
}

/** Tints per loop, from the theme's own tokens; nested loops darken where they overlap. */
export const LOOP_TINTS = ['bg-primary/[0.07]', 'bg-status-success/[0.09]', 'bg-status-warning/[0.09]', 'bg-agent-question/[0.09]']
const LOOP_SWATCHES = ['bg-primary/50', 'bg-status-success/60', 'bg-status-warning/60', 'bg-agent-question/60']

const limitText = (c: WorkflowCycle) => (c.maxRounds ? `≤${c.maxRounds}` : '∞')

export interface LoopDecor {
  /** Frames or tinted areas behind the loops' steps. */
  areas: 'frames' | 'tint' | null
  /** Loop arrows: the text added to each arrow going back. */
  edges: Map<string, string>
  /** Badges: the text on each step a loop comes back to. */
  nodes: Map<string, string>
}

/** `rounds`: how far each loop is (a run's view), or its limit when absent (the editor). */
export function loopDecor(view: LoopView, cycles: WorkflowCycle[], rounds?: (cycle: WorkflowCycle) => string | null): LoopDecor {
  const roundText = (c: WorkflowCycle) => (rounds ? rounds(c) : null) ?? limitText(c)
  const edges = new Map<string, string>()
  const nodes = new Map<string, string>()
  if (view === 'arrows') for (const c of cycles) for (const id of c.backEdgeIds) edges.set(id, `↻ ${roundText(c)}`)
  if (view === 'badge') for (const c of cycles) nodes.set(c.id, `${c.label} · ${rounds ? (rounds(c) ?? t('not reached')) : c.maxRounds ? t('up to {n} rounds', { n: c.maxRounds }) : t('no round limit')}`)
  return { areas: view === 'frames' || view === 'tint' ? view : null, edges, nodes }
}

/** The picker, plus the legend tinted areas need, in the canvas's top-right corner. */
export function LoopViewPanel({ cycles, rounds }: { cycles: WorkflowCycle[]; rounds?: (cycle: WorkflowCycle) => string | null }) {
  const view = useLoopView()
  if (cycles.length === 0) return null
  return (
    <Panel position="top-right" className="!m-3">
      <div className="w-52 space-y-2 rounded-lg border border-border bg-card p-2 shadow-xs" data-workflow-loop-view={view}>
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <RefreshCw className="size-3" />
          {t('Loops')}
        </div>
        <Select value={view} onValueChange={(v) => setLoopView(LOOP_VIEWS.find((x) => x.value === v)?.value ?? 'frames')}>
          <SelectTrigger size="sm" className="h-7 w-full text-xs" aria-label={t('How loops are shown')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {LOOP_VIEWS.map((v) => (
              <SelectItem key={v.value} value={v.value} title={v.hint}>
                {v.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {view === 'tint' && (
          <ul className="space-y-1" data-workflow-loop-legend>
            {cycles.map((c, i) => (
              <li key={c.id} className="flex items-center gap-1.5 text-[11px]">
                <span className={cn('size-2.5 shrink-0 rounded-sm', LOOP_SWATCHES[i % LOOP_SWATCHES.length])} />
                <span className="min-w-0 flex-1 truncate">{c.label}</span>
                <span className="shrink-0 text-muted-foreground tabular-nums">{rounds?.(c) ?? limitText(c)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Panel>
  )
}
