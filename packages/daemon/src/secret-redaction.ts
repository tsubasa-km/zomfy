// Saved secrets' values replaced by `[secret NAME]` in what Zomfy records, shows and logs, and in
// what comes back through the tunnel (docs/specs/agent-secrets.md). A safety net: it recognises a
// value as written, not an encoded form of it.

/** Shorter values would redact ordinary words. */
export const MIN_REDACTED_LENGTH = 6

export interface RedactedSecret {
  name: string
  value: string
}

const encoder = new TextEncoder()

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

  /** Redacts a byte stream, holding back just enough to catch a value split across chunks. */
  stream(): TransformStream<Uint8Array, Uint8Array> {
    const needles = this.secrets.map((s) => ({ bytes: encoder.encode(s.value), replacement: encoder.encode(label(s.name)) }))
    const hold = Math.max(0, ...needles.map((n) => n.bytes.length - 1))
    let carry = new Uint8Array(0)
    const run = (input: Uint8Array, final: boolean, controller: TransformStreamDefaultController<Uint8Array>) => {
      const buffer = concat(carry, input)
      const safeEnd = final ? buffer.length : buffer.length - hold
      const out: Uint8Array[] = []
      let from = 0
      let i = 0
      while (i < safeEnd) {
        const hit = needles.find((n) => startsWith(buffer, i, n.bytes))
        if (hit) {
          if (i > from) out.push(buffer.subarray(from, i))
          out.push(hit.replacement)
          i += hit.bytes.length
          from = i
        } else i++
      }
      const end = Math.max(from, Math.min(i, buffer.length))
      if (end > from) out.push(buffer.subarray(from, end))
      carry = buffer.slice(end)
      const chunk = concat(...out)
      if (chunk.length) controller.enqueue(chunk)
    }
    return new TransformStream({
      transform: (chunk, controller) => run(chunk, false, controller),
      flush: (controller) => run(new Uint8Array(0), true, controller)
    })
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

function startsWith(buffer: Uint8Array, at: number, needle: Uint8Array): boolean {
  if (at + needle.length > buffer.length) return false
  for (let j = 0; j < needle.length; j++) if (buffer[at + j] !== needle[j]) return false
  return true
}

function concat(...parts: Uint8Array[]): Uint8Array {
  if (parts.length === 1) return parts[0]!
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let at = 0
  for (const p of parts) {
    out.set(p, at)
    at += p.length
  }
  return out
}

/** The daemon's one redactor, kept current by the secret service. */
export const secretRedactor = new SecretRedactor()
