import { getSetting } from '@/stores/settings-store'
import { JA } from './ja/index'

// The UI is written in English; t() swaps in the chosen language's text, keyed by the English itself,
// so an untranslated string simply stays English. The language is read once per window load:
// changing it reloads the window, so text computed at import time follows too.

export type Language = 'en' | 'ja'
export type LanguageSetting = 'system' | Language

function resolve(setting: LanguageSetting): Language {
  if (setting !== 'system') return setting
  return typeof navigator !== 'undefined' && !!navigator.language?.toLowerCase().startsWith('ja') ? 'ja' : 'en'
}

export const LANGUAGE: Language = resolve(getSetting('language'))

const TABLES: Record<Language, Record<string, string> | null> = { en: null, ja: JA }
const table = TABLES[LANGUAGE]

if (typeof document !== 'undefined') document.documentElement.lang = LANGUAGE

function fill(text: string, values?: Record<string, unknown>): string {
  if (!values) return text
  return text.replace(/\{\{?\s*(\w+)\s*\}?\}/g, (match, name: string) => (name in values ? String(values[name]) : match))
}

/** `english` in the window's language; `{name}` placeholders are filled from `values`. */
export function t(english: string, values?: Record<string, unknown>): string {
  return fill(table?.[english] ?? english, values)
}

/** `english` where the same English means different things in different places: "english (context)" first. */
export function tc(english: string, context: string, values?: Record<string, unknown>): string {
  const special = table?.[`${english} (${context})`]
  return special ? fill(special, values) : t(english, values)
}

/** Orca's translate(key, englishFallback): the English is the key here too. */
export function translate(_key: string, fallback: string, options?: Record<string, unknown>): string {
  return t(fallback, options)
}

/** Minimal i18next surface for ported Orca code that caches per-locale label tables. */
export const i18n = {
  language: LANGUAGE,
  getResourceBundle: (_language: string, _namespace: string): Record<string, unknown> | undefined => undefined
}

/** Another window changing the language reloads this one, so all windows speak the same. */
export function followLanguageChanges(storageKey: string): void {
  window.addEventListener('storage', (event) => {
    if (event.key !== storageKey || !event.newValue) return
    try {
      const next = (JSON.parse(event.newValue) as { language?: LanguageSetting }).language
      if (next && resolve(next) !== LANGUAGE) location.reload()
    } catch {
      // A value another build wrote; nothing to follow.
    }
  })
}
