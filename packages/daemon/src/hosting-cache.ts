/** Short-lived memo with in-flight coalescing: panels, cards and pollers asking at once cost one CLI call. */
export class TtlCache<V> {
  private readonly entries = new Map<string, { at: number; value: Promise<V> }>()

  constructor(
    private readonly ttlMs: number,
    private readonly maxEntries = 200
  ) {}

  get(key: string, load: () => Promise<V>, force = false): Promise<V> {
    const hit = this.entries.get(key)
    if (hit && !force && Date.now() - hit.at < this.ttlMs) return hit.value
    const value = load()
    this.entries.set(key, { at: Date.now(), value })
    // Failures are not remembered; the next ask retries.
    value.catch(() => {
      if (this.entries.get(key)?.value === value) this.entries.delete(key)
    })
    if (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value
      if (oldest !== undefined) this.entries.delete(oldest)
    }
    return value
  }

  /** Drops entries whose key starts with `prefix` (all when omitted). */
  invalidate(prefix = ''): void {
    for (const key of [...this.entries.keys()]) if (key.startsWith(prefix)) this.entries.delete(key)
  }
}
