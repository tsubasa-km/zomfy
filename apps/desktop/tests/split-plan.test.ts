import { describe, expect, test } from 'bun:test'
import { splitPartCount, splitPlanOf } from '../src/components/native-chat/split-plan'

const toolName = 'mcp__harness__split_work'
const input = {
  goal: 'Add greetings.',
  parts: [
    { title: 'Greeting', task: 'Write greet(name) and its unittest.', owns: ['py/greet.py', 'py/test_greet.py'] },
    { title: 'Farewell', task: 'Write farewell(name).', owns: ['js/farewell.mjs'] }
  ]
}

describe('splitPlanOf', () => {
  test('shows the goal and each part with what it does and its files', () => {
    const plan = splitPlanOf({ title: 'Harness: split work', toolName, input })
    expect(plan).toContain('Add greetings.')
    expect(plan).toContain('- **Greeting**: Write greet(name) and its unittest.')
    expect(plan).toContain('`py/greet.py`, `py/test_greet.py`')
    expect(splitPartCount({ title: 'x', toolName, input })).toBe(2)
  })

  test('is only for split_work requests', () => {
    expect(splitPlanOf({ title: 'Harness: send prompt', toolName: 'mcp__harness__send_prompt', input })).toBeNull()
    // Only the tool name counts: a title that happens to mention it does not.
    expect(splitPartCount({ title: 'Harness: split_work', input })).toBeNull()
    expect(splitPlanOf({ title: 'x', toolName, input: { plan: 'a plan' } })).toBeNull()
    expect(splitPlanOf({ title: 'x', toolName, input: { parts: [] } })).toBeNull()
    expect(splitPlanOf({ title: 'x', toolName, input: null })).toBeNull()
  })
})
