import { describe, expect, test } from 'bun:test'
import { TURN_RECOVERY_META, type ChatModel, type SessionOptions } from '@zomfy/protocol'
import { sessionOptionLabels } from '../src/components/native-chat/session-option-labels.ts'
import { turnEndMeta } from '../src/turn-end-meta.ts'
import { DEFAULT_SETTINGS, migrateSettings, SETTINGS_REVISION } from '../src/stores/settings-store.ts'

// docs/specs/composer-effort.md, docs/specs/claude-sign-in.md, docs/specs/visible-thinking.md

const MODELS: ChatModel[] = [
  { value: 'default', displayName: 'Opus', description: '', efforts: ['low', 'medium', 'high', 'xhigh', 'max'] },
  { value: 'sonnet', displayName: 'Sonnet', description: '', efforts: ['low', 'medium', 'high'] },
  { value: 'haiku', displayName: 'Haiku', description: '', efforts: [] }
]
const options = (patch: Partial<SessionOptions> = {}): SessionOptions => ({ model: null, permissionMode: 'default', effort: null, ...patch })

describe('the composer names the effort', () => {
  test('a picked level', () => {
    expect(sessionOptionLabels(options({ effort: 'high' }), MODELS)).toMatchObject({ model: 'Opus', effort: 'High' })
  })

  test("the level Claude's default resolved to on the last turn", () => {
    const labels = sessionOptionLabels(options(), MODELS, { model: null, effort: 'xhigh' })
    expect(labels.effort).toBe('XHigh (default)')
    expect(labels.spoken).toContain("Claude's default")
  })

  test('Default while the resolved level is not known', () => {
    expect(sessionOptionLabels(options(), MODELS).effort).toBe('Default')
    expect(sessionOptionLabels(options(), MODELS, null).effort).toBe('Default')
  })

  test('a default seen with another model does not count', () => {
    expect(sessionOptionLabels(options({ model: 'sonnet' }), MODELS, { model: null, effort: 'xhigh' }).effort).toBe('Default')
    expect(sessionOptionLabels(options({ model: 'sonnet' }), MODELS, { model: 'sonnet', effort: 'medium' }).effort).toBe('Med (default)')
  })

  test('a model without effort levels names the model alone', () => {
    expect(sessionOptionLabels(options({ model: 'haiku' }), MODELS, { model: 'haiku', effort: 'high' })).toMatchObject({ model: 'Haiku', effort: null })
  })

  test('a picked level shows before the model list arrives', () => {
    expect(sessionOptionLabels(options({ effort: 'low' }), []).effort).toBe('Low')
  })
})

describe('a turn end', () => {
  const meta = (value: unknown) => ({ [TURN_RECOVERY_META.turnEnd]: value })
  test('keeps the sign-in mark', () => {
    expect(turnEndMeta(meta({ reason: 'error', signIn: 'claude' }))).toEqual({ reason: 'error', signIn: 'claude' })
    expect(turnEndMeta(meta({ reason: 'error', signIn: 'someone' }))).toEqual({ reason: 'error' })
    expect(turnEndMeta(meta({ reason: 'error' }))).toEqual({ reason: 'error' })
    expect(turnEndMeta(meta({ reason: 'usage-limit', resetsAt: 5 }))).toEqual({ reason: 'usage-limit', resetsAt: 5 })
    expect(turnEndMeta({})).toBeNull()
  })
})

describe('thinking starts expanded', () => {
  test('by default', () => {
    expect(DEFAULT_SETTINGS.chatThinkingDisplay).toBe('expanded')
  })

  test('a window saved with the old default moves once; a later choice stays', () => {
    expect(migrateSettings({ chatThinkingDisplay: 'short-reply' })).toEqual({ chatThinkingDisplay: 'expanded', settingsRevision: SETTINGS_REVISION })
    expect(migrateSettings({ chatThinkingDisplay: 'collapsed' })).toEqual({ chatThinkingDisplay: 'collapsed', settingsRevision: SETTINGS_REVISION })
    const chosen = { chatThinkingDisplay: 'short-reply', settingsRevision: SETTINGS_REVISION }
    expect(migrateSettings(chosen)).toBe(chosen)
  })
})
