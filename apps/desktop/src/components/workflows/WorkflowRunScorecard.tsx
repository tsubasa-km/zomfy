import type { WorkflowScorecard } from '@acp-harness/protocol'
import { cn } from '@/lib/utils'

// A run's scorecard as a small grid: cost, work done twice, rounds, time. Each figure says in its
// tooltip what it counts.

export function formatTokens(n: number): string {
  return n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${Math.round(n / 1000)}k` : String(n)
}

export function formatDuration(ms: number): string {
  const s = Math.round(ms / 1000)
  return s >= 3600 ? `${Math.floor(s / 3600)}h ${Math.round((s % 3600) / 60)}m` : s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`
}

function Figure({ label, value, hint, warn }: { label: string; value: string; hint: string; warn?: boolean }) {
  return (
    <div className="min-w-0" title={hint}>
      <div className={cn('truncate text-sm font-medium tabular-nums', warn && 'text-status-warning')}>{value}</div>
      <div className="truncate text-[11px] text-muted-foreground">{label}</div>
    </div>
  )
}

export function WorkflowRunScorecard({ card }: { card: WorkflowScorecard }) {
  const tokens = card.usage.inputTokens + card.usage.outputTokens
  return (
    <div className="space-y-2" data-workflow-scorecard>
      <div className="grid grid-cols-3 gap-x-3 gap-y-2">
        <Figure label="Time" value={formatDuration(card.durationMs)} hint="From the first step's start to the run's end (or now)." />
        <Figure
          label={card.usage.costUsd !== undefined ? `Tokens · $${card.usage.costUsd.toFixed(2)}` : 'Tokens'}
          value={formatTokens(tokens)}
          hint={`New input ${card.usage.inputTokens.toLocaleString()}, output ${card.usage.outputTokens.toLocaleString()}, cache reads ${card.usage.cacheReadTokens.toLocaleString()}.${card.unmetered ? ` ${card.unmetered} step(s) did not report usage.` : ''}`}
        />
        <Figure label="Steps" value={String(card.steps)} hint="Step visits, rounds included." />
        <Figure
          label="Sent back"
          value={`${card.sentBack} · ${card.checksFailed}`}
          hint="Reviews that sent the work back · checks that failed."
          warn={card.sentBack + card.checksFailed > 2}
        />
        <Figure
          label="Re-read after handoff"
          value={card.reads ? `${card.rereadAfterHandoff}/${card.reads}` : '—'}
          hint="Files a step read that an earlier step had already read, unchanged since: what the handoff did not carry."
          warn={card.reads > 0 && card.rereadAfterHandoff / card.reads > 0.3}
        />
        <Figure
          label="Re-run commands"
          value={card.commands ? `${card.rerunCommands}/${card.commands}` : '—'}
          hint="Commands an earlier step had already run, run again by a later step (often the same tests)."
        />
        <Figure label="Repeat reads" value={String(card.repeatedReads)} hint="A step reading the same unchanged file again." />
        <Figure
          label="Handoffs"
          value={card.handoffs ? `${card.handoffs} · ${card.handoffChars}ch` : '—'}
          hint="Summaries handed between steps, and their average length in characters."
        />
        <Figure label="Waited on you" value={String(card.personWaits)} hint="Times the run stopped for the person." />
      </div>
    </div>
  )
}
