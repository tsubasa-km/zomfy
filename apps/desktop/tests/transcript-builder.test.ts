import { describe, expect, test } from 'bun:test'
import { buildTranscript, createTranscriptBuilder } from '../src/components/native-chat/native-chat-transcript-model.ts'
import type { ThreadItem } from '../src/session-store.ts'

const CWD = '/repo'

function tool(id: string, extra: Partial<Extract<ThreadItem, { kind: 'tool' }>> = {}): ThreadItem {
  return { kind: 'tool', id, title: `Edit ${id}`, toolKind: 'edit', status: 'completed', input: { file_path: `/repo/${id}.ts`, old_string: 'a', new_string: 'b' }, output: '', toolName: 'Edit', ...extra }
}

function turn(n: number): ThreadItem[] {
  return [
    { kind: 'user', text: `prompt ${n}`, messageId: `m${n}` },
    { kind: 'thought', text: `thinking ${n}` },
    tool(`e${n}`),
    tool(`b${n}`, { toolName: 'Bash', title: 'Bash', input: { command: 'ls' } }),
    { kind: 'agent', text: `answer ${n}` }
  ]
}

/** Feeds each state to one incremental builder and checks it against a full build. */
function expectSameAsFullBuild(states: { items: ThreadItem[]; running: boolean }[]) {
  const build = createTranscriptBuilder()
  for (const { items, running } of states) expect(build(items, running, CWD)).toEqual(buildTranscript(items, running, CWD))
}

describe('createTranscriptBuilder', () => {
  test('matches a full build while a turn streams and after it ends', () => {
    const history = [...turn(1), ...turn(2), { kind: 'user', text: 'prompt 3' } as ThreadItem]
    const states: { items: ThreadItem[]; running: boolean }[] = []
    let items = history
    for (const chunk of ['Hel', 'lo ', 'there']) {
      const last = items.at(-1)!
      items = last.kind === 'agent' ? [...items.slice(0, -1), { kind: 'agent', text: last.text + chunk }] : [...items, { kind: 'agent', text: chunk }]
      states.push({ items, running: true })
    }
    items = [...items, tool('e3'), { kind: 'permission', requestId: 'r', title: 'Allow?', options: [], chosen: 'allow' }]
    states.push({ items, running: true })
    states.push({ items, running: false })
    expectSameAsFullBuild(states)
  })

  test('keeps the rows before the latest prompt as the same objects', () => {
    const build = createTranscriptBuilder()
    const items = [...turn(1), ...turn(2), { kind: 'user', text: 'prompt 3' } as ThreadItem]
    const first = build(items, true, CWD)
    const second = build([...items, { kind: 'agent', text: 'streaming' }], true, CWD)
    const settled = first.rows.length
    for (let i = 0; i < settled; i++) expect(second.rows[i]).toBe(first.rows[i]!)
  })

  test('regroups when an earlier item changes, the transcript shrinks or the folder changes', () => {
    const items = [...turn(1), ...turn(2), ...turn(3)]
    const changed = items.map((item) => (item.kind === 'tool' && item.id === 'e1' ? { ...item, status: 'failed' } : item))
    expectSameAsFullBuild([
      { items, running: false },
      { items: changed, running: false },
      { items: changed.slice(0, 7), running: false },
      { items: changed.slice(0, 7), running: true }
    ])
    const build = createTranscriptBuilder()
    build(items, false, CWD)
    expect(build(items, false, '/other')).toEqual(buildTranscript(items, false, '/other'))
  })

  test("places a subagent call under its Task when it comes after the Task's turn", () => {
    const task = tool('task', { toolName: 'Task', title: 'Task', input: {} })
    const before = [...turn(1), task, { kind: 'user', text: 'next' } as ThreadItem]
    const after = [...before, tool('child', { parentId: 'task' })]
    expectSameAsFullBuild([
      { items: before, running: true },
      { items: after, running: true },
      { items: [...after, { kind: 'agent', text: 'done' }], running: true }
    ])
  })

  test('carries task lists across prompts', () => {
    const create = (id: string) => tool(id, { toolName: 'TaskCreate', title: 'TaskCreate', input: { subject: `do ${id}` }, output: `Task #${id} created` })
    const update = tool('u1', { toolName: 'TaskUpdate', title: 'TaskUpdate', input: { taskId: '1', status: 'completed' } })
    const items = [...turn(1), create('1'), create('2'), { kind: 'user', text: 'go on' } as ThreadItem]
    expectSameAsFullBuild([
      { items, running: true },
      { items: [...items, update], running: true },
      { items: [...items, update, { kind: 'user', text: 'again' }, create('3')], running: false }
    ])
  })
})
