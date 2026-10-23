import { describe, expect, test } from 'bun:test'
import { verdictInText } from './workflow-engine.ts'

// Agents without structured output close their reply with the verdict as JSON.

describe('verdictInText', () => {
  test('a bare object at the end', () => {
    expect(verdictInText('Done. Tests pass.\n{"outcome": "next", "summary": "Added shout()"}')).toEqual({ outcome: 'next', summary: 'Added shout()' })
  })

  test('a fenced block, and braces inside the summary', () => {
    const text = 'I changed `f() {}`.\n```json\n{"outcome": "changes", "summary": "fix {x}", "followUps": ["rename"]}\n```\n'
    expect(verdictInText(text)).toEqual({ outcome: 'changes', summary: 'fix {x}', followUps: ['rename'] })
  })

  test('the last one wins; none gives null', () => {
    expect(verdictInText('{"outcome": "changes", "summary": "a"}\nthen\n{"outcome": "approve", "summary": "b"}')).toEqual({ outcome: 'approve', summary: 'b' })
    expect(verdictInText('no verdict {here}')).toBeNull()
  })
})
