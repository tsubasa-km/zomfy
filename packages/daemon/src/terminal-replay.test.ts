import { describe, expect, test } from 'bun:test'
import { ReplayBuffer } from './terminal-replay.ts'
import { OscScanner } from './terminal-osc.ts'

describe('ReplayBuffer', () => {
  test('keeps the last `limit` characters however the output arrived', () => {
    const buffer = new ReplayBuffer(10)
    let all = ''
    for (let i = 0; i < 50; i++) {
      const piece = `${i},`
      buffer.append(piece)
      all += piece
      expect(buffer.text()).toBe(all.slice(-10))
    }
  })

  test('is empty until something is written, and ignores empty writes', () => {
    const buffer = new ReplayBuffer(10)
    expect(buffer.text()).toBe('')
    buffer.append('')
    buffer.append('abc')
    expect(buffer.text()).toBe('abc')
  })
})

describe('OscScanner', () => {
  test('finds a title split across reads after plain output', () => {
    const scanner = new OscScanner()
    expect(scanner.scan('plain output\r\n')).toEqual({})
    expect(scanner.scan('more \x1b]0;my ti')).toEqual({})
    expect(scanner.scan('tle\x07 after')).toEqual({ title: 'my title' })
  })
})
