import {
  AUTOMATION_DEFAULT_GRACE_MINUTES,
  automationScheduleFields,
  buildAutomationRrule,
  type Automation,
  type AutomationInput,
  type AutomationScheduleFields,
  type AutomationSourceTriggerKind,
  type AutomationTrigger,
  type Bot,
  type ChatAgentId,
  type ChatEffort,
  type ChatPermissionMode
} from '@zomfy/protocol'
import { botTargetOf, initialBotDraft, sourceTriggerOf, type BotAutomationDraft } from './bot-automation'

// The automation editor's draft as pure functions (components/automations/AutomationEditorDialog.tsx),
// for a plain automation and for a bot's schedule or trigger.

export type DraftTriggerKind = Exclude<AutomationTrigger['kind'], AutomationSourceTriggerKind>

/** Select values cannot be empty strings; this stands for "any". */
export const ANY = '__any__'

export interface AutomationDraft {
  hostId: string
  name: string
  prompt: string
  agent: ChatAgentId
  effort: ChatEffort | 'default'
  permissionMode: ChatPermissionMode
  triggerKind: DraftTriggerKind
  schedule: AutomationScheduleFields
  workspaceId: string
  projectId: string
  reuseSession: boolean
  enabled: boolean
  graceMinutes: string
  /** A bot's automation: runs in the bot's home with its agent. */
  bot: BotAutomationDraft | null
}

/** The bot an automation is made for, and whether it is a schedule or a trigger. */
export interface BotPreset {
  bot: Pick<Bot, 'id' | 'agent' | 'homeWorkspaceId' | 'permissionMode'>
  mode: 'schedule' | 'trigger'
}

export function initialAutomationDraft(
  existing: (Automation & { hostId: string }) | null,
  defaultWorkspace: { id: string; hostId: string } | null,
  localHost: string,
  preset: BotPreset | null = null
): AutomationDraft {
  const trigger = existing?.trigger
  const bot = preset ? initialBotDraft(preset.bot, preset.mode, existing) : null
  return {
    hostId: existing?.hostId ?? (preset ? localHost : (defaultWorkspace?.hostId ?? localHost)),
    name: existing?.name ?? '',
    prompt: existing?.prompt ?? '',
    agent: existing?.agent ?? preset?.bot.agent ?? 'claude',
    effort: existing ? (existing.effort ?? 'default') : 'low',
    permissionMode: existing?.permissionMode ?? preset?.bot.permissionMode ?? 'default',
    triggerKind: trigger?.kind === 'workspace-created' || trigger?.kind === 'agent-finished' ? trigger.kind : 'schedule',
    schedule: (trigger?.kind === 'schedule' && automationScheduleFields(trigger.rrule)) || {
      preset: 'weekdays',
      hour: 9,
      minute: 0,
      dayOfWeek: 1
    },
    workspaceId: preset
      ? preset.bot.homeWorkspaceId
      : ((trigger?.kind === 'agent-finished' ? trigger.workspaceId : existing?.workspaceId) ??
        (existing ? ANY : (defaultWorkspace?.id ?? ''))),
    projectId: (trigger?.kind === 'workspace-created' ? trigger.projectId : null) ?? ANY,
    reuseSession: existing?.reuseSession ?? false,
    enabled: existing?.enabled ?? true,
    graceMinutes: String(existing?.missedRunGraceMinutes ?? AUTOMATION_DEFAULT_GRACE_MINUTES),
    bot
  }
}

export function automationInputOf(d: AutomationDraft): AutomationInput {
  const workspaceId = d.workspaceId && d.workspaceId !== ANY ? d.workspaceId : null
  const grace = Number(d.graceMinutes)
  const schedule = d.bot ? d.bot.mode === 'schedule' : d.triggerKind === 'schedule'
  const trigger: AutomationTrigger = schedule
    ? { kind: 'schedule', rrule: buildAutomationRrule(d.schedule) }
    : d.bot
      ? sourceTriggerOf(d.bot)
      : d.triggerKind === 'workspace-created'
        ? { kind: 'workspace-created', projectId: d.projectId === ANY ? null : d.projectId }
        : { kind: 'agent-finished', workspaceId }
  return {
    name: d.name,
    prompt: d.prompt,
    agent: d.agent,
    effort: d.agent === 'claude' && d.effort !== 'default' ? d.effort : null,
    permissionMode: d.permissionMode,
    trigger,
    // A bot's runs are always in its home.
    workspaceId: d.bot || schedule ? workspaceId : null,
    reuseSession: d.reuseSession,
    enabled: d.enabled,
    ...(Number.isFinite(grace) && grace > 0 ? { missedRunGraceMinutes: grace } : {}),
    ...(d.bot ? { bot: botTargetOf(d.bot) } : {})
  }
}
