// Orca's components call translate(key, englishFallback); this app ships English only for now.
export function translate(_key: string, fallback: string, options?: Record<string, unknown>): string {
  if (!options) return fallback
  return fallback.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, name: string) =>
    name in options ? String(options[name]) : match
  )
}

/** Minimal i18next surface for ported Orca code that caches per-locale label tables. */
export const i18n = {
  language: 'en',
  getResourceBundle: (_language: string, _namespace: string): Record<string, unknown> | undefined => undefined
}
