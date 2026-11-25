import { describe, expect, test } from 'bun:test'
import {
  buildTranscript,
  createTranscriptBuilder,
  FENCED_THOUGHT_CHARS,
  LONG_THOUGHT_CHARS,
  SHORT_REPLY_CHARS,
  thinkingStartsOpen,
  thoughtHoldsAnswer,
  type TranscriptRowModel
} from '../src/components/native-chat/native-chat-transcript-model.ts'
import type { ThreadItem } from '../src/session-store.ts'

const CWD = '/repo'
const LONG = 'x'.repeat(LONG_THOUGHT_CHARS)
const FENCED = `Here is the fix:\n\n\`\`\`ts\nconst a = 1\n\`\`\`\n${'y'.repeat(FENCED_THOUGHT_CHARS)}`

function bash(id: string): ThreadItem {
  return { kind: 'tool', id, title: 'Bash', toolKind: 'execute', status: 'completed', input: { command: 'ls' }, output: '', toolName: 'Bash' }
}

function thoughts(rows: TranscriptRowModel[]) {
  return rows.flatMap((row) => (row.kind === 'thought' ? [row.prominent === true] : []))
}

function turnOf(...items: ThreadItem[]): ThreadItem[] {
  return [{ kind: 'user', text: 'question', messageId: 'm1' }, ...items]
}

describe('thoughtHoldsAnswer', () => {
  test('long thinking before a short or empty reply', () => {
    expect(thoughtHoldsAnswer(LONG, 'Done.')).toBe(true)
    expect(thoughtHoldsAnswer(LONG, '')).toBe(true)
    expect(thoughtHoldsAnswer(LONG, 'r'.repeat(SHORT_REPLY_CHARS - 1))).toBe(true)
  })

  test('not when the reply is long enough to be the answer', () => {
    expect(thoughtHoldsAnswer(LONG, 'r'.repeat(SHORT_REPLY_CHARS))).toBe(false)
  })

  test('short thinking stays closed unless it carries a code block', () => {
    expect(thoughtHoldsAnswer('x'.repeat(LONG_THOUGHT_CHARS - 1), '')).toBe(false)
    expect(thoughtHoldsAnswer(FENCED, '')).toBe(true)
    expect(thoughtHoldsAnswer('```\na\n```', '')).toBe(false)
  })

  test('whitespace does not count', () => {
    expect(thoughtHoldsAnswer(`  ${'x'.repeat(LONG_THOUGHT_CHARS - 1)}\n\n\n`, '')).toBe(false)
    expect(thoughtHoldsAnswer(LONG, `  ok ${' '.repeat(SHORT_REPLY_CHARS)}`)).toBe(true)
  })
})

describe('prominent thinking in the transcript', () => {
  test("a finished turn's last thinking before a short reply", () => {
    const items = turnOf({ kind: 'thought', text: 'plan' }, bash('b1'), { kind: 'thought', text: LONG }, { kind: 'agent', text: 'See above.' })
    expect(thoughts(buildTranscript(items, false, CWD).rows)).toEqual([false, true])
  })

  test('thinking with no reply at all', () => {
    expect(thoughts(buildTranscript(turnOf({ kind: 'thought', text: FENCED }), false, CWD).rows)).toEqual([true])
  })

  test('not while the turn runs', () => {
    const items = turnOf({ kind: 'thought', text: LONG }, { kind: 'agent', text: 'See above.' })
    expect(thoughts(buildTranscript(items, true, CWD).rows)).toEqual([false])
  })

  test('not thinking that a tool call follows', () => {
    const items = turnOf({ kind: 'thought', text: LONG }, bash('b1'), { kind: 'agent', text: 'Done.' })
    expect(thoughts(buildTranscript(items, false, CWD).rows)).toEqual([false])
  })

  test('not before a long reply, counting a recap read as the Next steps card', () => {
    const long = turnOf({ kind: 'thought', text: LONG }, { kind: 'agent', text: 'r'.repeat(SHORT_REPLY_CHARS) })
    expect(thoughts(buildTranscript(long, false, CWD).rows)).toEqual([false])
    const recap = `### Done\n- ${'changed things '.repeat(20)}\n\n### Next steps\n1. Review the change`
    const card = turnOf({ kind: 'thought', text: LONG }, { kind: 'agent', text: recap })
    const rows = buildTranscript(card, false, CWD).rows
    expect(rows.some((row) => row.kind === 'next-steps')).toBe(true)
    expect(thoughts(rows)).toEqual([false])
  })

  test('only the latest thinking of the turn', () => {
    const items = turnOf({ kind: 'thought', text: LONG }, { kind: 'agent', text: 'a' }, { kind: 'thought', text: 'short' }, { kind: 'agent', text: 'b' })
    expect(thoughts(buildTranscript(items, false, CWD).rows)).toEqual([false, false])
  })

  test('each finished turn decides on its own, and the incremental builder agrees', () => {
    const items = [
      ...turnOf({ kind: 'thought', text: LONG }, { kind: 'agent', text: 'ok' }),
      { kind: 'user', text: 'again', messageId: 'm2' } as ThreadItem,
      { kind: 'thought', text: LONG } as ThreadItem,
      { kind: 'agent', text: 'r'.repeat(SHORT_REPLY_CHARS) } as ThreadItem
    ]
    const build = createTranscriptBuilder()
    const running = build(items, true, CWD)
    expect(thoughts(running.rows)).toEqual([true, false])
    expect(running).toEqual(buildTranscript(items, true, CWD))
    expect(build(items, false, CWD)).toEqual(buildTranscript(items, false, CWD))
  })
})

describe('thinkingStartsOpen', () => {
  test('follows the setting', () => {
    expect(thinkingStartsOpen('collapsed', true)).toBe(false)
    expect(thinkingStartsOpen('short-reply', true)).toBe(true)
    expect(thinkingStartsOpen('short-reply', false)).toBe(false)
    expect(thinkingStartsOpen('expanded', false)).toBe(true)
  })
})
