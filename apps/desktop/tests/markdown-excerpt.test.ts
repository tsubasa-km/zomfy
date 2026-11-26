import { describe, expect, test } from 'bun:test'
import { markdownExcerpt } from '../src/lib/markdown-excerpt'

describe('markdownExcerpt', () => {
  test('drops emphasis and inline code marks', () => {
    expect(markdownExcerpt('Each item is rounded **before** the sum, in `total()`.')).toBe('Each item is rounded before the sum, in total().')
  })

  test('keeps link text and list items on one line', () => {
    expect(markdownExcerpt('# Done\n\n- see [the docs](https://x.dev)\n- 2 tests')).toBe('Done see the docs 2 tests')
  })

  test('keeps the words of tables and code blocks, not their marks', () => {
    expect(markdownExcerpt('| A | B |\n|---|---|\n| 1 | 2 |\n\n```ts\nreturn sum\n```')).toBe('A B 1 2 return sum')
  })

  test('leaves snake_case and lone asterisks alone', () => {
    expect(markdownExcerpt('rename max_count * 2')).toBe('rename max_count * 2')
  })
})
