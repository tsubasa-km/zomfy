import type { WorkflowScorecard } from '@acp-harness/protocol'
import { cn } from '@/lib/utils'

// A run's scorecard: the few figures worth comparing (time, cost, rounds, what handoffs lost, waits
// on the person). Each figure's tooltip says what it counts. What fills a chat's context is in the
// Agent tab of that chat.

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
  const rounds = card.sentBack + card.checksFailed
  return (
    <div className="grid grid-cols-3 gap-x-3 gap-y-2" data-workflow-scorecard>
      <Figure label="Time" value={formatDuration(card.durationMs)} hint="From the first step's start to the run's end (or now)." />
      <Figure
        label="Tokens"
        value={`${formatTokens(tokens)}${card.usage.costUsd !== undefined ? ` · $${card.usage.costUsd.toFixed(2)}` : ''}`}
        hint={`New input ${card.usage.inputTokens.toLocaleString()}, output ${card.usage.outputTokens.toLocaleString()}, cache reads ${card.usage.cacheReadTokens.toLocaleString()}. Cost from Claude steps only.${card.unmetered ? ` ${card.unmetered} step(s) did not report usage.` : ''}`}
      />
      <Figure
        label="Rounds"
        value={String(rounds)}
        hint={`Work sent back by a review (${card.sentBack}) plus failed checks (${card.checksFailed}).`}
        warn={rounds > 2}
      />
      <Figure
        label="Re-read after handoff"
        value={card.reads ? `${card.rereadAfterHandoff} of ${card.reads}` : '—'}
        hint={`File reads of something an earlier step had read, unchanged since: what its summary did not carry (${card.handoffs} handoffs, ${card.handoffChars} characters on average). Commands run again by a later step: ${card.rerunCommands} of ${card.commands}.`}
        warn={card.reads > 0 && card.rereadAfterHandoff / card.reads > 0.3}
      />
      <Figure label="Waited on you" value={String(card.personWaits)} hint="Times the run stopped for the person." />
    </div>
  )
}
