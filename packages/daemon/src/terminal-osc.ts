// Pulls the window title (OSC 0/2) and working directory (OSC 7) out of PTY output, as Orca's
// pty-output-title-observer and parse-osc7 do, so every client sees the same tab title.

/** Longest unterminated OSC kept across reads; anything longer is not a title. */
const MAX_PENDING = 4096
const MAX_TITLE = 256
const OSC_RE = /\x1b\](\d+);([^\x07\x1b]*)(?:\x07|\x1b\\)/g

export interface OscFacts {
  title?: string
  cwd?: string
}

export class OscScanner {
  private pending = ''

  /** Facts from this chunk; the latest of each kind wins. */
  scan(data: string): OscFacts {
    const text = this.pending + data
    this.pending = ''
    const facts: OscFacts = {}
    let consumed = 0
    for (const match of text.matchAll(OSC_RE)) {
      consumed = match.index + match[0].length
      const [, code, body = ''] = match
      if (code === '0' || code === '2') facts.title = body.slice(0, MAX_TITLE)
      else if (code === '7') {
        const cwd = parseOsc7(body)
        if (cwd) facts.cwd = cwd
      }
    }
    // An OSC split across reads finishes in the next chunk.
    const open = text.lastIndexOf('\x1b]')
    if (open >= consumed && text.length - open <= MAX_PENDING) this.pending = text.slice(open)
    return facts
  }
}

function parseOsc7(body: string): string | null {
  if (!body.startsWith('file://')) return null
  try {
    let path = decodeURIComponent(new URL(body).pathname)
    // file:///C:/repo → C:/repo on Windows shells.
    if (/^\/[A-Za-z]:\//.test(path)) path = path.slice(1)
    return path || null
  } catch {
    return null
  }
}
