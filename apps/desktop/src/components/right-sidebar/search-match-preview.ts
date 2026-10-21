import type { SearchMatch } from '@acp-harness/protocol'

export interface SearchOptions {
  query: string
  regex: boolean
  caseSensitive: boolean
  wholeWord: boolean
}

/** The daemon's replace pattern (workspace-replace.ts searchPattern), for highlighting and previews. */
export function searchPattern(options: SearchOptions): RegExp | null {
  if (!options.query) return null
  const source = options.regex ? options.query : options.query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  try {
    return new RegExp(options.wholeWord ? `\\b(?:${source})\\b` : source, options.caseSensitive ? 'g' : 'gi')
  } catch {
    return null
  }
}

const BEFORE_MAX = 26

/**
 * Orca's MatchResultRow split: the text before the hit is left-truncated so the hit stays visible
 * in a narrow sidebar (VS Code's lcut).
 */
export function matchParts(match: SearchMatch, pattern: RegExp | null): { before: string; hit: string; after: string } {
  const text = match.text
  let start = match.column - 1
  let length = match.length
  if (length === undefined && pattern) {
    // git grep reports where the line's first hit starts but not how long it is.
    pattern.lastIndex = 0
    const found = [...text.matchAll(pattern)].find((m) => (m.index ?? 0) >= start) ?? text.matchAll(pattern).next().value
    if (found && found[0]) {
      start = found.index ?? 0
      length = found[0].length
    }
  }
  if (length === undefined || start < 0 || start + length > text.length) return { before: text.trimStart(), hit: '', after: '' }
  const rawBefore = text.slice(0, start).trimStart()
  return {
    before: rawBefore.length > BEFORE_MAX ? `…${rawBefore.slice(rawBefore.length - BEFORE_MAX)}` : rawBefore,
    hit: text.slice(start, start + length),
    after: text.slice(start + length)
  }
}

/** What a hit becomes: the text as typed, or with $1-style group references in regex mode. */
export function replacementFor(hit: string, options: SearchOptions, replacement: string): string {
  if (!options.regex) return replacement
  const pattern = searchPattern(options)
  if (!pattern) return replacement
  const single = new RegExp(pattern.source, pattern.flags.replace('g', ''))
  return hit.replace(single, replacement)
}

/** Hits on a result line; the daemon reports one row per line, ripgrep counts each hit. */
export function hitCount(match: SearchMatch, pattern: RegExp | null): number {
  if (!pattern) return 1
  pattern.lastIndex = 0
  return Math.max(1, [...match.text.matchAll(pattern)].filter((m) => m[0]).length)
}
