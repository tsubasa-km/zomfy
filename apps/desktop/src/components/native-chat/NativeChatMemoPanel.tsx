import { useEffect, useRef } from 'react'
import { NotebookPen, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { MarkdownEditor, type MarkdownEditorHandle } from '@/components/markdown-editor/MarkdownEditor'
import { editChatMemo, flushChatMemo, setChatMemoOpen, useChatMemo } from '@/stores/chat-memo-store'

// Experimental chat memo: notes for one chat, in the composer's markdown editor, opening above
// the composer. The session's host stores it (see stores/chat-memo-store.ts).

export function NativeChatMemoButton({ sessionId }: { sessionId: string }) {
  const memo = useChatMemo(sessionId)
  if (!memo || memo.status === 'unavailable') return null
  const hasContent = memo.text.trim().length > 0
  const label = memo.open ? 'Close chat memo' : 'Chat memo'
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={label}
          aria-pressed={memo.open}
          data-native-chat-memo-button
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => setChatMemoOpen(sessionId, !memo.open)}
          className={cn('relative', memo.open && 'bg-accent text-accent-foreground')}
        >
          <NotebookPen className="size-4" />
          {hasContent ? (
            <span aria-hidden data-native-chat-memo-dot className="absolute top-1.5 right-1.5 size-1.5 rounded-full bg-foreground" />
          ) : null}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="top" sideOffset={4}>
        {hasContent && !memo.open ? 'Chat memo (has notes)' : label}
      </TooltipContent>
    </Tooltip>
  )
}

export function NativeChatMemoPanel({ sessionId, onClose }: { sessionId: string; onClose: () => void }) {
  const memo = useChatMemo(sessionId)
  const editorRef = useRef<MarkdownEditorHandle>(null)

  useEffect(() => {
    editorRef.current?.focus()
    // Leaving the chat (tab switch, close) writes what is pending right away.
    return () => void flushChatMemo(sessionId)
  }, [sessionId])

  if (!memo || memo.status === 'unavailable') return null
  const status = memo.status === 'loading' ? 'Loading…' : memo.error ? 'Not saved' : memo.saving || memo.dirty ? 'Saving…' : 'Saved'
  return (
    <section
      aria-label="Chat memo"
      data-native-chat-memo
      className="mb-2 animate-in rounded-xl border border-chat-composer-border bg-chat-composer-surface shadow-xs duration-150 fade-in-0 slide-in-from-bottom-2 select-none"
    >
      <header className="flex items-center gap-1.5 py-1 pr-1 pl-3 text-xs text-chat-foreground-faint">
        <NotebookPen aria-hidden className="size-3.5" />
        <span className="font-medium text-chat-foreground">Memo</span>
        <span aria-hidden>·</span>
        <span className="min-w-0 flex-1 truncate" title={memo.error ?? undefined} aria-live="polite">
          {status}
        </span>
        <Button type="button" variant="ghost" size="icon-xs" aria-label="Close memo" onClick={onClose}>
          <X className="size-3.5" />
        </Button>
      </header>
      <MarkdownEditor
        ref={editorRef}
        value={memo.text}
        placeholder={memo.status === 'loading' ? '' : 'Notes for this chat. Markdown works; only you see them.'}
        contentAttributes={{ 'aria-label': 'Chat memo', 'aria-multiline': 'true' }}
        onChange={(text) => editChatMemo(sessionId, text)}
        onKeyDown={(event) => {
          if (event.key !== 'Escape') return false
          onClose()
          return true
        }}
        minHeight="4.5rem"
        maxHeight="min(40vh, 24rem)"
        className="px-3 pb-2.5 text-sm text-chat-foreground-strong"
      />
    </section>
  )
}
