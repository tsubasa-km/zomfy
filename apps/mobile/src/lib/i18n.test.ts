import { describe, expect, test } from 'bun:test'
import { createTranslator, japaneseKeys, languageFor } from './i18n'

describe('i18n', () => {
  test('picks Japanese for ja locales and English otherwise', () => {
    expect(languageFor('ja-JP')).toBe('ja')
    expect(languageFor('en-US')).toBe('en')
    expect(languageFor(null)).toBe('en')
  })

  test('translates and fills placeholders', () => {
    const ja = createTranslator('ja')
    const en = createTranslator('en')
    expect(ja('Send')).toBe('送信')
    expect(en('Retrying in {seconds}s', { seconds: 4 })).toBe('Retrying in 4s')
    expect(ja('Retrying in {seconds}s', { seconds: 4 })).toBe('4 秒後に再試行')
    expect(ja('Some new string')).toBe('Some new string')
  })

  test('every Japanese entry keeps the placeholders of its key', () => {
    const ja = createTranslator('ja')
    for (const key of japaneseKeys()) {
      const names = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort()
      expect(names(ja(key))).toEqual(names(key))
    }
  })
})
