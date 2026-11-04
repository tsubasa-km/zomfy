import { describe, expect, test } from 'bun:test'
import { mergeOrder, reorderIds } from '../src/components/sidebar/workspace-visibility.ts'

describe('project order across hosts', () => {
  test('with nothing saved, the hosts own order stands', () => {
    expect(mergeOrder(['local:a', 'local:b', 'wsl:c'], [])).toEqual(['local:a', 'local:b', 'wsl:c'])
  })

  test('a saved order puts a WSL project above Windows ones', () => {
    const keys = ['local:a', 'local:b', 'wsl:c']
    const saved = reorderIds(keys, 'wsl:c', 'local:a', 'before')!
    expect(mergeOrder(keys, saved)).toEqual(['wsl:c', 'local:a', 'local:b'])
  })

  test('a project not saved yet lands after the one its host lists before it', () => {
    expect(mergeOrder(['local:a', 'local:new', 'local:b', 'wsl:c'], ['wsl:c', 'local:a', 'local:b'])).toEqual([
      'wsl:c',
      'local:a',
      'local:new',
      'local:b'
    ])
    expect(mergeOrder(['local:new', 'local:a', 'wsl:c'], ['wsl:c', 'local:a'])).toEqual(['local:new', 'wsl:c', 'local:a'])
  })

  test('removed projects drop out', () => {
    expect(mergeOrder(['local:a'], ['wsl:gone', 'local:a'])).toEqual(['local:a'])
  })
})
