// `session/update` streams in the shape the Zomfy daemon sends them for a Claude chat: a prompt in
// two blocks, a thought, a streamed answer, a Bash call with its updates, a TodoWrite plan sent
// twice, and the turn's closing notice.

import type { SessionUpdate } from '../transcript'

export const claudeTurn: SessionUpdate[] = [
  { sessionUpdate: 'user_message_chunk', messageId: 'm1', content: { type: 'text', text: 'Run the tests' } },
  { sessionUpdate: 'user_message_chunk', messageId: 'm1', content: { type: 'text', text: 'and fix what fails' } },
  { sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: 'I should run ' } },
  { sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: 'bun test first.' } },
  { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: "I'll run " } },
  { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'the tests.' } },
  {
    sessionUpdate: 'tool_call',
    toolCallId: 'toolu_1',
    title: 'bun test',
    kind: 'execute',
    status: 'pending',
    rawInput: { command: 'bun test', description: 'Run the tests' },
    _meta: { 'harness/toolName': 'Bash' }
  },
  { sessionUpdate: 'tool_call_update', toolCallId: 'toolu_1', status: 'in_progress' },
  {
    sessionUpdate: 'tool_call_update',
    toolCallId: 'toolu_1',
    status: 'completed',
    content: [{ type: 'content', content: { type: 'text', text: '28 pass\n0 fail' } }]
  },
  {
    sessionUpdate: 'plan',
    entries: [
      { content: 'Run the tests', status: 'completed', priority: 'medium' },
      { content: 'Fix failures', status: 'in_progress', priority: 'medium' }
    ]
  },
  {
    sessionUpdate: 'plan',
    entries: [
      { content: 'Run the tests', status: 'completed', priority: 'medium' },
      { content: 'Fix failures', status: 'completed', priority: 'medium' }
    ]
  },
  { sessionUpdate: 'usage_update', used: 1200, size: 200000 },
  { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'All tests pass.' } },
  { sessionUpdate: 'notice', severity: 'info', title: 'Worked for 3s' }
]

/** A second prompt whose first tool call is updated after another call started (out of order). */
export const interleavedTools: SessionUpdate[] = [
  { sessionUpdate: 'user_message_chunk', messageId: 'm2', content: { type: 'text', text: 'Edit both files' } },
  { sessionUpdate: 'tool_call', toolCallId: 'a', title: 'Edit a.ts', kind: 'edit', status: 'in_progress', rawInput: { file_path: 'a.ts' } },
  { sessionUpdate: 'tool_call', toolCallId: 'b', title: 'Edit b.ts', kind: 'edit', status: 'in_progress', rawInput: { file_path: 'b.ts' } },
  { sessionUpdate: 'tool_call_update', toolCallId: 'a', status: 'failed', content: [{ type: 'content', content: { type: 'text', text: 'File not found' } }] },
  { sessionUpdate: 'tool_call_update', toolCallId: 'b', status: 'completed' },
  // An update for a call the phone never saw start (it joined late) still makes an item.
  { sessionUpdate: 'tool_call_update', toolCallId: 'c', status: 'completed', title: 'Read c.ts' },
  { sessionUpdate: 'user_message_chunk', messageId: 'm3', content: { type: 'text', text: 'Thanks' } },
  { sessionUpdate: 'notice', severity: 'error', title: 'Usage limit reached', description: 'Resets at 5pm' }
]
