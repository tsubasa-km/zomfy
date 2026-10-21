import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

// Must match the ::highlight() selectors in native-chat-find.css.
const MATCH = 'native-chat-find-match'
const ACTIVE = 'native-chat-find-active-match'
/** Row chrome that only shows on hover (copy, rewind): skipped so counts never follow the mouse. */
const SKIPPED = '.sr-only, [hidden], [data-native-chat-find-skip]'

function highlights(): HighlightRegistry | null {
  return typeof CSS !== 'undefined' && 'highlights' in CSS ? CSS.highlights : null
}

function findRanges(root: HTMLElement, query: string): Range[] {
  const needle = query.toLowerCase()
  const ranges: Range[] = []
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) =>
      node.parentElement?.closest(SKIPPED) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT
  })
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node.textContent?.toLowerCase() ?? ''
    for (let at = text.indexOf(needle); at !== -1; at = text.indexOf(needle, at + needle.length)) {
      const range = document.createRange()
      range.setStart(node, at)
      range.setEnd(node, at + needle.length)
      ranges.push(range)
    }
  }
  return ranges
}

export type NativeChatFind = {
  open: boolean
  query: string
  matchCount: number
  activeIndex: number
  setQuery: (query: string) => void
  show: () => void
  close: () => void
  step: (direction: 1 | -1) => void
}

/**
 * Find over the chat transcript, painted with CSS highlights (Ranges, no DOM mutation) as Orca's
 * use-native-chat-find-matches does; re-searches as the transcript grows.
 */
export function useNativeChatFind(
  transcriptRef: React.RefObject<HTMLElement | null>,
  contentVersion: unknown
): NativeChatFind {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [matches, setMatches] = useState<Range[]>([])
  const [activeIndex, setActiveIndex] = useState(-1)
  const revealNext = useRef(false)

  // Why: store updates render synchronously, so a state write here on every streamed chunk would
  // nest one more sync render per chunk; closed find depends on nothing and writes only once.
  const searchedVersion = open && query ? contentVersion : null
  useLayoutEffect(() => {
    const registry = highlights()
    const root = transcriptRef.current
    if (!open || !query || !root) {
      registry?.delete(MATCH)
      registry?.delete(ACTIVE)
      setMatches((current) => (current.length === 0 ? current : []))
      setActiveIndex(-1)
      return
    }
    const found = findRanges(root, query)
    registry?.set(MATCH, new Highlight(...found))
    setMatches(found)
    setActiveIndex((current) => (found.length === 0 ? -1 : current >= 0 && current < found.length ? current : 0))
  }, [open, query, searchedVersion, transcriptRef])

  useEffect(() => {
    const registry = highlights()
    const active = matches[activeIndex]
    if (!active) {
      registry?.delete(ACTIVE)
      return
    }
    registry?.set(ACTIVE, new Highlight(active))
    if (revealNext.current) {
      revealNext.current = false
      active.startContainer.parentElement?.scrollIntoView({ block: 'center' })
    }
  }, [matches, activeIndex])

  useEffect(
    () => () => {
      highlights()?.delete(MATCH)
      highlights()?.delete(ACTIVE)
    },
    []
  )

  const step = useCallback(
    (direction: 1 | -1) => {
      if (matches.length === 0) return
      revealNext.current = true
      setActiveIndex((current) => (current + direction + matches.length) % matches.length)
    },
    [matches.length]
  )

  return {
    open,
    query,
    matchCount: matches.length,
    activeIndex,
    setQuery: (next) => {
      revealNext.current = true
      setQuery(next)
    },
    show: () => setOpen(true),
    close: () => setOpen(false),
    step
  }
}
