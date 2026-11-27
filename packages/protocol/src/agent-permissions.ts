// Zomfy's permission modes on agents other than Claude (docs/specs/codex-and-acp-parity.md).
// Codex takes them as codex-acp's `mode` and `collaboration_mode` options; Direct (App Server)
// offers the same two options, so one mapping serves both connections. Other ACP agents take
// them as whichever of their session modes has a matching id.

import { CHAT_AGENT_OPTION_IDS, type ChatAgentId, type ChatAgentOption } from './chat-agents'
import type { ChatPermissionMode } from './sessions'

/** The modes in the order pickers list them. */
export const PERMISSION_MODE_ORDER: readonly ChatPermissionMode[] = ['default', 'acceptEdits', 'plan', 'auto', 'bypassPermissions']

/** codex-acp's option ids, which Direct offers too. */
export const CODEX_MODE_OPTION = 'mode'
export const CODEX_COLLABORATION_OPTION = 'collaboration_mode'

export type CodexApprovalPolicy = 'on-request' | 'never'
export type CodexApprovalsReviewer = 'user' | 'auto_review'
export type CodexSandboxMode = 'read-only' | 'workspace-write' | 'danger-full-access'

export interface CodexModePreset {
  /** codex-acp's `mode` value. */
  mode: string
  /** codex-acp's `collaboration_mode` value. */
  collaboration: 'default' | 'plan'
}

/** Each Zomfy mode as codex-acp's mode and collaboration mode. */
export const CODEX_PERMISSION_MODES: Record<ChatPermissionMode, CodexModePreset> = {
  default: { mode: 'read-only', collaboration: 'default' },
  acceptEdits: { mode: 'workspace-write', collaboration: 'default' },
  plan: { mode: 'read-only', collaboration: 'plan' },
  auto: { mode: 'agent', collaboration: 'default' },
  bypassPermissions: { mode: 'agent-full-access', collaboration: 'default' }
}

/** codex-acp's modes as App Server fields: the presets codex-acp itself sends for each. */
export const CODEX_MODE_POLICIES: Record<string, { approvalPolicy: CodexApprovalPolicy; approvalsReviewer: CodexApprovalsReviewer; sandbox: CodexSandboxMode }> = {
  'read-only': { approvalPolicy: 'on-request', approvalsReviewer: 'user', sandbox: 'read-only' },
  'workspace-write': { approvalPolicy: 'on-request', approvalsReviewer: 'user', sandbox: 'workspace-write' },
  agent: { approvalPolicy: 'on-request', approvalsReviewer: 'auto_review', sandbox: 'workspace-write' },
  'agent-full-access': { approvalPolicy: 'never', approvalsReviewer: 'user', sandbox: 'danger-full-access' }
}

/** Session mode ids other ACP agents use for each Zomfy mode, first match wins. */
export const ACP_PERMISSION_MODE_IDS: Record<ChatPermissionMode, readonly string[]> = {
  default: ['default', 'read-only', 'ask', 'manual'],
  acceptEdits: ['acceptEdits', 'accept-edits', 'autoEdit', 'auto_edit', 'auto-edit', 'workspace-write'],
  plan: ['plan', 'read-only', 'architect'],
  auto: ['auto', 'agent', 'autoEdit', 'auto_edit'],
  bypassPermissions: ['bypassPermissions', 'yolo', 'agent-full-access', 'full-access', 'danger-full-access']
}

/** One option the agent's session is set to for a permission mode. */
export interface AgentOptionSetting {
  optionId: string
  value: string
}

/** The agent's session-mode option, when it has one. */
export function agentModeOption(options: readonly ChatAgentOption[]): ChatAgentOption | undefined {
  return options.find((o) => o.id === CODEX_MODE_OPTION && o.category === 'mode')
    ?? options.find((o) => o.category === 'mode')
    ?? options.find((o) => o.id === CHAT_AGENT_OPTION_IDS.mode)
}

function collaborationOption(options: readonly ChatAgentOption[]): ChatAgentOption | undefined {
  return options.find((o) => o.id === CODEX_COLLABORATION_OPTION)
}

const offers = (option: ChatAgentOption | undefined, value: string): option is ChatAgentOption =>
  !!option && option.choices.some((c) => c.value === value)

/** What to set on the agent's session for `mode`; null when the agent has no matching mode. */
export function agentPermissionSettings(
  agent: ChatAgentId,
  mode: ChatPermissionMode,
  options: readonly ChatAgentOption[]
): AgentOptionSetting[] | null {
  if (agent === 'claude') return null
  const modeOption = agentModeOption(options)
  if (agent === 'codex') {
    const preset = CODEX_PERMISSION_MODES[mode]
    if (!offers(modeOption, preset.mode)) return null
    const collaboration = collaborationOption(options)
    // Plan needs the collaboration mode; without it Codex is only read-only.
    if (mode === 'plan' && !offers(collaboration, preset.collaboration)) return null
    return [
      { optionId: modeOption.id, value: preset.mode },
      ...(offers(collaboration, preset.collaboration) ? [{ optionId: collaboration.id, value: preset.collaboration }] : [])
    ]
  }
  if (!modeOption) return null
  const value = ACP_PERMISSION_MODE_IDS[mode].find((id) => offers(modeOption, id))
  return value ? [{ optionId: modeOption.id, value }] : null
}

/**
 * The modes the agent can be put in, for its permission picker. Codex offers all five before its
 * session reports its options; another agent offers none until it reports session modes.
 */
export function agentPermissionModes(agent: ChatAgentId, options: readonly ChatAgentOption[]): ChatPermissionMode[] {
  if (agent === 'claude') return [...PERMISSION_MODE_ORDER]
  if (!agentModeOption(options)) return agent === 'codex' ? [...PERMISSION_MODE_ORDER] : []
  return PERMISSION_MODE_ORDER.filter((mode) => agentPermissionSettings(agent, mode, options) !== null)
}

/** Whether the agent's options are set as `mode` asks. */
export function agentInPermissionMode(agent: ChatAgentId, mode: ChatPermissionMode, options: readonly ChatAgentOption[]): boolean {
  const settings = agentPermissionSettings(agent, mode, options)
  return !!settings && settings.every((s) => options.find((o) => o.id === s.optionId)?.currentValue === s.value)
}

/**
 * The Zomfy mode the agent's options now stand for: `stored` when they still match it, else the
 * first mode that matches, else null (the agent is in a mode Zomfy has no name for).
 */
export function permissionModeOfAgent(
  agent: ChatAgentId,
  options: readonly ChatAgentOption[],
  stored: ChatPermissionMode
): ChatPermissionMode | null {
  if (agentInPermissionMode(agent, stored, options)) return stored
  return PERMISSION_MODE_ORDER.find((mode) => agentInPermissionMode(agent, mode, options)) ?? null
}

/** Option ids the permission picker drives, so the composer leaves out their own chips. */
export function permissionOptionIds(agent: ChatAgentId, options: readonly ChatAgentOption[]): string[] {
  if (agent === 'claude' || agentPermissionModes(agent, options).length === 0) return []
  const modeOption = agentModeOption(options)
  const collaboration = agent === 'codex' ? collaborationOption(options) : undefined
  return [modeOption?.id, collaboration?.id].filter((id): id is string => !!id)
}

/**
 * `_meta` key on a permission request in which an external agent asks to run an MCP tool:
 * `{ server, tool }`, so the daemon answers the harness's own auto-allowed tools itself.
 */
export const MCP_TOOL_APPROVAL_META = 'zomfy/mcpToolApproval'

export interface McpToolApproval {
  server: string
  tool: string
}
