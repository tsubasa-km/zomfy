// Saved secrets' values replaced by `[secret NAME]` in what Zomfy records, shows and logs
// (docs/specs/agent-secrets.md). A safety net: it recognises a value as written, not an encoded
// form of it.

/** Shorter values would redact ordinary words. */
export const MIN_REDACTED_LENGTH = 6

export interface RedactedSecret {
  name: string
  value: string
}

export class SecretRedactor {
  private secrets: RedactedSecret[] = []

  /** The values to look for, longest first so one value inside another is not cut short. */
  set(secrets: RedactedSecret[]): void {
    this.secrets = secrets.filter((s) => s.value.length >= MIN_REDACTED_LENGTH).sort((a, b) => b.value.length - a.value.length)
  }

  get active(): boolean {
    return this.secrets.length > 0
  }

  text(text: string): string {
    if (!this.secrets.length || !text) return text
    let out = text
    for (const s of this.secrets) if (out.includes(s.value)) out = out.split(s.value).join(label(s.name))
    return out
  }

  /** Strings anywhere in a JSON-like value; the same object back when nothing matched. */
  deep<T>(value: T): T {
    if (!this.secrets.length) return value
    return walk(value, (s) => this.text(s)) as T
  }
}

const label = (name: string) => `[secret ${name}]`

function walk(value: unknown, text: (s: string) => string): unknown {
  if (typeof value === 'string') return text(value)
  if (Array.isArray(value)) {
    let changed = false
    const next = value.map((item) => {
      const out = walk(item, text)
      if (out !== item) changed = true
      return out
    })
    return changed ? next : value
  }
  if (value && typeof value === 'object') {
    let changed = false
    const next: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value)) {
      const out = walk(item, text)
      if (out !== item) changed = true
      next[key] = out
    }
    return changed ? next : value
  }
  return value
}

/** The daemon's one redactor, kept current by the secret service. */
export const secretRedactor = new SecretRedactor()
