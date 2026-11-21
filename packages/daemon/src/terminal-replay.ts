/**
 * A terminal's most recent output, up to `limit` characters, for a window that attaches later.
 * Output is appended in pieces and joined only when read or when twice the limit has piled up, so
 * a busy terminal does not copy its whole scrollback on every flush.
 */
export class ReplayBuffer {
  private chunks: string[] = []
  private length = 0

  constructor(private readonly limit: number) {}

  append(data: string): void {
    if (!data) return
    this.chunks.push(data)
    this.length += data.length
    if (this.length > this.limit * 2) this.compact()
  }

  /** The last `limit` characters. */
  text(): string {
    this.compact()
    return this.chunks[0] ?? ''
  }

  private compact(): void {
    if (this.chunks.length <= 1 && this.length <= this.limit) return
    const kept = this.chunks.join('').slice(-this.limit)
    this.chunks = kept ? [kept] : []
    this.length = kept.length
  }
}
