import { expect, test } from 'bun:test'
import { explainClaudeFailure } from './claude-executable.ts'

test('sign-in and install failures read as what to do', () => {
  expect(explainClaudeFailure('Invalid API key · Please run /login')).toContain('not signed in')
  expect(explainClaudeFailure('spawn claude ENOENT')).toContain('not found')
  expect(explainClaudeFailure('Used 14012 tokens and failed')).toBeNull()
})
