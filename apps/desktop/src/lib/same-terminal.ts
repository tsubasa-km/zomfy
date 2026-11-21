import type { TerminalInfo } from '@acp-harness/protocol'

/** Whether a host's terminal info says what the stored one does (shallow; nested values compared as JSON). */
export function sameTerminal(stored: TerminalInfo & { hostId: string }, info: TerminalInfo): boolean {
  const keys = Object.keys(info) as (keyof TerminalInfo)[]
  if (Object.keys(stored).length !== keys.length + ('hostId' in info ? 0 : 1)) return false
  return keys.every((key) => {
    const a = stored[key]
    const b = info[key]
    return a === b || (typeof a === 'object' && typeof b === 'object' && a !== null && b !== null && JSON.stringify(a) === JSON.stringify(b))
  })
}
