import { useEffect, useRef } from 'react'
import './native-chat-find.css'
import { ChevronDown, ChevronUp, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { NativeChatFind } from './use-native-chat-find'

/** Ported from Orca's NativeChatFindBar: top-right of the transcript, like the terminal's search. */
export function NativeChatFindBar({ find }: { find: NativeChatFind }) {
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])
  const status = find.query && find.matchCount === 0 ? 'No results' : `${find.activeIndex + 1}/${find.matchCount}`
  return (
    <div
      role="search"
      data-native-chat-find-bar="true"
      className="absolute top-2 right-4 z-20 flex w-85 max-w-[calc(100%-2rem)] items-center gap-1 rounded-lg border border-border bg-popover/95 px-2 py-1 text-popover-foreground shadow-floating backdrop-blur-sm"
      onMouseDown={(event) => {
        // A press on the count or padding keeps typing in the find input.
        if (!(event.target instanceof Element) || !event.target.closest('button, input')) {
          event.preventDefault()
          inputRef.current?.focus()
        }
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault()
          event.stopPropagation()
          find.close()
        } else if (event.key === 'Enter' && event.target === inputRef.current) {
          event.preventDefault()
          find.step(event.shiftKey ? -1 : 1)
        }
      }}
    >
      <input
        ref={inputRef}
        type="text"
        value={find.query}
        onChange={(event) => find.setQuery(event.target.value)}
        placeholder="Find in chat"
        aria-label="Find in chat"
        className="min-w-0 flex-1 border-none bg-transparent text-sm text-popover-foreground outline-none placeholder:text-muted-foreground"
      />
      <span aria-live="polite" className="shrink-0 px-1 text-xs whitespace-nowrap text-muted-foreground tabular-nums">
        {status}
      </span>
      <div className="mx-0.5 h-4 w-px bg-border" />
      <Button type="button" variant="ghost" size="icon-xs" onClick={() => find.step(-1)} disabled={find.matchCount === 0} className="shrink-0" title="Previous match" aria-label="Previous match">
        <ChevronUp size={14} />
      </Button>
      <Button type="button" variant="ghost" size="icon-xs" onClick={() => find.step(1)} disabled={find.matchCount === 0} className="shrink-0" title="Next match" aria-label="Next match">
        <ChevronDown size={14} />
      </Button>
      <div className="mx-0.5 h-4 w-px bg-border" />
      <Button type="button" variant="ghost" size="icon-xs" onClick={find.close} className="shrink-0" title="Close" aria-label="Close">
        <X size={14} />
      </Button>
    </div>
  )
}
