import { describe, expect, test } from 'bun:test'
import { compareVersions } from './chat-agent-updates.ts'

describe('compareVersions', () => {
  test('orders releases numerically and prereleases first', () => {
    expect(compareVersions('0.164.0', '0.165.0')).toBeLessThan(0)
    expect(compareVersions('2.10.0', '2.9.1')).toBeGreaterThan(0)
    expect(compareVersions('1.0.0-beta.1', '1.0.0')).toBeLessThan(0)
    expect(compareVersions('1.2.3', '1.2.3')).toBe(0)
  })
})
