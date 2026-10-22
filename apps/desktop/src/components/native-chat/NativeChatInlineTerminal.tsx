import { useContext, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { MessageSquarePlus, SquareArrowOutUpRight, SquareTerminal, X } from 'lucide-react'
import { HARNESS_METHODS } from '@acp-harness/protocol'
import { closeTerminal, harnessRequest } from '@/daemon-connection'
import { openInlineTerminalAsTab } from '@/lib/terminal-command-run'
import { terminalOutputMention } from '@/lib/terminal-output-mention'
import { useStore } from '@/session-store'
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

  // An @ mention of a saved file, not the text: the agent reads only as much of it as it needs.
  const addToChat = () => {
    setAdding(true)
    void terminalScreenText(terminal.id)
      .then((text) =>
        harnessRequest(HARNESS_METHODS.terminalSaveOutput, { terminalId: terminal.id, sessionId: runner.sessionId, text })
      )
      .then(({ path }) => runner.addToChat(terminalOutputMention(path)))
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

/** The terminal's text as a screen shows it: escapes applied, wrapped rows joined, trailing blanks gone. */
async function terminalScreenText(terminalId: string): Promise<string> {
  const { buffer } = await harnessRequest(HARNESS_METHODS.terminalAttach, { terminalId })
  // Never opened: xterm parses into its buffer without rendering anything.
  const xterm = new Terminal({ cols: 160, rows: 50, scrollback: 10_000, allowProposedApi: true })
  try {
    await new Promise<void>((resolve) => xterm.write(buffer, resolve))
    const lines: string[] = []
    const active = xterm.buffer.active
    for (let i = 0; i < active.length; i++) {
      const line = active.getLine(i)
      if (!line) continue
      const text = line.translateToString(true)
      if (line.isWrapped && lines.length > 0) lines[lines.length - 1] += text
      else lines.push(text)
    }
    while (lines.length > 0 && lines.at(-1)!.trim() === '') lines.pop()
    // Shells pad their prompts with blank rows; one is enough.
    return lines.join('\n').replace(/\n{3,}/g, '\n\n')
  } finally {
    xterm.dispose()
  }
}
