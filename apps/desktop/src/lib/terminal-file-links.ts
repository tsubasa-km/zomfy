import type { IDisposable, ILink, Terminal } from '@xterm/xterm'
import { HARNESS_METHODS } from '@acp-harness/protocol'
import { harnessRequest } from '@/daemon-connection'
import { openEditorTab } from '@/session-store'

// File paths printed in a terminal become links that open the file in an editor tab, as Orca's
// terminal-links.ts (itself from VS Code's local/word link detectors). A path only links when the
// daemon host confirms it is a file inside the terminal's workspace.

// A path with a separator, optionally with `:line:col` (`src/a.ts:12:3`, `./bin`, `C:\x\y.ts`).
const SEPARATOR_PATH_RE =
  /(?:~[\\/]|[\\/]|\.{1,2}[\\/]|[A-Za-z]:[\\/]|[\p{L}\p{N}\p{M}._-]+[\\/])[\p{L}\p{N}\p{M}._~\-/%+@\\()[\]]*(?::\d+)?(?::\d+)?/gu
// A bare file name with an extension (`README.md`, `main.rs:4`).
const BARE_FILE_RE = /(?<![\p{L}\p{N}._\-/\\])[\p{L}\p{N}_-][\p{L}\p{N}._-]*\.[A-Za-z][A-Za-z0-9]{0,9}(?::\d+)?(?::\d+)?/gu
const URL_RE = /[A-Za-z][A-Za-z0-9+.-]*:\/\/\S+/g
const LOCATION_RE = /(?::(\d+))?(?::(\d+))?$/
const MAX_LINE = 2000
const MAX_CACHE = 500

interface Candidate {
  start: number
  end: number
  path: string
  line?: number
  column?: number
}

export function findPathCandidates(text: string): Candidate[] {
  if (text.length > MAX_LINE) return []
  const urls = [...text.matchAll(URL_RE)].map((m) => [m.index, m.index + m[0].length] as const)
  const taken: [number, number][] = []
  const out: Candidate[] = []
  for (const re of [SEPARATOR_PATH_RE, BARE_FILE_RE]) {
    for (const match of text.matchAll(re)) {
      let raw = match[0]
      // Prose punctuation and an unbalanced closing bracket are not part of the path.
      raw = raw.replace(/[.,;:]+$/, '')
      while (/[)\]]$/.test(raw) && count(raw, raw.endsWith(')') ? '(' : '[') < count(raw, raw.at(-1)!)) raw = raw.slice(0, -1)
      const start = match.index
      const end = start + raw.length
      if (raw.length < 2 || /^\d+$/.test(raw.replace(/[:\\/]/g, ''))) continue
      if ([...urls, ...taken].some(([s, e]) => start < e && end > s)) continue
      const location = LOCATION_RE.exec(raw)!
      const path = raw.slice(0, raw.length - location[0].length)
      if (!path || path === '/' || path === '.' || path === '..') continue
      taken.push([start, end])
      out.push({
        start,
        end,
        path,
        ...(location[1] ? { line: Number(location[1]) } : {}),
        ...(location[2] ? { column: Number(location[2]) } : {})
      })
    }
  }
  return out
}

function count(text: string, char: string): number {
  return text.split(char).length - 1
}

export function registerFileLinks(
  xterm: Terminal,
  terminalId: string,
  workspaceId: string,
  cwd: () => string
): IDisposable {
  // Keyed by cwd too: the same relative text names another file after a `cd`.
  const resolved = new Map<string, string | null>()
  const key = (path: string) => `${cwd()}\n${path}`
  const resolve = async (paths: string[]): Promise<void> => {
    const unknown = [...new Set(paths)].filter((p) => !resolved.has(key(p)))
    if (unknown.length === 0) return
    const answers = await harnessRequest(HARNESS_METHODS.terminalResolvePaths, { terminalId, paths: unknown }).catch(
      () => unknown.map(() => null)
    )
    if (resolved.size > MAX_CACHE) resolved.clear()
    unknown.forEach((p, i) => resolved.set(key(p), answers[i] ?? null))
  }

  return xterm.registerLinkProvider({
    provideLinks(y, callback) {
      const text = xterm.buffer.active.getLine(y - 1)?.translateToString(true) ?? ''
      const candidates = findPathCandidates(text)
      if (candidates.length === 0) return callback(undefined)
      void resolve(candidates.map((c) => c.path)).then(() => {
        const links = candidates.flatMap((c): ILink[] => {
          const path = resolved.get(key(c.path))
          if (!path) return []
          return [
            {
              range: { start: { x: c.start + 1, y }, end: { x: c.end, y } },
              text: text.slice(c.start, c.end),
              decorations: { pointerCursor: true, underline: true },
              activate: () =>
                openEditorTab({ workspaceId, kind: 'file', path, staged: false, ...(c.line ? { line: c.line } : {}) })
            }
          ]
        })
        callback(links.length ? links : undefined)
      })
    }
  })
}
