import { Terminal } from '@xterm/headless'

// What a terminal shows, kept as text on the host for agents (terminal_read): a headless xterm per
// terminal an agent has looked at, fed the same output the windows draw, so full-screen programs
// and redrawn prompts read as they look rather than as the raw stream.

const SCROLLBACK = 1000

interface Screen {
  term: Terminal
  cols: number
  rows: number
}

export interface ScreenText {
  /** The last lines, trailing blank lines dropped. */
  lines: string[]
  /** The line the cursor is on: where a prompt waits for input. */
  cursorLine: string
}

/** A prompt for something only the person should type. */
const SECRET_PROMPT = /(password|passphrase|passcode|パスワード|\bpin\b|verification code|one-time code|otp)[^\n]*[:：?]\s*$/i

export function asksForSecret(cursorLine: string): boolean {
  return SECRET_PROMPT.test(cursorLine)
}

export class TerminalScreens {
  private readonly screens = new Map<string, Screen>()
  private readonly lastOutput = new Map<string, number>()

  constructor(private readonly source: { replay(terminalId: string): string; size(terminalId: string): { cols: number; rows: number } }) {}

  /** Every output chunk, so a screen an agent reads later stays current. */
  feed(terminalId: string, data: string): void {
    this.lastOutput.set(terminalId, Date.now())
    this.screens.get(terminalId)?.term.write(data)
  }

  lastOutputAt(terminalId: string): number {
    return this.lastOutput.get(terminalId) ?? 0
  }

  forget(terminalId: string): void {
    this.screens.get(terminalId)?.term.dispose()
    this.screens.delete(terminalId)
    this.lastOutput.delete(terminalId)
  }

  /** Keeps only the screens of terminals that still exist. */
  retain(terminalIds: Iterable<string>): void {
    const live = new Set(terminalIds)
    for (const id of [...this.screens.keys(), ...this.lastOutput.keys()]) if (!live.has(id)) this.forget(id)
  }

  async read(terminalId: string, count: number): Promise<ScreenText> {
    const screen = this.screenOf(terminalId)
    // Writes are parsed asynchronously; an empty write's callback runs after the ones before it.
    await new Promise<void>((resolve) => screen.term.write('', resolve))
    const buffer = screen.term.buffer.active
    const all: string[] = []
    for (let i = 0; i < buffer.length; i++) all.push(buffer.getLine(i)?.translateToString(true) ?? '')
    const cursorLine = all[buffer.baseY + buffer.cursorY] ?? ''
    const end = Math.max(buffer.baseY + buffer.cursorY + 1, lastNonBlank(all) + 1)
    return { lines: all.slice(Math.max(0, end - count), end), cursorLine }
  }

  private screenOf(terminalId: string): Screen {
    const { cols, rows } = this.source.size(terminalId)
    let screen = this.screens.get(terminalId)
    if (!screen) {
      const term = new Terminal({ cols, rows, scrollback: SCROLLBACK, allowProposedApi: true })
      term.write(this.source.replay(terminalId))
      screen = { term, cols, rows }
      this.screens.set(terminalId, screen)
    } else if (screen.cols !== cols || screen.rows !== rows) {
      screen.term.resize(cols, rows)
      screen.cols = cols
      screen.rows = rows
    }
    return screen
  }
}

function lastNonBlank(lines: string[]): number {
  for (let i = lines.length - 1; i >= 0; i--) if (lines[i]!.trim()) return i
  return -1
}
