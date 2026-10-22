import { useContext, useState } from 'react'
import { MessageSquarePlus, SquareArrowOutUpRight, SquareTerminal, X } from 'lucide-react'
import { closeTerminal } from '@/daemon-connection'
import { openInlineTerminalAsTab } from '@/lib/terminal-command-run'
import { attachTerminal } from '@/lib/chat-attachments'
import { getState, useStore } from '@/session-store'
import { TerminalView } from '@/components/TerminalView'
import { NativeChatCommandRunContext } from './NativeChatRunCommandButton'

const ACTION_CLASS =
  'flex size-6 shrink-0 items-center justify-center rounded-md text-chat-foreground-faint transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50'

/** The terminal a code block's Run started, shown under the block until closed or opened as a tab. */
export function NativeChatInlineTerminal({ blockKey }: { blockKey: string }) {
  const runner = useContext(NativeChatCommandRunContext)
  const terminal = useStore((s) =>
    runner ? s.terminals.findLast((t) => t.inline?.sessionId === runner.sessionId && t.inline.blockKey === blockKey) : undefined
  )
  const [adding, setAdding] = useState(false)
  if (!runner || !terminal) return null

  // A mention of a saved snapshot, not the text: the agent reads only as much of it as it needs.
  const addToChat = () => {
    const chat = getState().sessions.find((s) => s.id === runner.sessionId)
    if (!chat) return
    setAdding(true)
    void attachTerminal(chat, terminal.id)
      .catch(() => undefined)
      .finally(() => setAdding(false))
  }

  return (
    <div data-native-chat-inline-terminal={terminal.id} data-native-chat-find-skip className="border-t border-chat-code-border select-none">
      <div className="flex h-7.5 items-center gap-1.5 px-3">
        <SquareTerminal className="size-3.5 shrink-0 text-chat-foreground-faint" />
        <span className="min-w-0 flex-1 truncate font-sans text-xs text-chat-foreground-faint">
          {terminal.title}
          {terminal.exitCode !== null ? ` · exited ${terminal.exitCode}` : ''}
        </span>
        <div className="-mr-1 flex items-center gap-0.5">
          <button
            type="button"
            className={ACTION_CLASS}
            disabled={adding}
            onClick={addToChat}
            aria-label="Attach output to message"
            title="Attach output to message as a file (the agent reads it only after you send)"
          >
            <MessageSquarePlus className="size-3.5" />
          </button>
          <button
            type="button"
            className={ACTION_CLASS}
            onClick={() => void openInlineTerminalAsTab(terminal.id).catch(() => undefined)}
            aria-label="Open as tab"
            title="Open as tab"
          >
            <SquareArrowOutUpRight className="size-3.5" />
          </button>
          <button
            type="button"
            className={ACTION_CLASS}
            onClick={() => closeTerminal(terminal.id)}
            aria-label="Close terminal"
            title="Close terminal"
          >
            <X className="size-3.5" />
          </button>
        </div>
      </div>
      {/* Resizable by its corner; xterm refits to whatever height it is given. */}
      <div className="flex h-56 min-h-24 max-h-[70vh] resize-y overflow-hidden">
        <TerminalView terminal={terminal} embedded />
      </div>
    </div>
  )
}
