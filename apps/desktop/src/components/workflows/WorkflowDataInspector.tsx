import { Lock, Trash2 } from 'lucide-react'
import type { Workflow, WorkflowDataLink, WorkflowDataSource } from '@acp-harness/protocol'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'

// The side panel for a data source (what it is, who may see it) and for one step's use of it.

export function WorkflowDataPanel({
  workflow,
  source,
  onChange,
  onDelete
}: {
  workflow: Workflow
  source: WorkflowDataSource
  onChange: (patch: Partial<WorkflowDataSource>) => void
  onDelete: () => void
}) {
  const steps = (workflow.dataLinks ?? []).filter((l) => l.dataId === source.id)
  const label = (id: string) => workflow.nodes.find((n) => n.id === id)?.label ?? '?'
  return (
    <div className="space-y-4" data-workflow-inspector="data">
      <div className="space-y-1.5">
        <Label className="text-xs">Name</Label>
        <Input value={source.name} onChange={(e) => onChange({ name: e.target.value })} className="h-8" />
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs">Path</Label>
        <Input
          value={source.path}
          placeholder="C:\data\customers or docs/specs"
          onChange={(e) => onChange({ path: e.target.value })}
          className="h-8 font-mono text-xs"
        />
        <p className="text-[11px] text-muted-foreground">A file or folder: absolute, or relative to the step's workspace.</p>
      </div>
      <div className="flex items-start justify-between gap-3" data-workflow-data-local-only>
        <div className="space-y-0.5">
          <div className="flex items-center gap-1 text-xs font-medium">
            <Lock className="size-3 text-status-warning" />
            Local only
          </div>
          <p className="text-[11px] text-muted-foreground">
            Only agents on a local model may use it, and what they learn from it goes on only to local agents and you, never to a
            cloud agent or the chat that started the run.
          </p>
        </div>
        <Switch checked={source.localOnly === true} onCheckedChange={(on) => onChange({ localOnly: on || undefined })} aria-label="Local only" />
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs">Note</Label>
        <Textarea
          value={source.note ?? ''}
          placeholder="What it holds, how to use it"
          onChange={(e) => onChange({ note: e.target.value || undefined })}
          className="min-h-16 text-xs"
        />
        <p className="text-[11px] text-muted-foreground">Told to the steps that use it.</p>
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs">Used by</Label>
        {steps.length === 0 ? (
          <p className="text-[11px] text-muted-foreground">No step yet. Drag from the card's bottom handle onto a step.</p>
        ) : (
          <ul className="space-y-0.5 text-xs">
            {steps.map((l) => (
              <li key={l.id}>
                {label(l.nodeId)} <span className="text-muted-foreground">({l.write ? 'reads and writes' : 'reads'})</span>
              </li>
            ))}
          </ul>
        )}
        <p className="text-[11px] text-muted-foreground">
          Other steps may not use it: Zomfy refuses Claude steps the files. Other agents are simply not told of it, so keep sensitive
          data outside the project.
        </p>
      </div>
      <Button variant="outline" size="sm" onClick={onDelete}>
        <Trash2 className="size-3.5" />
        Delete data
      </Button>
    </div>
  )
}

export function WorkflowDataLinkPanel({
  workflow,
  link,
  onChange,
  onDelete
}: {
  workflow: Workflow
  link: WorkflowDataLink
  onChange: (patch: Partial<WorkflowDataLink>) => void
  onDelete: () => void
}) {
  const source = workflow.data?.find((d) => d.id === link.dataId)
  const step = workflow.nodes.find((n) => n.id === link.nodeId)
  return (
    <div className="space-y-4" data-workflow-inspector="data-link">
      <p className="text-xs text-muted-foreground">
        <span className="font-medium text-foreground">{step?.label}</span> uses{' '}
        <span className="font-medium text-foreground">{source?.name}</span>
      </p>
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-0.5">
          <div className="text-xs font-medium">May change it</div>
          <p className="text-[11px] text-muted-foreground">Off: read only. Claude steps are refused edits through their file tools; a shell command can still change it.</p>
        </div>
        <Switch checked={link.write === true} onCheckedChange={(on) => onChange({ write: on || undefined })} aria-label="May change it" />
      </div>
      <Button variant="outline" size="sm" onClick={onDelete}>
        <Trash2 className="size-3.5" />
        Remove access
      </Button>
    </div>
  )
}
