import { useMemo, useState } from 'react'
import { sameFormValue } from '@/lib/use-save-state'
import {
  HARNESS_METHODS,
  isChatAgentId,
  type AutomationSchedulePreset,
  type Bot,
  type ChatEffort,
  type ChatPermissionMode,
  isGuardedChatAgent
} from '@zomfy/protocol'
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
import { projectLabel } from '@/components/sidebar/workspace-visibility'
import { useProjectCatalog } from '@/stores/project-catalog-store'
import { useBots } from '@/stores/bots-store'
import {
  ANY,
  automationInputOf,
  initialAutomationDraft,
  type AutomationDraft,
  type BotPreset,
  type DraftTriggerKind
} from '@/lib/automation-draft'
import { botDraftProblem, type BotAutomationDraft } from '@/lib/bot-automation'
import { BotAutomationFields } from './BotAutomationFields'

// Fields follow Orca's AutomationEditorDialog (prompt, schedule picker, workspace, agent,
// reuse session); event triggers are the harness's addition. With a bot (Settings → Bots), it makes
// that bot's schedule or source trigger: the run is in the bot's home with its agent.

type TriggerKind = DraftTriggerKind
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
export function AutomationEditorDialog({
  open,
  existing,
  defaultWorkspace,
  botPreset = null,
  onOpenChange
}: {
  open: boolean
  existing: HostedAutomation | null
  defaultWorkspace: { id: string; hostId: HostId } | null
  /** A new automation for this bot: a schedule or a source trigger. */
  botPreset?: { bot: Bot; mode: 'schedule' | 'trigger' } | null
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl" data-automation-editor>
        {open ? (
          <EditorBody existing={existing} defaultWorkspace={defaultWorkspace} botPreset={botPreset} onDone={() => onOpenChange(false)} />
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

/** The bot an automation belongs to: the one it was opened for, or the saved automation's. */
function useBotPreset(existing: HostedAutomation | null, botPreset: { bot: Bot; mode: 'schedule' | 'trigger' } | null): BotPreset | null {
  const bots = useBots((s) => s.bots)
  if (botPreset) return botPreset
  const target = existing?.bot
  if (!existing || !target) return null
  const bot = bots?.find((b) => b.id === target.botId) ?? {
    id: target.botId,
    agent: existing.agent,
    homeWorkspaceId: existing.workspaceId ?? '',
    permissionMode: existing.permissionMode
  }
  return { bot, mode: existing.trigger.kind === 'schedule' ? 'schedule' : 'trigger' }
}

function EditorBody({
  existing,
  defaultWorkspace,
  botPreset,
  onDone
}: {
  existing: HostedAutomation | null
  defaultWorkspace: { id: string; hostId: HostId } | null
  botPreset: { bot: Bot; mode: 'schedule' | 'trigger' } | null
  onDone: () => void
}) {
  const preset = useBotPreset(existing, botPreset)
  const [initialDraft] = useState<AutomationDraft>(() => initialAutomationDraft(existing, defaultWorkspace, LOCAL_HOST, preset))
  const [draft, setDraft] = useState<AutomationDraft>(initialDraft)
  // An automation already saved is saved again only when something differs.
  const dirty = !existing || !sameFormValue(initialDraft, draft)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const hosts = useStore((s) => s.hosts)
  const patch = (change: Partial<AutomationDraft>) => setDraft((d) => ({ ...d, ...change }))
  const patchBot = (change: Partial<BotAutomationDraft>) => setDraft((d) => (d.bot ? { ...d, bot: { ...d.bot, ...change } } : d))
  const bot = draft.bot
  const showSchedule = bot ? bot.mode === 'schedule' : draft.triggerKind === 'schedule'
  const botProblem = bot ? botDraftProblem(bot) : null
  const { agents } = useChatAgents(draft.hostId)
  // Antigravity never runs on a schedule (GUARDED_CHAT_AGENTS).
  const readyAgents = agents.filter((a) => a.id !== 'claude' && a.status === 'ready' && !isGuardedChatAgent(a.id))
  const connectedHosts = Object.values(hosts).filter((h) => h.connection.kind === 'connected')
  const workspaces = useMemo(
    () => allWorkspaces({ hosts }).filter((w) => w.hostId === draft.hostId),
    [hosts, draft.hostId]
  )
  useProjectCatalog()
  const projects = useMemo(() => allProjects(hosts).filter((p) => p.hostId === draft.hostId), [hosts, draft.hostId])

  async function save() {
    setSaving(true)
    setError(null)
    try {
      const input = automationInputOf(draft)
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
        <DialogTitle>
          {bot
            ? existing
              ? bot.mode === 'schedule'
                ? t('Edit schedule')
                : t('Edit trigger')
              : bot.mode === 'schedule'
                ? t('New schedule')
                : t('New trigger')
            : existing
              ? t('Edit automation')
              : t('New automation')}
        </DialogTitle>
        <DialogDescription>
          {t('The host runs it, in a thread you can open from its run history, even while this window is closed.')}
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
        {connectedHosts.length > 1 && !existing && !bot ? (
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
        {bot ? (
          <BotAutomationFields draft={bot} isNew={!existing} onChange={patchBot} />
        ) : (
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
        )}
        {showSchedule ? (
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
        {bot ? null : draft.triggerKind === 'workspace-created' ? (
          <Field label={t('Project')} hint={t('The run uses the new workspace.')}>
            <Select value={draft.projectId} onValueChange={(projectId) => patch({ projectId })}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent position="popper">
                <SelectItem value={ANY}>{t('Any project')}</SelectItem>
                {projects.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {projectLabel(p)}
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
          {bot ? null : (
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
          )}
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
        {bot ? null : (
          <ToggleRow
            label={t("Continue the previous run's thread")}
            checked={draft.reuseSession}
            onChange={(reuseSession) => patch({ reuseSession })}
          />
        )}
        {showSchedule ? (
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
        {botProblem ? (
          <p className="text-xs text-muted-foreground" data-automation-problem={botProblem}>
            {botProblem === 'chat'
              ? t('Pick the chat it continues.')
              : botProblem === 'ref'
                ? t('Name the place results go to.')
                : t('Create a webhook URL first.')}
          </p>
        ) : null}
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onDone}>
          {t('Cancel')}
        </Button>
        <Button disabled={saving || !dirty || botProblem !== null} data-automation-save onClick={() => void save()}>
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
