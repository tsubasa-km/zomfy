import { describe, expect, test } from 'bun:test'
import { claudeTurn, interleavedTools } from './fixtures/session-updates'
import { applyUpdate, toolSummary, transcriptFrom, wrapUpCardOf, type TranscriptItem } from './transcript'

describe('transcript reducer', () => {
  test('a recorded Claude turn becomes merged messages, one tool item, the latest plan and a notice', () => {
    expect(transcriptFrom(claudeTurn)).toEqual([
      { kind: 'user', id: 'user:0', text: 'Run the tests\nand fix what fails', messageId: 'm1' },
      { kind: 'thought', id: 'thought:1', text: 'I should run bun test first.' },
      { kind: 'agent', id: 'agent:2', text: "I'll run the tests." },
      {
        kind: 'tool',
        id: 'tool:toolu_1',
        toolCallId: 'toolu_1',
        title: 'bun test',
        toolKind: 'execute',
        status: 'completed',
        toolName: 'Bash',
        input: { command: 'bun test', description: 'Run the tests' },
        output: '28 pass\n0 fail'
      },
      {
        kind: 'plan',
        id: 'plan:4',
        entries: [
          { content: 'Run the tests', status: 'completed', priority: 'medium' },
          { content: 'Fix failures', status: 'completed', priority: 'medium' }
        ]
      },
      { kind: 'agent', id: 'agent:5', text: 'All tests pass.' },
      { kind: 'notice', id: 'notice:6', title: 'Worked for 3s', severity: 'info' }
    ])
  })

  test('tool updates fold into their own call, even out of order or without a start', () => {
    const items = transcriptFrom(interleavedTools)
    const tools = items.filter((i): i is Extract<TranscriptItem, { kind: 'tool' }> => i.kind === 'tool')
    expect(tools.map((t) => [t.toolCallId, t.status, t.output])).toEqual([
      ['a', 'failed', 'File not found'],
      ['b', 'completed', ''],
      ['c', 'completed', '']
    ])
    expect(tools[2]!.title).toBe('Read c.ts')
    expect(items.filter((i) => i.kind === 'user').map((i) => (i as { text: string }).text)).toEqual(['Edit both files', 'Thanks'])
    expect(items.at(-1)).toEqual({
      kind: 'notice',
      id: 'notice:5',
      title: 'Usage limit reached',
      description: 'Resets at 5pm',
      severity: 'error'
    })
  })

  test('two prompts in a row stay two bubbles', () => {
    const items = transcriptFrom([
      { sessionUpdate: 'user_message_chunk', messageId: 'x', content: { type: 'text', text: 'one' } },
      { sessionUpdate: 'user_message_chunk', messageId: 'y', content: { type: 'text', text: 'two' } }
    ])
    expect(items.map((i) => i.kind)).toEqual(['user', 'user'])
  })

  test('updates it does not show leave the items as they were', () => {
    const items = transcriptFrom(claudeTurn)
    expect(applyUpdate(items, { sessionUpdate: 'usage_update', used: 1, size: 2 })).toBe(items)
    expect(applyUpdate(items, { sessionUpdate: 'current_mode_update', currentModeId: 'plan' })).toBe(items)
    expect(applyUpdate(items, { sessionUpdate: 'agent_message_chunk', content: { type: 'image', data: '', mimeType: 'image/png' } })).toBe(items)
  })

  test('a collapsed tool line shows its command', () => {
    const [tool] = transcriptFrom([
      { sessionUpdate: 'tool_call', toolCallId: 't', title: 'Terminal', kind: 'execute', rawInput: { command: 'ls -la\necho hi' } }
    ])
    expect(toolSummary(tool as Extract<TranscriptItem, { kind: 'tool' }>)).toBe('Terminal: ls -la')
  })
})

describe('wrapUpCardOf', () => {
  const tool = (patch: Partial<Extract<TranscriptItem, { kind: 'tool' }>>): Extract<TranscriptItem, { kind: 'tool' }> => ({
    kind: 'tool',
    id: 'tool:w',
    toolCallId: 'w',
    title: 'wrap_up',
    toolKind: 'other',
    status: 'completed',
    toolName: 'mcp__harness__wrap_up',
    input: { personActions: ['Update the app'], agentSteps: ['Run the preview'] },
    output: '',
    ...patch
  })

  test("a wrap_up call reads as its card, the person's actions first", () => {
    expect(wrapUpCardOf(tool({}))?.steps).toEqual([
      { owner: 'person', text: 'Update the app' },
      { owner: 'agent', text: 'Run the preview' }
    ])
  })

  test('other tools and a failed wrap_up stay tool lines', () => {
    expect(wrapUpCardOf(tool({ toolName: 'Bash', title: 'Bash' }))).toBeNull()
    expect(wrapUpCardOf(tool({ status: 'failed' }))).toBeNull()
  })
})
