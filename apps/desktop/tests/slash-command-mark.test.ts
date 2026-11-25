import { describe, expect, test } from 'bun:test'
import { slashCommandEnd } from '@/components/markdown-editor/slash-command-mark'

const names = new Set(['review', 'compact'])

describe('slashCommandEnd', () => {
  test('a known command at the start, alone or with arguments', () => {
    expect(slashCommandEnd('/review', names)).toBe(7)
    expect(slashCommandEnd('/review 12', names)).toBe(7)
  })
  test('an unknown, unfinished or later command is not marked', () => {
    expect(slashCommandEnd('/revie', names)).toBeNull()
    expect(slashCommandEnd('/reviewer', names)).toBeNull()
    expect(slashCommandEnd('please /review', names)).toBeNull()
    expect(slashCommandEnd('/', names)).toBeNull()
  })
})
