import { describe, expect, test } from 'bun:test'
import { splitTaskNotifications } from '../src/components/native-chat/native-chat-task-notification.ts'
import { buildTranscript } from '../src/components/native-chat/native-chat-transcript-model.ts'

const notification = (status: string, summary: string) =>
  `<task-notification>\n<task-id>b1</task-id>\n<output-file>C:\\tmp\\b1.output</output-file>\n<status>${status}</status>\n<summary>${summary}</summary>\n</task-notification>`

describe('splitTaskNotifications', () => {
  test('reads status and summary of each block', () => {
    const { notifications, rest } = splitTaskNotifications(`${notification('failed', 'Run A failed')}\n${notification('completed', 'Run B done')}`)
    expect(notifications).toEqual([
      { status: 'failed', summary: 'Run A failed' },
      { status: 'completed', summary: 'Run B done' }
    ])
    expect(rest).toBe('')
  })

  test("keeps the person's words around a notification", () => {
    expect(splitTaskNotifications(`${notification('completed', 'Done')}\n\nnext, check the CSV`).rest).toBe('next, check the CSV')
  })

  test('leaves ordinary messages alone', () => {
    expect(splitTaskNotifications('  hello <b>there</b>  ')).toEqual({ notifications: [], rest: '  hello <b>there</b>  ' })
  })
})

describe('buildTranscript', () => {
  test('a notification-only message becomes a status line, not an empty bubble', () => {
    const { rows } = buildTranscript(
      [
        { kind: 'user', text: 'run it' },
        { kind: 'user', text: notification('completed', 'Background command "x" completed') }
      ],
      false,
      '/repo'
    )
    expect(rows.map((r) => r.kind)).toEqual(['user', 'background'])
  })
})
