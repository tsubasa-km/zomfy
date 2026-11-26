import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { waitingGlowAttribute } from '../src/components/native-chat/composer-waiting-glow.ts'
import { DEFAULT_SETTINGS, migrateSettings, type ChatWaitingGlow } from '../src/stores/settings-store.ts'

// docs/specs/composer-waiting-glow.md

describe('composer waiting glow', () => {
  test('a waiting composer shows the chosen pattern', () => {
    expect(waitingGlowAttribute(true, 'rainbow')).toBe('rainbow')
    expect(waitingGlowAttribute(true, 'pulse')).toBe('pulse')
    expect(waitingGlowAttribute(true, 'outline')).toBe('outline')
  })

  test('an idle composer, Off, or an unknown saved value carries no attribute', () => {
    expect(waitingGlowAttribute(false, 'rainbow')).toBeUndefined()
    expect(waitingGlowAttribute(true, 'off')).toBeUndefined()
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: a stale value from storage, on purpose.
    expect(waitingGlowAttribute(true, 'sparkles' as ChatWaitingGlow)).toBeUndefined()
  })

  test('Rainbow is the default, and a window saved before the setting reads it without a move', () => {
    expect(DEFAULT_SETTINGS.chatWaitingGlow).toBe('rainbow')
    expect(migrateSettings({ settingsRevision: 1, theme: 'dark' })).not.toHaveProperty('chatWaitingGlow')
  })

  test('every animation hangs on the waiting attribute and stops for reduced motion', () => {
    const css = readFileSync(new URL('../src/components/native-chat/composer-waiting-glow.css', import.meta.url), 'utf8')
    const rules = css.replace(/\/\*[\s\S]*?\*\//g, '').split('}')
    for (const rule of rules.filter((r) => /animation:\s*composer-glow/.test(r))) {
      expect(rule).toContain("[data-waiting-glow='")
    }
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\) \{\s*\[data-waiting-glow\] \{\s*animation: none;/)
  })
})
