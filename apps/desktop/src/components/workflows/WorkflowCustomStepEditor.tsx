import { Plus, X } from 'lucide-react'
import type { WorkflowField, WorkflowNodeConfig } from '@acp-harness/protocol'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { t } from '@/i18n/i18n'

// A custom step's own settings: fields (filled in here, used as {{key}} in its prompt or command)
// and the outcomes it can end in, each of which can lead somewhere on the canvas.

const FIELD_TYPES: { value: WorkflowField['type']; label: string }[] = [
  { value: 'text', label: t('Text') },
  { value: 'number', label: t('Number') },
  { value: 'boolean', label: t('On / off') },
  { value: 'select', label: t('Choice') }
]

function emptyValue(type: WorkflowField['type'], options?: string[]): WorkflowField['value'] {
  if (type === 'number') return 0
  if (type === 'boolean') return false
  if (type === 'select') return options?.[0] ?? ''
  return ''
}

function FieldValue({ field, onChange }: { field: WorkflowField; onChange: (value: WorkflowField['value']) => void }) {
  if (field.type === 'boolean') {
    return <Switch checked={field.value === true} onCheckedChange={onChange} aria-label={t('{name} value', { name: field.label || field.key })} />
  }
  if (field.type === 'select') {
    const options = (field.options ?? []).filter((o) => o.trim())
    return (
      <Select value={String(field.value)} onValueChange={onChange} disabled={options.length === 0}>
        <SelectTrigger className="h-7 w-full text-xs" aria-label={t('{name} value', { name: field.label || field.key })}>
          <SelectValue placeholder={t('Add choices first')} />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o} value={o}>
              {o}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    )
  }
  return (
    <Input
      type={field.type === 'number' ? 'number' : 'text'}
      value={String(field.value)}
      onChange={(e) => onChange(field.type === 'number' ? Number(e.target.value) : e.target.value)}
      className="h-7 text-xs"
      aria-label={t('{name} value', { name: field.label || field.key })}
    />
  )
}

export function CustomStepEditor({ config, onChange }: { config: WorkflowNodeConfig; onChange: (patch: Partial<WorkflowNodeConfig>) => void }) {
  const fields = config.fields ?? []
  const outcomes = config.outcomes ?? []
  const setField = (id: string, patch: Partial<WorkflowField>) =>
    onChange({ fields: fields.map((f) => (f.id === id ? { ...f, ...patch } : f)) })

  return (
    <>
      <div className="space-y-2" data-workflow-fields>
        <div className="flex items-center justify-between">
          <Label className="text-xs">{t('Fields')}</Label>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-1.5 text-xs"
            onClick={() =>
              onChange({
                fields: [...fields, { id: crypto.randomUUID(), key: `field${fields.length + 1}`, label: '', type: 'text', value: '' }]
              })
            }
          >
            <Plus className="size-3" />
            {t('Add field')}
          </Button>
        </div>
        {fields.length === 0 && <p className="text-[11px] text-muted-foreground">{t('Settings this step takes, used as {{key}} in its text.')}</p>}
        {fields.map((field) => (
          <div key={field.id} className="space-y-1.5 rounded-md border border-border p-2" data-workflow-field={field.key}>
            <div className="flex items-center gap-1.5">
              <Input
                value={field.key}
                onChange={(e) => setField(field.id, { key: e.target.value.replace(/\s+/g, '_') })}
                className="h-7 w-24 font-mono text-xs"
                aria-label={t('Field key')}
              />
              <Input
                value={field.label}
                placeholder={t('Label')}
                onChange={(e) => setField(field.id, { label: e.target.value })}
                className="h-7 flex-1 text-xs"
                aria-label={t('Field label')}
              />
              <Button
                variant="ghost"
                size="icon"
                className="size-6 shrink-0"
                aria-label={t('Remove field')}
                onClick={() => onChange({ fields: fields.filter((f) => f.id !== field.id) })}
              >
                <X className="size-3.5" />
              </Button>
            </div>
            <div className="flex items-center gap-1.5">
              <Select
                value={field.type}
                onValueChange={(v) => {
                  const type = FIELD_TYPES.find((ft) => ft.value === v)?.value
                  if (type) setField(field.id, { type, value: emptyValue(type, field.options) })
                }}
              >
                <SelectTrigger className="h-7 w-24 shrink-0 text-xs" aria-label={t('Field type')}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {FIELD_TYPES.map((ft) => (
                    <SelectItem key={ft.value} value={ft.value}>
                      {ft.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="min-w-0 flex-1">
                <FieldValue field={field} onChange={(value) => setField(field.id, { value })} />
              </div>
            </div>
            {field.type === 'select' && (
              <Input
                value={(field.options ?? []).join(', ')}
                placeholder={t('Choices, comma separated')}
                onChange={(e) => setField(field.id, { options: e.target.value.split(',').map((o) => o.trim()) })}
                className="h-7 text-xs"
                aria-label={t('Field choices')}
              />
            )}
          </div>
        ))}
      </div>

      <div className="space-y-2" data-workflow-outcomes>
        <div className="flex items-center justify-between">
          <Label className="text-xs">{t('Outcomes')}</Label>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-1.5 text-xs"
            onClick={() => onChange({ outcomes: [...outcomes, `outcome${outcomes.length + 1}`] })}
          >
            <Plus className="size-3" />
            {t('Add outcome')}
          </Button>
        </div>
        <p className="text-[11px] text-muted-foreground">
          {config.runner === 'command'
            ? t('None: the exit code decides (Passed / Failed). With outcomes, the command prints one of them as its last line.')
            : t('None: the step just goes on (Then). With outcomes, the agent must end by choosing one; each can lead to a different step.')}
        </p>
        {outcomes.map((outcome, index) => (
          <div key={index} className="flex items-center gap-1.5">
            <Input
              value={outcome}
              onChange={(e) => onChange({ outcomes: outcomes.map((o, i) => (i === index ? e.target.value : o)) })}
              className="h-7 flex-1 text-xs"
              aria-label={t('Outcome name')}
            />
            <Button
              variant="ghost"
              size="icon"
              className="size-6 shrink-0"
              aria-label={t('Remove outcome')}
              onClick={() => onChange({ outcomes: outcomes.filter((_, i) => i !== index) })}
            >
              <X className="size-3.5" />
            </Button>
          </div>
        ))}
      </div>
    </>
  )
}
