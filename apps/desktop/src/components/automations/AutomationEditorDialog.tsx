import { useMemo, useState } from 'react'
import {
  AUTOMATION_DEFAULT_GRACE_MINUTES,
  HARNESS_METHODS,
  automationScheduleFields,
  buildAutomationRrule,
  isChatAgentId,
  type AutomationInput,
  type AutomationSchedulePreset,
  type AutomationScheduleFields,
  type AutomationTrigger,
  type ChatAgentId,
  type ChatEffort,
  type ChatPermissionMode
} from '@acp-harness/protocol'
import { harnessRequest } from '@/daemon-connection'
import { LOCAL_HOST, allProjects, allWorkspaces, useStore, type HostId } from '@/session-store'
import { selectAutomation, type HostedAutomation } from '@/stores/automation-store'
import { useChatAgents } from '@/lib/chat-agents'
import { TuiAgentIcon } from '@/components/terminal/TuiAgentIcon'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { t } from '@/i18n/i18n'

// Fields follow Orca's AutomationEditorDialog (prompt, schedule picker, workspace, agent,
// reuse session); event triggers are the harness's addition.

type TriggerKind = AutomationTrigger['kind']
const TRIGGER_LABEL: Record<TriggerKind, string> = {
  schedule: t('On a schedule'),
  'workspace-created': t('When a workspace is created'),
  'agent-finished': t('When an agent finishes a turn')
}
const PRESET_LABEL: Record<AutomationSchedulePreset, string> = {
  hourly: t('Hourly'),
  daily: t('Daily'),
  weekdays: t('Weekdays'),
  weekly: t('Weekly')
}
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const EFFORTS: ChatEffort[] = ['low', 'medium', 'high', 'xhigh', 'max']
const PERMISSION_LABEL: Record<ChatPermissionMode, string> = {
  default: t('Ask before acting'),
  acceptEdits: t('Accept edits'),
  plan: t('Plan only'),
  auto: t('Auto'),
  bypassPermissions: t('Bypass permissions')
}
const TRIGGER_KINDS: TriggerKind[] = ['schedule', 'workspace-created', 'agent-finished']
const PRESETS: AutomationSchedulePreset[] = ['hourly', 'daily', 'weekdays', 'weekly']
const PERMISSION_MODES: ChatPermissionMode[] = ['default', 'acceptEdits', 'plan', 'auto', 'bypassPermissions']
/** Select values cannot be empty strings; this stands for "any". */
const ANY = '__any__'

interface Draft {
  hostId: HostId
  name: string
  prompt: string
  agent: ChatAgentId
  effort: ChatEffort | 'default'
  permissionMode: ChatPermissionMode
  triggerKind: TriggerKind
  schedule: AutomationScheduleFields
  workspaceId: string
  projectId: string
  reuseSession: boolean
  enabled: boolean
  graceMinutes: string
}

function initialDraft(existing: HostedAutomation | null, defaultWorkspace: { id: string; hostId: HostId } | null): Draft {
  const trigger = existing?.trigger
  return {
    hostId: existing?.hostId ?? defaultWorkspace?.hostId ?? LOCAL_HOST,
    name: existing?.name ?? '',
    prompt: existing?.prompt ?? '',
    agent: existing?.agent ?? 'claude',
    effort: existing ? (existing.effort ?? 'default') : 'low',
    permissionMode: existing?.permissionMode ?? 'default',
    triggerKind: trigger?.kind ?? 'schedule',
    schedule: (trigger?.kind === 'schedule' && automationScheduleFields(trigger.rrule)) || {
      preset: 'weekdays',
      hour: 9,
      minute: 0,
      dayOfWeek: 1
    },
    workspaceId:
      (trigger?.kind === 'agent-finished' ? trigger.workspaceId : existing?.workspaceId) ??
      (existing ? ANY : (defaultWorkspace?.id ?? '')),
    projectId: (trigger?.kind === 'workspace-created' ? trigger.projectId : null) ?? ANY,
    reuseSession: existing?.reuseSession ?? false,
    enabled: existing?.enabled ?? true,
    graceMinutes: String(existing?.missedRunGraceMinutes ?? AUTOMATION_DEFAULT_GRACE_MINUTES)
  }
}

function toInput(d: Draft): AutomationInput {
  const workspaceId = d.workspaceId && d.workspaceId !== ANY ? d.workspaceId : null
  const trigger: AutomationTrigger =
    d.triggerKind === 'schedule'
      ? { kind: 'schedule', rrule: buildAutomationRrule(d.schedule) }
      : d.triggerKind === 'workspace-created'
        ? { kind: 'workspace-created', projectId: d.projectId === ANY ? null : d.projectId }
        : { kind: 'agent-finished', workspaceId }
  const grace = Number(d.graceMinutes)
  return {
    name: d.name,
    prompt: d.prompt,
    agent: d.agent,
    effort: d.agent === 'claude' && d.effort !== 'default' ? d.effort : null,
    permissionMode: d.permissionMode,
    trigger,
    workspaceId: d.triggerKind === 'schedule' ? workspaceId : null,
    reuseSession: d.reuseSession,
    enabled: d.enabled,
    ...(Number.isFinite(grace) && grace > 0 ? { missedRunGraceMinutes: grace } : {})
  }
}

export function AutomationEditorDialog({
  open,
  existing,
  defaultWorkspace,
  onOpenChange
}: {
  open: boolean
  existing: HostedAutomation | null
  defaultWorkspace: { id: string; hostId: HostId } | null
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl" data-automation-editor>
        {open ? (
          <EditorBody existing={existing} defaultWorkspace={defaultWorkspace} onDone={() => onOpenChange(false)} />
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

function EditorBody({
  existing,
  defaultWorkspace,
  onDone
}: {
  existing: HostedAutomation | null
  defaultWorkspace: { id: string; hostId: HostId } | null
  onDone: () => void
}) {
  const [draft, setDraft] = useState(() => initialDraft(existing, defaultWorkspace))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const hosts = useStore((s) => s.hosts)
  const patch = (change: Partial<Draft>) => setDraft((d) => ({ ...d, ...change }))
  const { agents } = useChatAgents(draft.hostId)
  const readyAgents = agents.filter((a) => a.id !== 'claude' && a.status === 'ready')
  const connectedHosts = Object.values(hosts).filter((h) => h.connection.kind === 'connected')
  const workspaces = useMemo(
    () => allWorkspaces({ hosts }).filter((w) => w.hostId === draft.hostId),
    [hosts, draft.hostId]
  )
  const projects = useMemo(() => allProjects(hosts).filter((p) => p.hostId === draft.hostId), [hosts, draft.hostId])

  async function save() {
    setSaving(true)
    setError(null)
    try {
      const input = toInput(draft)
      const saved = existing
        ? await harnessRequest(HARNESS_METHODS.automationUpdate, { id: existing.id, patch: input }, existing.hostId)
        : await harnessRequest(HARNESS_METHODS.automationCreate, { input }, draft.hostId)
      selectAutomation(saved.id)
      onDone()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  const time = `${String(draft.schedule.hour).padStart(2, '0')}:${String(draft.schedule.minute).padStart(2, '0')}`
  return (
    <>
      <DialogHeader>
        <DialogTitle>{existing ? t('Edit automation') : t('New automation')}</DialogTitle>
        <DialogDescription>
          {t('The host runs it, in a chat you can open from its run history, even while this window is closed.')}
        </DialogDescription>
      </DialogHeader>
      <div className="grid gap-4">
        <Field label={t('Name')}>
          <Input
            value={draft.name}
            placeholder={t('Morning triage')}
            data-automation-field="name"
            onChange={(e) => patch({ name: e.target.value })}
          />
        </Field>
        <Field label={t('Prompt')}>
          <Textarea
            value={draft.prompt}
            rows={5}
            placeholder={t('Summarize what changed since yesterday and list anything that needs me.')}
            data-automation-field="prompt"
            onChange={(e) => patch({ prompt: e.target.value })}
          />
        </Field>
        {connectedHosts.length > 1 && !existing ? (
          <Field label={t('Host')}>
            <Select
              value={draft.hostId}
              onValueChange={(hostId) => patch({ hostId, workspaceId: '', projectId: ANY })}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent position="popper">
                {connectedHosts.map((h) => (
                  <SelectItem key={h.id} value={h.id}>
                    {h.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        ) : null}
        <Field label={t('Trigger')}>
          <Select
            value={draft.triggerKind}
            onValueChange={(value) => {
              const kind = TRIGGER_KINDS.find((k) => k === value)
              if (kind) patch({ triggerKind: kind })
            }}
          >
            <SelectTrigger className="w-full" data-automation-field="trigger">
              <SelectValue />
            </SelectTrigger>
            <SelectContent position="popper">
              {TRIGGER_KINDS.map((kind) => (
                <SelectItem key={kind} value={kind}>
                  {TRIGGER_LABEL[kind]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        {draft.triggerKind === 'schedule' ? (
          <div className="grid grid-cols-3 gap-3">
            <Field label={t('Cadence')}>
              <Select
                value={draft.schedule.preset}
                onValueChange={(value) => {
                  const preset = PRESETS.find((p) => p === value)
                  if (preset) patch({ schedule: { ...draft.schedule, preset } })
                }}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent position="popper">
                  {PRESETS.map((p) => (
                    <SelectItem key={p} value={p}>
                      {PRESET_LABEL[p]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            {draft.schedule.preset === 'weekly' ? (
              <Field label={t('Day')}>
                <Select
                  value={String(draft.schedule.dayOfWeek)}
                  onValueChange={(value) => patch({ schedule: { ...draft.schedule, dayOfWeek: Number(value) } })}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent position="popper">
                    {DAY_NAMES.map((day, index) => (
                      <SelectItem key={day} value={String(index)}>
                        {t(day)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            ) : null}
            <Field label={draft.schedule.preset === 'hourly' ? t('Minute') : t('Time')}>
              {draft.schedule.preset === 'hourly' ? (
                <Input
                  type="number"
                  min={0}
                  max={59}
                  value={draft.schedule.minute}
                  onChange={(e) => patch({ schedule: { ...draft.schedule, minute: Number(e.target.value) || 0 } })}
                />
              ) : (
                <Input
                  type="time"
                  value={time}
                  data-automation-field="time"
                  onChange={(e) => {
                    const [h, m] = e.target.value.split(':').map(Number)
                    patch({ schedule: { ...draft.schedule, hour: h ?? 0, minute: m ?? 0 } })
                  }}
                />
              )}
            </Field>
          </div>
        ) : null}
        {draft.triggerKind === 'workspace-created' ? (
          <Field label={t('Project')} hint={t('The run uses the new workspace.')}>
            <Select value={draft.projectId} onValueChange={(projectId) => patch({ projectId })}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent position="popper">
                <SelectItem value={ANY}>{t('Any project')}</SelectItem>
                {projects.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.displayName || p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        ) : (
          <Field
            label={t('Workspace')}
            hint={draft.triggerKind === 'agent-finished' ? t('The run goes to the workspace whose agent finished.') : undefined}
          >
            <Select value={draft.workspaceId} onValueChange={(workspaceId) => patch({ workspaceId })}>
              <SelectTrigger className="w-full" data-automation-field="workspace">
                <SelectValue placeholder={t('Pick a workspace')} />
              </SelectTrigger>
              <SelectContent position="popper">
                {draft.triggerKind === 'agent-finished' ? <SelectItem value={ANY}>{t('Any workspace')}</SelectItem> : null}
                {workspaces.map((w) => (
                  <SelectItem key={w.id} value={w.id}>
                    {w.displayName || w.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('Agent')}>
            <Select value={draft.agent} onValueChange={(value) => isChatAgentId(value) && patch({ agent: value })}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent position="popper">
                <SelectItem value="claude">
                  <TuiAgentIcon agent="claude" size={14} />
                  Claude
                </SelectItem>
                {readyAgents.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    <TuiAgentIcon agent={a.id} size={14} />
                    {a.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          {draft.agent === 'claude' ? (
            <Field label={t('Effort')}>
              <Select
                value={draft.effort}
                onValueChange={(value) => {
                  const effort = EFFORTS.find((e) => e === value)
                  patch({ effort: effort ?? 'default' })
                }}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent position="popper">
                  <SelectItem value="default">{t("Claude's default")}</SelectItem>
                  {EFFORTS.map((e) => (
                    <SelectItem key={e} value={e}>
                      {e}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          ) : null}
        </div>
        <Field
          label={t('Permissions')}
          hint={t('Asks go to an open window; with none open they are denied, so unattended runs need a mode that does not ask.')}
        >
          <Select
            value={draft.permissionMode}
            onValueChange={(value) => {
              const mode = PERMISSION_MODES.find((m) => m === value)
              if (mode) patch({ permissionMode: mode })
            }}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent position="popper">
              {PERMISSION_MODES.map((m) => (
                <SelectItem key={m} value={m}>
                  {PERMISSION_LABEL[m]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <ToggleRow
          label={t("Continue the previous run's chat")}
          checked={draft.reuseSession}
          onChange={(reuseSession) => patch({ reuseSession })}
        />
        {draft.triggerKind === 'schedule' ? (
          <Field label={t('Skip a run missed by more than (minutes)')}>
            <Input
              type="number"
              min={1}
              value={draft.graceMinutes}
              onChange={(e) => patch({ graceMinutes: e.target.value })}
              className="w-32"
            />
          </Field>
        ) : null}
        <ToggleRow label={t('Enabled')} checked={draft.enabled} onChange={(enabled) => patch({ enabled })} />
        {error ? <p className="text-xs text-destructive">{error}</p> : null}
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onDone}>
          {t('Cancel')}
        </Button>
        <Button disabled={saving} data-automation-save onClick={() => void save()}>
          {saving ? t('Saving…') : existing ? t('Save') : t('Create')}
        </Button>
      </DialogFooter>
    </>
  )
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="grid min-w-0 gap-1.5">
      <Label className="text-xs">{label}</Label>
      {children}
      {hint ? <p className="text-[11px] text-muted-foreground">{hint}</p> : null}
    </div>
  )
}

function ToggleRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center justify-between gap-3 text-sm">
      {label}
      <Switch checked={checked} onCheckedChange={onChange} />
    </label>
  )
}
