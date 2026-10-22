import { Terminal } from '@xterm/xterm'
import { HARNESS_METHODS } from '@acp-harness/protocol'
import { harnessRequest } from '@/daemon-connection'

/** The terminal's text as a screen shows it: escapes applied, wrapped rows joined, trailing blanks gone. */
export async function terminalScreenText(terminalId: string): Promise<string> {
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
