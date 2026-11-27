import { expect, test } from 'bun:test'
import {
  agentPermissionModes,
  agentPermissionSettings,
  permissionModeOfAgent,
  permissionOptionIds,
  type ChatAgentOption
} from '@zomfy/protocol'

// The mapping of Zomfy's permission modes onto other agents (codex-and-acp-parity.md).

const option = (id: string, category: string, values: string[], currentValue = values[0]!): ChatAgentOption => ({
  id, name: id, category, currentValue, choices: values.map((value) => ({ value, name: value, description: null }))
})
const codex = [
  option('mode', 'mode', ['read-only', 'workspace-write', 'agent', 'agent-full-access'], 'agent'),
  option('collaboration_mode', 'collaboration_mode', ['default', 'plan'], 'default'),
  option('model', 'model', ['gpt'])
]

test('each Zomfy mode is a codex-acp mode and collaboration mode', () => {
  expect(agentPermissionSettings('codex', 'default', codex)).toEqual([{ optionId: 'mode', value: 'read-only' }, { optionId: 'collaboration_mode', value: 'default' }])
  expect(agentPermissionSettings('codex', 'acceptEdits', codex)?.[0]?.value).toBe('workspace-write')
  expect(agentPermissionSettings('codex', 'plan', codex)).toEqual([{ optionId: 'mode', value: 'read-only' }, { optionId: 'collaboration_mode', value: 'plan' }])
  expect(agentPermissionSettings('codex', 'auto', codex)?.[0]?.value).toBe('agent')
  expect(agentPermissionSettings('codex', 'bypassPermissions', codex)?.[0]?.value).toBe('agent-full-access')
  expect(agentPermissionModes('codex', codex)).toEqual(['default', 'acceptEdits', 'plan', 'auto', 'bypassPermissions'])
  expect(permissionOptionIds('codex', codex)).toEqual(['mode', 'collaboration_mode'])
})

test('Codex offers every mode before its session reports options; plan needs the collaboration mode', () => {
  expect(agentPermissionModes('codex', [])).toHaveLength(5)
  expect(agentPermissionModes('codex', codex.filter((o) => o.id !== 'collaboration_mode'))).not.toContain('plan')
})

test('another ACP agent offers the modes its session modes match, or none', () => {
  const gemini = [option('harness/mode', 'mode', ['default', 'autoEdit', 'yolo'])]
  expect(agentPermissionModes('gemini', gemini)).toEqual(['default', 'acceptEdits', 'auto', 'bypassPermissions'])
  expect(agentPermissionSettings('gemini', 'bypassPermissions', gemini)).toEqual([{ optionId: 'harness/mode', value: 'yolo' }])
  expect(agentPermissionSettings('gemini', 'plan', gemini)).toBeNull()
  expect(agentPermissionModes('goose', [option('model', 'model', ['x'])])).toEqual([])
  expect(permissionOptionIds('goose', [])).toEqual([])
})

test('the agent’s own mode change reads back as a Zomfy mode', () => {
  const now = (mode: string, collaboration: string) => [
    { ...codex[0]!, currentValue: mode },
    { ...codex[1]!, currentValue: collaboration }
  ]
  expect(permissionModeOfAgent('codex', now('read-only', 'default'), 'plan')).toBe('default')
  expect(permissionModeOfAgent('codex', now('read-only', 'plan'), 'plan')).toBe('plan')
  expect(permissionModeOfAgent('codex', now('agent', 'plan'), 'auto')).toBeNull()
})
