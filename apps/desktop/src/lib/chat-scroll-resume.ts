/**
 * Whether a chat shown again starts at its latest message: always the first time, and whenever it
 * was left at the bottom or has had something new since; otherwise it goes back where it was read.
 */
export function resumesAtLatest(kept: { stick: boolean; items: number } | undefined, items: number): boolean {
  return !kept || kept.stick || kept.items !== items
}
