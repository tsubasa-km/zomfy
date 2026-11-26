import { expect, test } from 'bun:test'
import { sameFormValue } from '../src/lib/use-save-state.ts'

test('a form that holds what was saved has nothing to save', () => {
  const saved = { name: 'zomfy', agentWorkflows: true, account: { provider: 'github', login: 'me' }, tools: ['Read', 'Bash'] }
  expect(sameFormValue(saved, { ...saved, account: { login: 'me', provider: 'github' }, tools: ['Read', 'Bash'] })).toBe(true)
})

test('any field that differs is a change, however deep', () => {
  const saved = { name: 'zomfy', switches: { a: true }, tools: ['Read'] }
  expect(sameFormValue(saved, { ...saved, name: 'zomfy ' })).toBe(false)
  expect(sameFormValue(saved, { ...saved, switches: { a: false } })).toBe(false)
  expect(sameFormValue(saved, { ...saved, tools: ['Read', 'Bash'] })).toBe(false)
  expect(sameFormValue(saved, { ...saved, tools: ['Bash'] })).toBe(false)
})

test('an undefined field is the same as a missing one, but not as null or empty', () => {
  expect(sameFormValue({ model: undefined, name: 'a' }, { name: 'a' })).toBe(true)
  expect(sameFormValue({ model: null }, {})).toBe(false)
  expect(sameFormValue({ model: '' }, { model: null })).toBe(false)
})

test('typed text against nothing saved', () => {
  expect(sameFormValue('', '')).toBe(true)
  expect(sameFormValue('', 'secret')).toBe(false)
})
