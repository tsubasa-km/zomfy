import type { ReactNode } from 'react'
import { Trash2 } from 'lucide-react'
import {
  workflowOutcomes,
  type Workflow,
  type WorkflowEdge,
  type WorkflowCycle,
  type WorkflowNode,
  type WorkflowNodeConfig,
  type WorkflowOutcome,
  type WorkflowParallel
} from '@acp-harness/protocol'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { outcomeLabel, type WorkflowIssue } from './workflow-model'
import { CustomStepEditor } from './WorkflowCustomStepEditor'
import { WorkflowToolsEditor } from './WorkflowToolsEditor'
import type { HostId } from '@/session-store'

// The side panel: the selected step's or edge's settings, else the workflow's own name and its issues.

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{label}</Label>
      {children}
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  )
}

function Choice<T extends string>({
  value,
  options,
  onChange,
  label
}: {
  value: T
  options: { value: T; label: string }[]
  onChange: (value: T) => void
  label: string
}) {
  return (
    <Select
      value={value}
      onValueChange={(v) => {
        const picked = options.find((o) => o.value === v)
        if (picked) onChange(picked.value)
      }}
    >
      <SelectTrigger className="h-8 w-full" aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

const JOINS: Record<'review' | 'work', { value: WorkflowParallel['join']; label: string }[]> = {
  review: [
    { value: 'all', label: 'All must approve' },
    { value: 'majority', label: 'Most must approve' },
    { value: 'any', label: 'One approval is enough' }
  ],
  work: [
    { value: 'all', label: 'Wait for all; hand on every result' },
    { value: 'first', label: 'First to finish wins; stop the rest' }
  ]
}

/** How many sessions run the step at once, and how their outcomes become the step's one. */
function ParallelFields({
  kind,
  config,
  onChange
}: {
  kind: WorkflowNode['kind']
  config: WorkflowNodeConfig
  onChange: (patch: Partial<WorkflowNodeConfig>) => void
}) {
  const joins = JOINS[kind === 'review' ? 'review' : 'work']
  const count = config.parallel?.count ?? 1
  const join = joins.find((j) => j.value === config.parallel?.join)?.value ?? joins[0]!.value
  return (
    <div className="space-y-3" data-workflow-parallel-fields>
      <Field label="Sessions at once" hint={kind === 'review' ? 'Independent reviewers of the same change.' : 'Each in its own worktree.'}>
        <Input
          type="number"
          min={1}
          max={8}
          value={count}
          onChange={(e) => {
            const next = Math.min(8, Math.max(1, Number(e.target.value) || 1))
            onChange({ parallel: next > 1 ? { count: next, join } : undefined })
          }}
          className="h-8 w-24"
        />
      </Field>
      {count > 1 && (
        <Field label="Decided by">
          <Choice label="Decided by" value={join} onChange={(value) => onChange({ parallel: { count, join: value } })} options={joins} />
        </Field>
      )}
    </div>
  )
}

export function WorkflowInspector({
  hostId,
  workflow,
  node,
  edge,
  cycle,
  multi,
  onCycle,
  issues,
  onWorkflow,
  onNode,
  onEdge,
  onDelete,
  onSelectIssue
}: {
  hostId: HostId
  workflow: Workflow
  node: WorkflowNode | null
  edge: WorkflowEdge | null
  cycle: WorkflowCycle | null
  /** Steps selected together (Shift+click or drag a box). */
  multi: number
  onCycle: (id: string, patch: { label?: string; maxRounds?: number }) => void
  issues: WorkflowIssue[]
  onWorkflow: (patch: Partial<Pick<Workflow, 'name' | 'description'>>) => void
  onNode: (id: string, patch: Partial<Omit<WorkflowNode, 'config'>> & { config?: Partial<WorkflowNodeConfig> }) => void
  onEdge: (id: string, outcome: WorkflowOutcome) => void
  onDelete: () => void
  onSelectIssue: (issue: WorkflowIssue) => void
}) {
  if (cycle) {
    const label = (id: string) => workflow.nodes.find((n) => n.id === id)?.label ?? '?'
    const backs = workflow.edges.filter((e) => cycle.backEdgeIds.includes(e.id))
    return (
      <div className="space-y-4" data-workflow-inspector="cycle">
        <div className="space-y-1 text-xs text-muted-foreground" data-workflow-cycle-source>
          <p>
            The arrow{backs.length > 1 ? 's' : ''} back to “{label(cycle.id)}” make{backs.length > 1 ? '' : 's'} this cycle; it frames
            the {cycle.nodeIds.length} steps a round repeats.
          </p>
          <ul className="list-disc pl-4">
            {backs.map((e) => (
              <li key={e.id}>
                {label(e.from)} → {label(e.to)} ({outcomeLabel(e.outcome)})
              </li>
            ))}
          </ul>
        </div>
        <Field label="Cycle name">
          <Input value={cycle.label} onChange={(e) => onCycle(cycle.id, { label: e.target.value })} className="h-8" />
        </Field>
        <Field label="Round limit" hint="Each time the run comes back to the cycle's first step is a round; past the limit the run asks you.">
          <Input
            type="number"
            min={1}
            max={20}
            value={cycle.maxRounds}
            onChange={(e) => onCycle(cycle.id, { maxRounds: Math.max(1, Number(e.target.value) || 1) })}
            className="h-8 w-24"
          />
        </Field>
      </div>
    )
  }

  if (multi > 1) {
    return (
      <p className="text-xs text-muted-foreground" data-workflow-inspector="multi">
        {multi} steps selected. Drag one to move them together; Delete removes them.
      </p>
    )
  }

  if (node) {
    const c = node.config
    const set = (config: Partial<WorkflowNodeConfig>) => onNode(node.id, { config })
    return (
      <div className="space-y-4" data-workflow-inspector="node">
        <Field label="Step name">
          <Input value={node.label} onChange={(e) => onNode(node.id, { label: e.target.value })} className="h-8" />
        </Field>
        {(node.kind === 'agent' || node.kind === 'review' || (node.kind === 'custom' && c.runner !== 'command')) && (
          <Field label="Run by" hint="The Lead plans or checks in its own chat, with what it knows of the project.">
            <Choice
              label="Run by"
              value={c.runBy ?? 'session'}
              onChange={(runBy) => set({ runBy: runBy === 'lead' ? 'lead' : undefined })}
              options={[
                { value: 'session', label: 'A session for this step' },
                { value: 'lead', label: "The project's Lead" }
              ]}
            />
          </Field>
        )}
        <Field label="Phase" hint="The step's part in its cycle's Plan-Do-Check-Act.">
          <Choice
            label="Phase"
            value={node.phase ?? 'auto'}
            onChange={(phase) => onNode(node.id, { phase: phase === 'auto' ? undefined : phase })}
            options={[
              { value: 'auto', label: 'Auto' },
              { value: 'plan', label: 'P · Plan' },
              { value: 'do', label: 'D · Do' },
              { value: 'check', label: 'C · Check' },
              { value: 'act', label: 'A · Act' }
            ]}
          />
        </Field>
        {node.kind === 'custom' && (
          <Field label="Done by">
            <Choice
              label="Done by"
              value={c.runner ?? 'agent'}
              onChange={(runner) => set({ runner })}
              options={[
                { value: 'agent', label: 'An agent session' },
                { value: 'command', label: 'A command' }
              ]}
            />
          </Field>
        )}
        {(node.kind === 'agent' || node.kind === 'review' || (node.kind === 'custom' && c.runner !== 'command')) && (
          <>
            <Field label="Role" hint="Who the session acts as; it opens its prompt.">
              <Input value={c.role ?? ''} onChange={(e) => set({ role: e.target.value })} className="h-8" />
            </Field>
            <Field label="Instructions" hint="Added to the run's task and the previous step's handoff.">
              <Textarea value={c.prompt ?? ''} onChange={(e) => set({ prompt: e.target.value })} className="min-h-28 text-xs" />
            </Field>
          </>
        )}
        {node.kind === 'agent' && (
          <>
            <Field label="Session" hint="Keep: the same chat across rounds, so it remembers the reviews.">
              <Choice
                label="Session"
                value={c.session ?? 'keep'}
                onChange={(session) => set({ session })}
                options={[
                  { value: 'keep', label: 'Keep across rounds' },
                  { value: 'fresh', label: 'Fresh each time' }
                ]}
              />
            </Field>
            <Field label="Runs in">
              <Choice
                label="Runs in"
                value={c.workspace ?? 'run-worktree'}
                onChange={(workspace) => set({ workspace })}
                options={[
                  { value: 'run-worktree', label: 'A worktree made for the run' },
                  { value: 'main', label: "The project's main workspace" }
                ]}
              />
            </Field>
          </>
        )}
        {node.kind === 'review' && (
          <Field label="Round limit" hint="After this many sends-back the run stops and asks you.">
            <Input
              type="number"
              min={1}
              max={20}
              value={c.maxRounds ?? ''}
              onChange={(e) => set({ maxRounds: e.target.value === '' ? undefined : Math.max(1, Number(e.target.value)) })}
              className="h-8 w-24"
            />
          </Field>
        )}
        {node.kind === 'check' && (
          <Field label="Failure limit" hint="After this many failures the run stops and asks you.">
            <Input
              type="number"
              min={1}
              max={20}
              value={c.maxRounds ?? ''}
              onChange={(e) => set({ maxRounds: e.target.value === '' ? undefined : Math.max(1, Number(e.target.value)) })}
              className="h-8 w-24"
            />
          </Field>
        )}
        {(node.kind === 'agent' || node.kind === 'review' || (node.kind === 'custom' && c.runner !== 'command')) && (
          <>
            <ParallelFields kind={node.kind} config={c} onChange={set} />
            <WorkflowToolsEditor hostId={hostId} tools={c.tools} onChange={(tools) => set({ tools })} />
          </>
        )}
        {node.kind === 'custom' && c.runner === 'command' && (
          <Field label="Command" hint="Runs in the run's workspace; {{key}} fills in a field.">
            <Input value={c.command ?? ''} onChange={(e) => set({ command: e.target.value })} className="h-8 font-mono text-xs" />
          </Field>
        )}
        {node.kind === 'custom' && <CustomStepEditor config={c} onChange={set} />}
        {node.kind === 'check' && (
          <Field label="Command" hint="Runs in the run's workspace; exit code 0 passes.">
            <Input
              value={c.command ?? ''}
              placeholder="bun test"
              onChange={(e) => set({ command: e.target.value })}
              className="h-8 font-mono text-xs"
            />
          </Field>
        )}
        {node.kind === 'human' && (
          <div className="flex items-start justify-between gap-3" data-workflow-ask-lead>
            <div className="space-y-0.5">
              <div className="text-xs font-medium">Ask the Lead first</div>
              <p className="text-[11px] text-muted-foreground">The project's Lead answers; only what is your call comes to you.</p>
            </div>
            <Switch checked={c.askLeadFirst === true} onCheckedChange={(on) => set({ askLeadFirst: on || undefined })} aria-label="Ask the Lead first" />
          </div>
        )}
        {node.kind === 'human' && (
          <Field label="Question" hint="Shown in the run; your answer goes back to the step that asked.">
            <Textarea value={c.question ?? ''} onChange={(e) => set({ question: e.target.value })} className="min-h-20 text-xs" />
          </Field>
        )}
        {node.kind === 'end' && (
          <Field label="Run ends as">
            <Choice
              label="Run ends as"
              value={c.result ?? 'done'}
              onChange={(result) => set({ result })}
              options={[
                { value: 'done', label: 'Done' },
                { value: 'failed', label: 'Failed' }
              ]}
            />
          </Field>
        )}
        {node.kind !== 'start' && (
          <Button variant="outline" size="sm" onClick={onDelete}>
            <Trash2 className="size-3.5" />
            Delete step
          </Button>
        )}
      </div>
    )
  }

  if (edge) {
    const from = workflow.nodes.find((n) => n.id === edge.from)
    const to = workflow.nodes.find((n) => n.id === edge.to)
    const options = from ? workflowOutcomes(from) : []
    return (
      <div className="space-y-4" data-workflow-inspector="edge">
        <p className="text-xs text-muted-foreground">
          From <span className="font-medium text-foreground">{from?.label}</span> to{' '}
          <span className="font-medium text-foreground">{to?.label}</span>
        </p>
        <Field label="Taken when the step ends in" hint="The harness follows only the edge that matches the step's outcome.">
          <Choice
            label="Outcome"
            value={edge.outcome}
            onChange={(outcome) => onEdge(edge.id, outcome)}
            options={options.map((o) => ({ value: o, label: outcomeLabel(o) }))}
          />
        </Field>
        <Button variant="outline" size="sm" onClick={onDelete}>
          <Trash2 className="size-3.5" />
          Delete edge
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-4" data-workflow-inspector="workflow">
      <Field label="Workflow name">
        <Input value={workflow.name} onChange={(e) => onWorkflow({ name: e.target.value })} className="h-8" />
      </Field>
      <Field label="Description">
        <Textarea value={workflow.description ?? ''} onChange={(e) => onWorkflow({ description: e.target.value })} className="min-h-16 text-xs" />
      </Field>
      <div className="space-y-1.5">
        <Label className="text-xs">Checks</Label>
        {issues.length === 0 ? (
          <p className="text-xs text-status-success">Ready to run.</p>
        ) : (
          <ul className="space-y-1" data-workflow-issues>
            {issues.map((issue, i) => (
              <li key={i}>
                <button
                  type="button"
                  className="flex w-full items-start gap-1.5 rounded px-1 py-0.5 text-left text-xs hover:bg-accent"
                  onClick={() => onSelectIssue(issue)}
                >
                  <span
                    className={
                      issue.level === 'error'
                        ? 'mt-1 size-1.5 shrink-0 rounded-full bg-destructive'
                        : 'mt-1 size-1.5 shrink-0 rounded-full bg-status-warning'
                    }
                  />
                  <span>{issue.message}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <p className="text-[11px] text-muted-foreground">
        Drag from a step's right handle to another step to add an edge; select a step or edge to edit it. Delete removes the
        selection.
      </p>
    </div>
  )
}
